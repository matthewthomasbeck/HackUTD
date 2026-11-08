"""Breathing endpoints, worker writes, re-scan rule, pending writes, watcher, re-score timer, /health.
breathing.py, score.py, and roi.py are stubs here (conftest.py)."""

import sys
import types
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter
from fastapi.testclient import TestClient

MP4 = b"\x00\x00\x00\x18ftypmp42fake-clip"


def iso_minutes_ago(minutes):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")


def survivor(sid=12, status="unassigned", breathing="unknown", minutes=0, level="unknown", score=0.0, conf=0.0):
    return {"id": sid, "status": status, "breathing": breathing, "breathing_rate_bpm": None,
            "breathing_confidence": 0.0, "visibility_pct": None, "created_at": iso_minutes_ago(minutes),
            "critical_level": level, "critical_score": score, "score_confidence": conf, "score_reasons": []}


def post_clip(client, **form):
    form.setdefault("survivor_id", "12")
    return client.post("/breathing", files={"file": ("clip.mp4", MP4)}, data=form)


# endpoints

def test_post_breathing_queues_a_job(client, app):
    r = post_clip(client, detection_id="40", robot_id="dog1", roi="220,140,180,120", fps="30")
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "queued"
    assert body["clip_url"].startswith("http://testserver/media/r0_dog1_clip_")
    job = client.get(f"/breathing/{body['job_id']}").json()
    assert job["status"] == "queued" and job["survivor_id"] == 12 and job["detection_id"] == 40
    assert app.state.store.detection_analyzed(40)
    assert client.get("/health").json()["queue"] == 1


def test_post_breathing_with_local_clip_url(client):
    url = client.post("/media", files={"file": ("c.mp4", MP4)}, data={"kind": "clip"}).json()["url"]
    r = client.post("/breathing", data={"clip_url": url, "survivor_id": "12"})
    assert r.status_code == 202 and r.json()["clip_url"] == url


def test_post_breathing_errors(client):
    assert client.post("/breathing", data={"survivor_id": "12"}).status_code == 400
    assert post_clip(client, roi="1,2,3").status_code == 400
    assert post_clip(client, survivor_id="0").status_code == 400
    missing = "http://testserver/media/r0_dog1_clip_20261108T031522Z_00000000.mp4"
    assert client.post("/breathing", data={"clip_url": missing, "survivor_id": "12"}).status_code == 404
    assert client.get("/breathing/not-a-job").status_code == 404
    assert client.get("/breathing/detection/999").status_code == 404


# worker

def test_job_writes_report_breathing_then_score(client, app, fake_stdb, stubs):
    fake_stdb.tables["survivor"] = [survivor(minutes=12)]
    fake_stdb.tables["detection"] = [{"id": 40, "survivor_id": 12, "source": "thermal", "thermal_confidence": 0.82}]
    job_id = post_clip(client, detection_id="40", roi="220,140,180,120").json()["job_id"]
    assert app.state.worker.process_next()

    assert stubs.breathing.seen[0]["roi"] == (220, 140, 180, 120)
    assert stubs.breathing.seen[0]["cfg"]["min_fps"] == 10
    assert stubs.breathing.seen[0]["out_dir"].endswith("derived/det_40")
    assert fake_stdb.reducers() == ["report_breathing", "set_critical_score"]
    assert fake_stdb.calls[0][1] == [12, {"detected": []}, {"some": 17.8}, 0.64, {"some": 59.0}, {"none": []}]
    level, score, conf, reasons = fake_stdb.calls[1][1][1:]
    assert level == {"delayed": []} and isinstance(score, float) and conf == 0.5
    assert reasons[-1] == "needs human triage"
    seen = stubs.score.seen[0]
    assert seen["thermal_conf"] == 0.82 and seen["earlier_kept"] is False and 11.9 < seen["minutes_waiting"] < 12.1

    job = client.get(f"/breathing/{job_id}").json()
    assert job["status"] == "done" and job["write_state"] == "written"
    det = client.get("/breathing/detection/40").json()
    assert det["breathing"] == "detected" and det["rate_bpm"] == 17.8
    assert det["roi_image_url"] == "http://testserver/media/det40_roi.jpg"
    assert client.get("/media/det40_roi.jpg").status_code == 200
    assert det["person_image_url"] is None and det["person_confirmed"] is False and det["person_conf"] == 0.0
    assert client.get("/breathing/survivor/12").json()["job_id"] == job_id
    assert app.state.store.get_score_write(12)["level"] == "delayed"


