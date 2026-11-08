import io
import json
from datetime import datetime, timedelta, timezone
import time
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from perception.app import create_app
from perception.config import Config
from perception.score import compute_score, meaningful_change, BANNED
from perception.stdb import SpacetimeDB, ReducerRejected, decode_sql, encode_enum, encode_option
from perception.store import Store
from perception.terrain import fuse


class FakeDB:
    configured = True
    healthy = True
    def __init__(self):
        self.calls = []
        self.available = True
        self.survivors = [{"id":1,"status":"unassigned","breathing":"unknown",
            "created_at":datetime.now(timezone.utc).isoformat()}]
    def initialize(self):
        return True
    def rows(self,table):
        if not self.available:
            raise ConnectionError("offline")
        return self.survivors if table == "survivor" else []
    def call(self,name,args):
        if not self.available:
            raise ConnectionError("offline")
        self.calls.append((name,args))


def result(*args,**kwargs):
    return dict(breathing="detected",rate_bpm=15,breathing_confidence=0.8,
                visibility_pct=80,person_confirmed=True,person_conf=0.9,reasons=[])


def make_app(tmp_path,**kwargs):
    cfg = Config(data_dir=tmp_path)
    db = kwargs.pop("stdb",FakeDB())
    return create_app(cfg,stdb=db,analyze=kwargs.pop("analyze",result),**kwargs)


def await_result(client,job_id,allow_pending=False):
    end = time.monotonic()+20
    while time.monotonic() < end:
        job = client.get("/breathing/"+job_id).json()
        if job["status"] in ({"done","error","pending_write"} if allow_pending else {"done","error"}):
            return job
        time.sleep(0.03)
    raise AssertionError("job did not finish")


def test_score_formula_levels_confidence_and_bounds():
    score = compute_score("not_detected",visibility_pct=20,waiting_minutes=15,thermal_confidence=0.8)
    assert score["score"] == 84
    assert score["level"] == "immediate"
    assert score["confidence"] == 0.3
    normal = compute_score("detected",17,0.8,80,0,0.9)
    assert normal["level"] == "delayed"
    assert normal["confidence"] == 0.72
    for status,rate in [("unknown",None),("not_detected",None),("detected",8),("detected",34)]:
        item = compute_score(status,rate,visibility_pct=None,waiting_minutes=1000)
        assert item["level"] == "immediate" and 0 <= item["score"] <= 100
        assert len(item["reasons"]) <= 8 and all(len(r) <= 48 for r in item["reasons"])
        assert not BANNED.search(json.dumps(item))
    with pytest.raises(ValueError):
        compute_score("detected",float("nan"))
    assert not meaningful_change(normal,{**normal,"score":normal["score"]+1})
    assert meaningful_change(normal,{**normal,"score":normal["score"]+2})


def test_media_upload_opaque_names_and_seek(tmp_path):
    app = make_app(tmp_path)
    with TestClient(app) as client:
        response = client.post("/media",files={"file":("../../secret.mp4",b"1234567890","video/mp4")})
        assert response.status_code == 200
        url = response.json()["url"]
        assert "secret" not in url
        path = "/media/"+url.rsplit("/",1)[1]
        assert client.get(path).content == b"1234567890"
        partial = client.get(path,headers={"Range":"bytes=2-5"})
        assert partial.status_code == 206 and partial.content == b"3456"
        assert client.post("/media",files={"file":("x.exe",b"bad")}).status_code == 415
        app.state.config.upload_max_bytes = 2
        assert client.post("/media",files={"file":("x.mp4",b"big")}).status_code == 413
        assert client.get("/media/missing.mp4").status_code == 404
        assert client.post("/media",data={"robot_id":"../bad"},files={"file":("x.mp4",b"x")}).status_code == 422


def test_job_round_trip_and_no_unclear_overwrite(tmp_path):
    db = FakeDB()
    app = make_app(tmp_path,stdb=db)
    with TestClient(app) as client:
        response = client.post("/breathing",data={"survivor_id":1,"detection_id":9},files={"file":("clip.mp4",b"mock frames")})
        assert response.status_code == 202
        job = await_result(client,response.json()["job_id"])
        assert job["status"] == "done"
        names = [name for name,_ in db.calls]
        assert names.index("report_breathing") < names.index("set_critical_score",names.index("report_breathing"))
        assert client.get("/breathing/detection/9").json()["person_confirmed"]
        db.survivors[0].update(breathing="detected",rate_bpm=15,breathing_confidence=0.8,visibility_pct=80)
        app.state.worker.analyze = lambda *args,**kw:dict(breathing="unknown",rate_bpm=None,breathing_confidence=0.1,reasons=["clip too dark, needs light"])
        before = sum(name=="report_breathing" for name,_ in db.calls)
        response = client.post("/breathing",data={"survivor_id":1},files={"file":("new.mp4",b"other")})
        job = await_result(client,response.json()["job_id"])
        assert job["status"] == "done" and job["result"]["earlier_result_kept"]
        assert sum(name=="report_breathing" for name,_ in db.calls) == before
        assert "latest clip unclear, earlier result kept" in job["result"]["critical_score"]["reasons"]


