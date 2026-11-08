"""FastAPI media, analysis jobs, optional speech, and advisory terrain endpoints."""
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import math
import time
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from .config import load_config
from .media import Media, MediaError
from .store import Store
from .stdb import SpacetimeDB, encode_enum, encode_option
from .stt import SpeechToText
from .terrain import TerrainClassifier, CLASSES, ACTIONS
from .worker import Worker
from .watcher import Watcher


def create_app(config=None, stdb=None, analyze=None, speech=None):
    cfg = config or load_config()
    store = Store(cfg.data_dir / "perception.db")
    media = Media(cfg,store)
    database = stdb or SpacetimeDB(cfg)
    worker = Worker(cfg,store,media,database,analyze)
    watcher = Watcher(cfg,store,media,database)
    speech = speech or SpeechToText(cfg)
    terrain = TerrainClassifier(cfg)
    terrain_at = {}
    active_run = {"id":0,"at":0}

    @asynccontextmanager
    async def lifespan(app):
        speech.initialize()
        worker.start()
        watcher.start()
        yield
        watcher.stop()
        worker.stop()

    app = FastAPI(title="Rubble search perception", lifespan=lifespan)
    app.add_middleware(CORSMiddleware,allow_origins=cfg.cors_origins,
        allow_methods=["GET","POST"],allow_headers=["*"])
    app.state.config,app.state.store,app.state.worker = cfg,store,worker
    app.state.media,app.state.stdb,app.state.speech = media,database,speech

    def fail(error):
        if isinstance(error,MediaError):
            raise HTTPException(error.status,str(error)) from error
        raise HTTPException(422,"media could not be read") from error

    def run_id_or_default(run_id):
        if run_id is not None:
            return run_id
        if time.monotonic()-active_run["at"] >= 10:
            try:
                runs = database.rows("run")
                active_run["id"] = next((r["id"] for r in runs if r.get("ended_at") is None),0)
            except Exception:
                active_run["id"] = 0
            active_run["at"] = time.monotonic()
        return active_run["id"]

    @app.get("/health")
    def health():
        from .roi import model_status
        return dict(ok=True,stdb="ok" if database.healthy else "error",
            helper="down",read_mode="http_polling",queue=len(store.jobs({"queued","running","pending_write"})),
            yolo=model_status(),engine=speech.engine)

    @app.post("/media")
    def upload(file: UploadFile=File(...),run_id:int|None=Form(None),robot_id:str=Form("unknown"),
               detection_id:int=Form(0),kind:str|None=Form(None)):
        try:
            return {"url":media.save(file.file,file.filename,run_id_or_default(run_id),robot_id,kind,detection_id)}
        except (MediaError,ValueError) as error:
            fail(error)

    @app.get("/media/{name}")
    def get_media(name:str):
        try:
            return FileResponse(media.lookup(name))
        except MediaError as error:
            fail(error)

    @app.post("/breathing",status_code=202)
    def breathing(survivor_id:int=Form(...),file:UploadFile|None=File(None),clip_url:str|None=Form(None),
                  detection_id:int=Form(0),robot_id:str=Form("unknown"),roi:str|None=Form(None),fps:float|None=Form(None)):
        if survivor_id <= 0 or detection_id < 0:
            raise HTTPException(422,"invalid survivor or detection id")
        if (file is None) == (clip_url is None):
            raise HTTPException(422,"provide exactly one file or clip_url")
        if fps is not None and (not math.isfinite(fps) or fps <= 0):
            raise HTTPException(422,"invalid frame rate")
        parsed_roi = None
        if roi:
            try:
                parsed_roi = tuple(int(v.strip()) for v in roi.split(","))
                if len(parsed_roi) != 4 or min(parsed_roi[:2]) < 0 or min(parsed_roi[2:]) <= 0:
                    raise ValueError()
            except ValueError:
                raise HTTPException(422,"roi must be x,y,w,h with positive size")
        try:
            if file:
                clip_url = media.save(file.file,file.filename,run_id_or_default(None),robot_id,"clip",detection_id)
            path = media.resolve_url(clip_url)
            job = store.enqueue(dict(path=str(path),clip_url=clip_url,survivor_id=survivor_id,
                detection_id=detection_id,robot_id=robot_id,roi=parsed_roi,fps=fps))
            return dict(job_id=job["job_id"],clip_url=clip_url,status=job["status"])
        except (MediaError,ValueError) as error:
            fail(error)

    @app.get("/breathing/detection/{detection_id}")
    def by_detection(detection_id:int):
        value = store.latest("detection_id",detection_id)
        if value is None:
            raise HTTPException(404,"result not found")
        return value

    @app.get("/breathing/survivor/{survivor_id}")
    def by_survivor(survivor_id:int):
        value = store.latest("survivor_id",survivor_id)
        if value is None:
            raise HTTPException(404,"result not found")
        return value

    @app.get("/breathing/{job_id}")
    def by_job(job_id:str):
        value = store.job(job_id)
        if value is None:
            raise HTTPException(404,"job not found")
        return {key:value[key] for key in ("job_id","status","clip_url","survivor_id","detection_id","result","error")}

    @app.post("/transcribe")
    def transcribe(file:UploadFile|None=File(None),audio_url:str|None=Form(None),rescuer:str|None=Form(None)):
        if (file is None) == (audio_url is None):
            raise HTTPException(422,"provide exactly one file or audio_url")
        try:
            if file:
                if not (file.filename or "").lower().endswith(".wav"):
                    raise MediaError(415,"voice recording must be WAV")
                audio_url = media.save(file.file,file.filename,kind="voice")
            path = media.resolve_url(audio_url,kind="voice")
            return speech.transcribe(path)
        except (MediaError,ValueError,RuntimeError) as error:
            fail(error)

    @app.post("/terrain")
    def classify_terrain(file:UploadFile=File(...),robot_id:str=Form(...),rule_class:str=Form(...),observed_at:str=Form(...)):
        if rule_class not in CLASSES:
            raise HTTPException(422,"invalid terrain class")
        try:
            observed = datetime.fromisoformat(observed_at.replace("Z","+00:00"))
            if observed.tzinfo is None:
                raise ValueError()
        except ValueError:
            raise HTTPException(422,"observed_at must include a timezone")
        age = (datetime.now(timezone.utc)-observed).total_seconds()
        if age > cfg.terrain["terrain_max_age_s"] or age < -1:
            raise HTTPException(409,"terrain frame is stale or from the future")
        now = time.monotonic()
        if now-terrain_at.get(robot_id,float("-inf")) < 1:
            raise HTTPException(429,"terrain limit is one frame per second per robot")
        try:
            url = media.save(file.file,file.filename,run_id_or_default(None),robot_id,"terrain")
            path = media.resolve_url(url)
            import cv2
            if cv2.imread(str(path)) is None:
                raise ValueError("invalid image")
            terrain_at[robot_id] = now
            label,confidence = terrain.classify(path)
            result = dict(terrain_class=label,confidence=confidence,observed_at=observed_at)
            store.put("terrain",robot_id,{**result,"robot_id":robot_id,"rule_class":rule_class,"image_url":url})
            if cfg.terrain.get("terrain_write_db") and label != "unknown":
                robot = next((r for r in database.rows("robot") if r["robot_id"] == robot_id),None)
                if robot is None:
                    raise HTTPException(422,"unknown robot")
                database.call("report_terrain",[robot_id,robot["lat"],robot["lon"],encode_enum(label),confidence,
                    encode_enum("camera_model"),encode_enum(ACTIONS[label]),encode_option(url),
                    encode_option(int(observed.timestamp()*1e6))])
            return result
        except (MediaError,ValueError) as error:
            fail(error)

    @app.get("/terrain/latest")
    def terrain_latest():
        return store.terrain_latest()

    return app


app = create_app()