def test_unknown_survivor_is_error_and_writes_nothing(client, app, fake_stdb):
    job_id = post_clip(client, survivor_id="99").json()["job_id"]
    app.state.worker.process_next()
    job = client.get(f"/breathing/{job_id}").json()
    assert job["status"] == "error" and job["reason"] == "unknown survivor"
    assert fake_stdb.calls == []


def test_rescan_unknown_keeps_earlier_detected(client, app, fake_stdb, stubs):
    fake_stdb.tables["survivor"] = [survivor()]
    post_clip(client)
    app.state.worker.process_next()
    fake_stdb.calls.clear()

    stubs.breathing.next_result = {"breathing": "unknown", "rate_bpm": None, "breathing_confidence": 0.1,
                                   "visibility_pct": None, "reasons": ["camera or scene moved"]}
    job_id = post_clip(client).json()["job_id"]
    app.state.worker.process_next()
    assert fake_stdb.reducers() == ["set_critical_score"]  # no report_breathing
    last = stubs.score.seen[-1]
    assert last["breathing"] == "detected" and last["rate_bpm"] == 17.8 and last["earlier_kept"] is True
    assert app.state.store.get_survivor_breathing(12)["breathing"] == "detected"
    assert client.get(f"/breathing/{job_id}").json()["result"]["earlier_result_kept"] is True


def test_unknown_first_result_is_reported_with_gate_reason(client, app, fake_stdb, stubs):
    fake_stdb.tables["survivor"] = [survivor()]
    stubs.breathing.next_result = {"breathing": "unknown", "rate_bpm": 99.0, "breathing_confidence": 0.1,
                                   "visibility_pct": None, "reasons": ["clip too dark, needs light"]}
    post_clip(client)
    app.state.worker.process_next()
    assert fake_stdb.calls[0][1][1:3] == [{"unknown": []}, {"none": []}]  # rate only with detected
    assert stubs.score.seen[-1]["reason"] == "clip too dark, needs light"


def test_rejected_report_breathing_skips_score(client, app, fake_stdb):
    fake_stdb.tables["survivor"] = [survivor()]
    fake_stdb.fail["report_breathing"] = "reject"
    job_id = post_clip(client).json()["job_id"]
    app.state.worker.process_next()
    job = client.get(f"/breathing/{job_id}").json()
    assert job["status"] == "error" and "report_breathing refused" in job["reason"]
    assert fake_stdb.calls == []


def test_unreachable_database_keeps_pending_write_and_retries_in_order(client, app, fake_stdb):
    fake_stdb.tables["survivor"] = [survivor()]
    app.state.rows.get_survivor(12)  # cached, so the job runs while the database is down
    fake_stdb.fail["*"] = "unavailable"
    fake_stdb.sql_down = True
    job_id = post_clip(client).json()["job_id"]
    app.state.worker.process_next()
    job = client.get(f"/breathing/{job_id}").json()
    assert job["status"] == "done" and job["write_state"] == "pending_write"
    assert len(app.state.store.pending_writes()) == 1
    assert app.state.worker.flush_pending() is False

    fake_stdb.fail.clear()
    fake_stdb.sql_down = False
    assert app.state.worker.flush_pending() is True
    assert fake_stdb.reducers() == ["report_breathing", "set_critical_score"]
    assert app.state.store.pending_writes() == []
    assert client.get(f"/breathing/{job_id}").json()["write_state"] == "written"


# watcher

def test_watcher_queues_clips_skips_survivor_zero_and_runs_person_check(client, app, fake_stdb, stubs):
    mp4_url = client.post("/media", files={"file": ("c.mp4", MP4)}, data={"robot_id": "dog1"}).json()["url"]
    jpg_url = client.post("/media", files={"file": ("s.jpg", b"\xff\xd8jpg")}, data={"robot_id": "dog1"}).json()["url"]
    fake_stdb.tables["survivor"] = [survivor()]
    fake_stdb.tables["detection"] = [
        {"id": 41, "survivor_id": 0, "source": "thermal", "breathing_clip_url": mp4_url, "camera_image_url": jpg_url},
        {"id": 42, "survivor_id": 12, "source": "thermal", "thermal_confidence": 0.7, "robot_id": "dog1",
         "breathing_clip_url": mp4_url, "camera_image_url": jpg_url},
    ]
    watcher, worker, store = app.state.watcher, app.state.worker, app.state.store
    watcher.poll_once()
    assert not store.detection_analyzed(41)
    assert store.detection_analyzed(42)
    while worker.process_next():
        pass
    watcher.poll_once()  # no new rows: nothing queued twice
    assert worker.process_next() is False
    assert fake_stdb.reducers() == ["report_breathing", "set_critical_score"]

    det = client.get("/breathing/detection/42").json()
    assert det["person_confirmed"] is True and det["person_conf"] == 0.81
    assert det["person_image_url"] == "http://testserver/media/det42_person.jpg"
    assert client.get("/media/det42_person.jpg").headers["content-type"] == "image/jpeg"


