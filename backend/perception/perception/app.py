"""FastAPI app: media and breathing endpoints, and startup of the worker, watcher, and re-score timer
(perception.md sections 2, 3, 8.2).

`uvicorn perception.app:app` builds the app on first access (see __getattr__ at the bottom), so
importing this module in tests does not touch the real data/ folder. Tests call create_app(cfg, ...).

The stt and terrain routers (POST /transcribe, POST /terrain, GET /terrain/latest) live in other
files; they are included when they import, and the app starts without them.
"""

from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import media
from .config import load_config
from .stdb import StdbClient, StdbRejected
from .store import Store
from .watcher import RowCache, Watcher
from .worker import Worker, load_optional, parse_roi

log = logging.getLogger("perception")

PERSON_DEFAULTS = {"person_image_url": None, "person_confirmed": False, "person_conf": 0.0}


def _optional_router(module_name: str):
    try:
        mod = load_optional(module_name)
    except Exception:  # noqa: BLE001 - a broken optional module must not stop the media server
        log.exception("%s failed to import", module_name)
        return None, None
    if mod is None:
        log.info("%s not installed; its endpoints are off", module_name)
        return None, None
    return mod, getattr(mod, "router", None)


REGISTER_BACKOFF_S = (2, 4, 8, 15, 30)  # then 30 s forever


def _register_once(stdb: StdbClient, cfg: dict) -> None:
    stdb.ensure_identity()
    stdb.register_participant(cfg["stdb"].get("participant_name", "perception"), "perception")
    stdb.needs_register.clear()
    log.info("registered with SpacetimeDB as perception (identity %s)", stdb.identity)


def _startup_stdb(stdb: StdbClient, cfg: dict, stop: threading.Event,
                  backoff_s: tuple[float, ...] = REGISTER_BACKOFF_S) -> None:
    """Identity, then register_participant as perception, retried with backoff until it works.
    Outside demo mode the module rejects the role until a coordinator calls
    grant_role(<identity>, perception); the media server keeps serving meanwhile.
    After that the thread waits on stdb.needs_register, which StdbClient.call sets when a write is
    rejected with "not registered" or "role not granted", and registers again."""
    attempt = 0
    while not stop.is_set():
        try:
            _register_once(stdb, cfg)
            attempt = 0
            while not stop.is_set() and not stdb.needs_register.wait(1.0):
                pass
            continue
        except StdbRejected as exc:
            delay = backoff_s[min(attempt, len(backoff_s) - 1)]
            log.error("register_participant rejected (identity %s): %s. Ask a coordinator to call "
                      "grant_role for this identity with role perception; retrying in %s s",
                      stdb.identity, exc.text or exc, delay)
        except Exception as exc:  # noqa: BLE001 - unreachable: try again later
            delay = backoff_s[min(attempt, len(backoff_s) - 1)]
            log.error("SpacetimeDB unreachable at startup (%s); retrying in %s s", exc, delay)
        attempt += 1
        stop.wait(delay)