def test_unknown_survivor_and_deduplicated_url(tmp_path):
    app = make_app(tmp_path)
    with TestClient(app) as client:
        url = client.post("/media",files={"file":("clip.mp4",b"x")}).json()["url"]
        first = client.post("/breathing",data={"survivor_id":999,"clip_url":url}).json()
        assert await_result(client,first["job_id"])["error"] == "unknown survivor"
        second = client.post("/breathing",data={"survivor_id":999,"clip_url":url}).json()
        assert first["job_id"] == second["job_id"]
        assert client.post("/breathing",data={"survivor_id":1,"clip_url":url,"roi":"0,0,-1,2"}).status_code == 422


def test_durable_pending_write_recovers(tmp_path):
    db = FakeDB()
    app = make_app(tmp_path,stdb=db)
    def analyze_and_disconnect(*args,**kwargs):
        db.available = False
        return result()
    app.state.worker.analyze = analyze_and_disconnect
    with TestClient(app) as client:
        response = client.post("/breathing",data={"survivor_id":1},files={"file":("clip.mp4",b"x")})
        job = await_result(client,response.json()["job_id"],allow_pending=True)
        assert job["status"] == "pending_write" and job["result"]["rate_bpm"] == 15
        db.available = True
        app.state.worker.process(app.state.store.job(job["job_id"]))
        assert app.state.store.job(job["job_id"])["status"] == "done"
    restarted = Store(tmp_path/"perception.db")
    assert restarted.job(job["job_id"])["result"]["rate_bpm"] == 15


def test_stdb_encoding_decoding_and_rejection():
    import httpx
    assert encode_enum("detected") == {"detected":[]}
    assert encode_option(None) == {"none":[]}
    assert encode_option(0) == {"some":0}
    raw = [{"schema":{"elements":[{"name":"id"},{"name":"breathing","algebraic_type":{"Sum":{"variants":[{"name":"unknown"},{"name":"detected"}]}}}]},"rows":[[1,[1,[]]]]}]
    assert decode_sql(raw) == [{"id":1,"breathing":"detected"}]
    attempts = []
    def reject(request):
        attempts.append(request)
        return httpx.Response(530,text="role not granted")
    cfg = Config(stdb_uri="http://localhost:3000",stdb_database="test")
    db = SpacetimeDB(cfg,httpx.Client(transport=httpx.MockTransport(reject)),sleep=lambda _:None)
    with pytest.raises(ReducerRejected):
        db.call("report_breathing",[])
    assert len(attempts) == 1


def test_terrain_never_loosens_and_endpoint_is_unevaluated(tmp_path):
    for action in ("continue","slow","steer","stop"):
        for camera in ("flat","debris","step","gap","blocked","unknown"):
            ranks = {"continue":0,"slow":1,"steer":2,"stop":3}
            fused = fuse("gap",0.8,action,camera,0.9)
            assert ranks[fused["action"]] >= ranks[action]
    app = make_app(tmp_path)
    image = cv2.imencode(".jpg",np.full((64,64,3),128,np.uint8))[1].tobytes()
    with TestClient(app) as client:
        observed = datetime.now(timezone.utc).isoformat()
        response = client.post("/terrain",data={"robot_id":"dog1","rule_class":"flat","observed_at":observed},files={"file":("terrain.jpg",image)})
        assert response.status_code == 200
        assert response.json() == {"terrain_class":"unknown","confidence":0,"observed_at":observed}
        old = (datetime.now(timezone.utc)-timedelta(seconds=10)).isoformat()
        assert client.post("/terrain",data={"robot_id":"dog2","rule_class":"flat","observed_at":old},files={"file":("terrain.jpg",image)}).status_code == 409


def test_actual_breathing_pipeline_through_upload_job_and_score(tmp_path):
    from scripts.make_synthetic import write_clip
    from perception.breathing import analyze_clip
    source = tmp_path/"source.avi"
    truth = write_clip(source,size=(320,240))
    cfg = Config(data_dir=tmp_path/"service")
    cfg.breathing["use_yolo"] = False
    app = create_app(cfg,stdb=FakeDB(),analyze=analyze_clip)
    with TestClient(app) as client:
        with source.open("rb") as video:
            response = client.post("/breathing",data={"survivor_id":1,"roi":",".join(map(str,truth["roi"]))},
                files={"file":("public-test.avi",video,"video/x-msvideo")})
        assert response.status_code == 202
        job = await_result(client,response.json()["job_id"])
        assert job["status"] == "done",job
        measured = job["result"]
        assert measured["breathing"] == "detected",measured
        assert abs(measured["rate_bpm"]-15) < 1.5
        assert measured["critical_score"]["level"] == "immediate"
        assert client.get(measured["roi_image_url"].replace(cfg.public_base_url,"")).status_code == 200