def test_watcher_does_not_requeue_a_clip_posted_directly(client, app, fake_stdb):
    url = client.post("/media", files={"file": ("c.mp4", MP4)}).json()["url"]
    client.post("/breathing", data={"clip_url": url, "survivor_id": "12"})
    fake_stdb.tables["detection"] = [{"id": 43, "survivor_id": 12, "breathing_clip_url": url}]
    app.state.watcher.poll_once()
    assert app.state.store.queue_depth() == 1


def test_rescore_writes_only_on_meaningful_change(app, fake_stdb, stubs):
    fake_stdb.tables["survivor"] = [survivor(12, minutes=15), survivor(13, status="reached", minutes=15)]
    watcher = app.state.watcher
    watcher.poll_once()
    assert watcher.rescore_all() == 1
    assert fake_stdb.reducers() == ["set_critical_score"]
    assert fake_stdb.calls[0][1][1] == {"immediate": []}
    assert stubs.score.seen[-1]["breathing"] is None  # no breathing clip yet
    assert app.state.store.get_score_write(12) is not None
    assert app.state.store.get_score_write(13) is None

    assert watcher.rescore_all() == 0  # same score, nothing written
    fake_stdb.tables["survivor"][0]["created_at"] = iso_minutes_ago(25)
    watcher.poll_once()
    assert watcher.rescore_all() == 1


def test_rescore_keeps_a_score_another_writer_set(client, app, fake_stdb, stubs):
    # rehearsal 2026-11-08: during sim `scale 300` the timer rescored every sim survivor from the
    # row, so minor and delayed sim survivors turned delayed or immediate
    fake_stdb.tables["survivor"] = [survivor(30, breathing="detected", minutes=5, level="minor", score=22.0, conf=0.6)]
    watcher = app.state.watcher
    watcher.poll_once()
    assert watcher.rescore_all() == 0
    fake_stdb.tables["survivor"][0]["created_at"] = iso_minutes_ago(25)
    watcher.poll_once()
    assert watcher.rescore_all() == 0
    assert fake_stdb.calls == []
    assert app.state.store.get_score_write(30) is None

    # this service's own clip is new evidence: it writes, and then owns the waiting-time rescore
    post_clip(client, survivor_id="30")
    app.state.worker.process_next()
    assert fake_stdb.reducers() == ["report_breathing", "set_critical_score"]
    fake_stdb.calls.clear()
    fake_stdb.tables["survivor"][0]["created_at"] = iso_minutes_ago(40)
    watcher.poll_once()
    assert watcher.rescore_all() == 1
    assert fake_stdb.reducers() == ["set_critical_score"]


def test_rescore_does_not_replace_a_later_score_from_another_writer(app, fake_stdb, stubs):
    # rehearsal 2026-11-08: the house 3 survivor went from immediate 92 (sim) to delayed 33.6
    fake_stdb.tables["survivor"] = [survivor(31, minutes=1)]
    watcher = app.state.watcher
    watcher.poll_once()
    assert watcher.rescore_all() == 1  # nobody scored it: the default immediate, per section 7
    row = fake_stdb.tables["survivor"][0]
    assert row["critical_level"] == "immediate"
    # the simulator then reports breathing and its own score
    row.update(breathing="detected", breathing_rate_bpm=17.0, breathing_confidence=0.8,
               critical_level="immediate", critical_score=92.0, score_confidence=0.6,
               created_at=iso_minutes_ago(30))
    watcher.poll_once()
    assert watcher.rescore_all() == 0
    assert fake_stdb.reducers() == ["set_critical_score"]
    assert row["critical_score"] == 92.0