def create_app(cfg: dict | None = None, *, stdb: StdbClient | None = None,
               start_background: bool = True) -> FastAPI:
    cfg = cfg or load_config()
    data_dir = Path(cfg["paths"]["data_dir"])
    (data_dir / "media").mkdir(parents=True, exist_ok=True)
    (data_dir / "derived").mkdir(parents=True, exist_ok=True)
    store = Store(data_dir / "perception.db")
    stdb = stdb or StdbClient.from_config(cfg)
    rows = RowCache(stdb, cfg)
    media.configure(cfg, store, rows.active_run_id)
    worker = Worker(cfg, store, stdb, rows)
    watcher = Watcher(cfg, store, stdb, worker, rows)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        stop = threading.Event()
        if start_background:
            threading.Thread(target=_startup_stdb, args=(stdb, cfg, stop), name="perception-register",
                             daemon=True).start()
            worker.start()
            watcher.start()
        yield
        stop.set()
        if start_background:
            watcher.stop()
            worker.stop()

    app = FastAPI(title="perception", lifespan=lifespan)
    app.state.cfg = cfg
    app.state.store = store
    app.state.stdb = stdb
    app.state.rows = rows
    app.state.worker = worker
    app.state.watcher = watcher

    if cfg["server"]["cors_origins"]:
        app.add_middleware(CORSMiddleware, allow_origins=cfg["server"]["cors_origins"],
                           allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(media.MediaError)
    async def _media_error(_request: Request, exc: media.MediaError):
        return JSONResponse(status_code=exc.status, content={"detail": exc.detail})

    # media
    @app.post("/media")
    def post_media(file: UploadFile = File(...), run_id: int | None = Form(None), robot_id: str | None = Form(None),
                   detection_id: int | None = Form(None), kind: str | None = Form(None)):
        ext = media.normalize_ext(file.filename or "")
        saved = media.save_stream(file.file, ext=ext, kind=kind, robot_id=robot_id, run_id=run_id,
                                  detection_id=detection_id, original_filename=file.filename)
        return {"url": saved["url"]}

    @app.get("/media/{name:path}")
    def get_media(name: str):
        row = media.lookup(name)
        return FileResponse(row["path"])  # media type from mimetypes.guess_type on the path

    # breathing
    @app.post("/breathing", status_code=202)
    def post_breathing(survivor_id: int = Form(...), file: UploadFile | None = File(None),
                       clip_url: str | None = Form(None), detection_id: int | None = Form(None),
                       robot_id: str | None = Form(None), roi: str | None = Form(None),
                       fps: float | None = Form(None)):
        if survivor_id <= 0:
            raise media.MediaError(400, "survivor_id must be 1 or more")
        try:
            parse_roi(roi)
        except ValueError as exc:
            raise media.MediaError(400, f"bad roi: {exc}") from exc
        if fps is not None and fps <= 0:
            raise media.MediaError(400, "fps must be above 0")
        clip_name = None
        if file is not None and file.filename:
            ext = media.normalize_ext(file.filename)
            saved = media.save_stream(file.file, ext=ext, kind="clip", robot_id=robot_id,
                                      detection_id=detection_id, original_filename=file.filename)
            clip_url, clip_name = saved["url"], saved["name"]
        elif clip_url:
            clip_name = media.local_name_for_url(clip_url)
            if clip_name is not None:
                media.lookup(clip_name)  # 404 now rather than a failed job later
        else:
            raise media.MediaError(400, "file or clip_url is required")
        job = worker.submit_breathing(survivor_id=survivor_id, clip_url=clip_url, clip_name=clip_name,
                                      detection_id=detection_id, robot_id=robot_id, roi=roi, fps=fps)
        if detection_id:
            store.mark_detection_analyzed(detection_id, clip_url, job["job_id"])
        return JSONResponse(status_code=202, content={"job_id": job["job_id"], "clip_url": clip_url,
                                                      "status": "queued"})

    def _result_body(job: dict | None) -> dict:
        body = dict(job["result"]) if job and job.get("result") else {}
        if job:
            body.setdefault("job_id", job["job_id"])
            body["job_status"] = job["status"]
        for key in ("display_clip_url", "spectrum_url", "roi_image_url"):
            body.setdefault(key, None)
        return body

    @app.get("/breathing/detection/{detection_id}")
    def breathing_for_detection(detection_id: int):
        job = store.latest_result_for_detection(detection_id)
        pc = store.get_person_check(detection_id)
        if job is None and pc is None:
            raise media.MediaError(404, "no result for this detection")
        body = _result_body(job)
        body.setdefault("detection_id", detection_id)
        for key, default in PERSON_DEFAULTS.items():
            body.setdefault(key, default)
        if pc is not None:
            body["person_image_url"] = pc["person_image_url"]
            body["person_confirmed"] = pc["person_confirmed"]
            body["person_conf"] = pc["person_conf"]
        return body

    @app.get("/breathing/survivor/{survivor_id}")
    def breathing_for_survivor(survivor_id: int):
        job = store.latest_result_for_survivor(survivor_id)
        if job is None:
            raise media.MediaError(404, "no result for this survivor")
        return _result_body(job)

    @app.get("/breathing/{job_id}")
    def get_job(job_id: str):
        job = store.get_job(job_id)
        if job is None:
            raise media.MediaError(404, "unknown job")
        return job

    # health
    @app.get("/health")
    def health():
        roi_mod = load_optional("perception.roi")
        yolo = "missing"
        try:
            if roi_mod is not None and hasattr(roi_mod, "yolo_loaded") and roi_mod.yolo_loaded():
                yolo = "loaded"
        except Exception:  # noqa: BLE001
            yolo = "missing"
        body = {"ok": True, "stdb": "ok" if stdb.ok_once else "error", "queue": worker.queue_size(),
                "yolo": yolo, "helper": "up" if watcher.helper_up else "down"}
        stt_mod = load_optional("perception.stt")
        try:
            body["stt"] = stt_mod.engine_name() if stt_mod is not None and hasattr(stt_mod, "engine_name") else "none"
        except Exception:  # noqa: BLE001
            body["stt"] = "none"
        return body

    # optional routers from other files
    for module_name in ("perception.stt", "perception.terrain"):
        mod, router = _optional_router(module_name)
        if mod is not None and hasattr(mod, "configure"):
            mod.configure(cfg)  # its config.toml section ([stt], [terrain]); each module picks its own
        if router is not None:
            app.include_router(router)

    return app


def __getattr__(name: str):
    """Build the module-level `app` lazily, so `uvicorn perception.app:app` works and plain imports stay cheap."""
    if name == "app":
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
        built = create_app()
        globals()["app"] = built
        return built
    raise AttributeError(name)