def test_new_survivor_waits_the_grace_period(app, fake_stdb, stubs, monkeypatch):
    import perception.watcher as watcher_mod

    timers = []

    class FakeTimer:
        def __init__(self, delay, fn):
            timers.append((delay, fn))
            self.daemon = False

        def start(self):
            pass

    monkeypatch.setattr(watcher_mod.threading, "Timer", FakeTimer)
    watcher = app.state.watcher
    watcher.cfg["score"]["new_survivor_grace_s"] = 2.0
    watcher.handle_event({"status": "connected"})
    watcher.handle_event({"table": "survivor", "op": "insert", "row": survivor(40)})
    watcher.handle_event({"table": "survivor", "op": "insert", "row": survivor(41)})
    assert fake_stdb.calls == [] and [d for d, _ in timers] == [2.0, 2.0]
    # the simulator scores #40 within the grace period; #41 stays unscored
    watcher.handle_event({"table": "survivor", "op": "update",
                          "row": survivor(40, breathing="detected", level="immediate", score=92.0, conf=0.6)})
    for _, fn in timers:
        fn()
    assert [c[1][0] for c in fake_stdb.calls] == [41]


def test_helper_events_feed_the_watcher(app, fake_stdb):
    watcher = app.state.watcher
    watcher.cfg["score"]["new_survivor_grace_s"] = 0
    watcher.handle_event({"status": "connected"})
    assert watcher.helper_up
    watcher.handle_event({"table": "survivor", "op": "insert", "row": survivor(20)})
    assert fake_stdb.reducers() == ["set_critical_score"]  # a new survivor is scored at once
    watcher.handle_event({"table": "detection", "op": "insert",
                          "row": {"id": 50, "survivor_id": 20, "breathing_clip_url": "http://elsewhere/c.mp4"}})
    assert app.state.store.detection_analyzed(50)


# health and optional routers

def test_health(client, fake_stdb, stubs):
    body = client.get("/health").json()
    assert body == {"ok": True, "stdb": "error", "queue": 0, "yolo": "loaded", "helper": "down", "stt": "none"}
    fake_stdb.call("register_participant", ["perception", {"perception": []}])
    stubs.roi.loaded = False
    body = client.get("/health").json()
    assert body["stdb"] == "ok" and body["yolo"] == "missing"


def test_optional_routers_are_included(cfg, fake_stdb, stubs, monkeypatch):
    stt = types.ModuleType("perception.stt")
    stt.router = APIRouter()
    stt.engine_name = lambda: "whisper_local:small.en"

    @stt.router.post("/transcribe")
    def _transcribe():
        return {"transcript": "", "confidence": 0.0, "engine": "whisper_local:small.en"}

    terrain = types.ModuleType("perception.terrain")
    terrain.router = APIRouter()

    @terrain.router.get("/terrain/latest")
    def _latest():
        return {}

    monkeypatch.setitem(sys.modules, "perception.stt", stt)
    monkeypatch.setitem(sys.modules, "perception.terrain", terrain)
    from perception.app import create_app
    c = TestClient(create_app(cfg, stdb=fake_stdb, start_background=False))
    assert c.post("/transcribe").status_code == 200
    assert c.get("/terrain/latest").status_code == 200
    assert c.get("/health").json()["stt"] == "whisper_local:small.en"


def test_app_starts_without_optional_modules(cfg, fake_stdb, monkeypatch):
    for name in ("perception.breathing", "perception.score", "perception.roi", "perception.stt", "perception.terrain"):
        monkeypatch.setitem(sys.modules, name, None)
    from perception.app import create_app
    c = TestClient(create_app(cfg, stdb=fake_stdb, start_background=False))
    body = c.get("/health").json()
    assert body["yolo"] == "missing" and body["stt"] == "none"
    assert c.post("/transcribe").status_code == 404


def test_app_passes_its_config_to_the_optional_modules(cfg, fake_stdb, monkeypatch):
    # config.toml [terrain] and [stt] must reach terrain.configure() and stt.configure(); without
    # that, terrain_hint_enabled and terrain_write_db in the file are silently ignored.
    seen = {}
    for name in ("stt", "terrain"):
        mod = types.ModuleType(f"perception.{name}")
        mod.router = APIRouter()
        mod.configure = lambda c, name=name: seen.__setitem__(name, c)
        monkeypatch.setitem(sys.modules, f"perception.{name}", mod)
    cfg["terrain"]["terrain_hint_enabled"] = True
    from perception.app import create_app
    create_app(cfg, stdb=fake_stdb, start_background=False)
    assert seen["terrain"]["terrain"]["terrain_hint_enabled"] is True
    assert seen["stt"] is seen["terrain"]
