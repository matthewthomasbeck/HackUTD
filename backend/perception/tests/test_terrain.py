"""Tests for perception.terrain and scripts/train_terrain.py (perception.md sections 9 and 10)."""

import csv
import importlib.util
import io
import itertools
import json
import sys
import time
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

import perception
from perception import terrain
from perception.terrain import ACTION_ORDER, SUGGESTED_ACTION, TERRAIN_CLASSES, fuse

ROOT = Path(__file__).resolve().parent.parent

needs_clip = pytest.mark.skipif(not terrain.clip_weights_available(), reason="CLIP weights not downloaded")


def caution(a):
    return ACTION_ORDER.index(a)


# ---- fusion rule ---------------------------------------------------------

def test_fuse_agree_formula():
    out = fuse("debris", "debris", 0.6, rule_conf=0.5)
    assert out["confidence"] == pytest.approx(1 - 0.5 * 0.4)
    assert out["terrain_class"] == "debris"


def test_fuse_disagree_formula_keeps_rule_class():
    out = fuse("flat", "debris", 0.72, rule_conf=1.0)
    assert out["terrain_class"] == "flat"
    assert out["confidence"] == pytest.approx(0.64)
    assert out["action"] == "slow"


def test_fuse_zero_confidence_is_no_advice():
    out = fuse("flat", "gap", 0.0, rule_conf=0.8)
    assert out == {"terrain_class": "flat", "confidence": 0.8, "action": "continue"}


@pytest.mark.parametrize("rule_class,camera_class,rule_action", list(itertools.product(TERRAIN_CLASSES, TERRAIN_CLASSES, ACTION_ORDER)))
@pytest.mark.parametrize("c_cam", [0.0, 0.3, 0.9, 1.0])
def test_fuse_never_less_cautious_and_never_changes_stop(rule_class, camera_class, rule_action, c_cam):
    out = fuse(rule_class, camera_class, c_cam, rule_conf=0.7, rule_action=rule_action)
    assert out["terrain_class"] == rule_class
    assert 0.0 <= out["confidence"] <= 1.0
    assert caution(out["action"]) >= caution(rule_action)  # never less cautious
    assert caution(out["action"]) - caution(rule_action) <= 1  # one step at most
    if rule_action == "stop":
        assert out["action"] == "stop"  # stop never changes
    else:
        assert out["action"] != "stop"  # the camera never creates a stop


def test_fuse_steps_match_spec_examples():
    assert fuse("flat", "debris", 0.9)["action"] == "slow"  # continue to slow
    assert fuse("debris", "blocked", 0.9)["action"] == "steer"  # slow to steer
    assert fuse("blocked", "gap", 0.9)["action"] == "steer"  # steer stays, never stop
    assert fuse("gap", "flat", 0.9)["action"] == "stop"  # stop never loosened
    assert fuse("debris", "flat", 0.9)["action"] == "slow"  # never less cautious


def test_fuse_rejects_bad_values():
    with pytest.raises(ValueError):
        fuse("lava", "flat", 0.5)
    with pytest.raises(ValueError):
        fuse("flat", "flat", 0.5, rule_action="run")


def test_suggested_actions():
    assert SUGGESTED_ACTION == {
        "flat": "continue", "debris": "slow", "step": "slow",
        "gap": "stop", "blocked": "steer", "unknown": "slow",
    }


# ---- decision and parsing ------------------------------------------------

def test_decide_unknown_below_min_conf():
    assert terrain.decide({"flat": 0.49, "gap": 0.2}, 0.5) == ("unknown", 0.49)
    assert terrain.decide({"flat": 0.2, "gap": 0.8}, 0.5) == ("gap", 0.8)


def test_parse_observed_at_forms():
    a = terrain.parse_observed_at("2026-11-08T03:15:22Z")
    b = terrain.parse_observed_at("2026-11-08T03:15:22+00:00")
    c = terrain.parse_observed_at(str(a.timestamp()))
    d = terrain.parse_observed_at(str(int(a.timestamp() * 1000)))
    assert a == b == c == d
    with pytest.raises(ValueError):
        terrain.parse_observed_at("yesterday")


def test_run_id_from_name():
    assert terrain.run_id_from_name("r3_dog1_terrain_20261108T031522Z_9f2c41ab.jpg") == "3"
    assert terrain.run_id_from_name("frame.jpg") == "0"


def test_to_pil_accepts_bgr_array():
    arr = np.zeros((4, 4, 3), np.uint8)
    arr[:, :, 0] = 255  # blue in BGR
    assert terrain.to_pil(arr).getpixel((0, 0)) == (0, 0, 255)


# ---- HTTP ----------------------------------------------------------------

def jpeg_bytes(color=(120, 120, 120)):
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, format="JPEG")
    return buf.getvalue()


def now_iso(offset_s=0.0):
    t = datetime.now(timezone.utc) + timedelta(seconds=offset_s)
    return t.isoformat().replace("+00:00", "Z")


@pytest.fixture
def api(monkeypatch, tmp_path):
    saved = []

    def save_bytes(data, *, ext, kind, robot_id="unknown", run_id=0, detection_id=None, original_filename=None):
        name = f"r{run_id}_{robot_id}_{kind}_20261108T031522Z_{len(saved):08x}.{ext}"
        saved.append({"kind": kind, "robot_id": robot_id, "ext": ext, "bytes": len(data)})
        return {"name": name, "path": str(tmp_path / name), "url": f"http://test/media/{name}"}

    fake_media = types.ModuleType("perception.media")
    fake_media.save_bytes = save_bytes
    monkeypatch.setitem(sys.modules, "perception.media", fake_media)
    monkeypatch.setattr(perception, "media", fake_media, raising=False)

    calls = []
    fake_stdb = types.ModuleType("perception.stdb")
    fake_stdb.call = lambda reducer, args: calls.append((reducer, args))
    monkeypatch.setitem(sys.modules, "perception.stdb", fake_stdb)
    monkeypatch.setattr(perception, "stdb", fake_stdb, raising=False)

    monkeypatch.setattr(terrain, "classify_detailed", lambda image, cfg=None: ("debris", 0.72, "zero_shot"))
    terrain.reset_state()
    terrain.configure({"terrain_frames_csv": str(tmp_path / "frames.csv")})

    app = FastAPI()
    app.include_router(terrain.router)
    client = TestClient(app)
    yield types.SimpleNamespace(client=client, saved=saved, calls=calls, tmp=tmp_path)
    terrain.configure(None)
    terrain.reset_state()


def post(api, robot="dog1", observed_at=None, rule_class="flat", **extra):
    data = {"robot_id": robot, "observed_at": observed_at or now_iso(), "rule_class": rule_class, **extra}
    return api.client.post("/terrain", files={"file": ("frame.jpg", jpeg_bytes(), "image/jpeg")}, data=data)


def test_post_terrain_echoes_observed_at_and_stores(api):
    obs = now_iso(-1)
    resp = post(api, observed_at=obs)
    assert resp.status_code == 200
    body = resp.json()
    assert body["observed_at"] == obs
    # hint is off until the probe beats the baseline: no advice
    assert body["terrain_class"] == "unknown" and body["confidence"] == 0
    assert api.saved == [{"kind": "terrain", "robot_id": "dog1", "ext": "jpg", "bytes": len(jpeg_bytes())}]
    assert api.calls == []


def test_post_terrain_old_frame_409(api):
    resp = post(api, observed_at=now_iso(-6))
    assert resp.status_code == 409
    assert "terrain_class" not in resp.json()
    assert api.saved == []


def test_post_terrain_rate_limit_per_robot(api):
    assert post(api, robot="dog1").status_code == 200
    assert post(api, robot="dog1").status_code == 429
    assert post(api, robot="dog2").status_code == 200


def test_post_terrain_rate_limit_resets(api):
    terrain.configure({"terrain_min_interval_s": 0.05, "terrain_frames_csv": str(api.tmp / "frames.csv")})
    assert post(api).status_code == 200
    time.sleep(0.06)
    assert post(api).status_code == 200


def test_post_terrain_bad_inputs(api):
    assert post(api, rule_class="lava").status_code == 400
    assert post(api, observed_at="not a time").status_code == 400
    resp = api.client.post(
        "/terrain",
        files={"file": ("frame.jpg", b"not an image", "image/jpeg")},
        data={"robot_id": "dog1", "observed_at": now_iso()},
    )
    assert resp.status_code == 400


def test_hint_enabled_returns_class(api):
    terrain.configure({"terrain_hint_enabled": True, "terrain_frames_csv": str(api.tmp / "frames.csv")})
    body = post(api).json()
    assert body["terrain_class"] == "debris" and body["confidence"] == 0.72
    assert api.calls == []  # terrain_write_db is off by default


def test_db_write_only_when_configured(api):
    terrain.configure(
        {"terrain_hint_enabled": True, "terrain_write_db": True, "terrain_frames_csv": str(api.tmp / "frames.csv")}
    )
    assert post(api).status_code == 200
    assert len(api.calls) == 1
    reducer, args = api.calls[0]
    assert reducer == "report_terrain"
    assert args[0] == "dog1" and args[5] == "camera_model"
    assert args[3] == {"debris": []} and args[6] == {"slow": []}
    assert len(args) == 9


def test_latest_and_frames_csv(api):
    post(api, robot="dog1", rule_class="flat")
    rows = api.client.get("/terrain/latest").json()
    assert set(rows) == {"dog1"}
    rec = rows["dog1"]
    assert rec["terrain_class"] == "debris" and rec["rule_class"] == "flat"
    assert rec["image_url"].startswith("http://test/media/")
    assert api.client.get("/terrain/latest", params={"robot_id": "dog1"}).json()["robot_id"] == "dog1"
    assert api.client.get("/terrain/latest", params={"robot_id": "nope"}).status_code == 404
    with open(api.tmp / "frames.csv", newline="") as fh:
        lines = list(csv.DictReader(fh))
    assert lines[0]["rule_class"] == "flat" and lines[0]["robot_id"] == "dog1"


# ---- training on a tiny synthetic labelled set ---------------------------

def synth_image(cls, rng):
    """Tiny synthetic frames, one visual pattern per class (not real terrain)."""
    h, w = 64, 64
    img = np.full((h, w, 3), 128, np.uint8)
    if cls == "flat":
        img[:] = 150 + rng.integers(-5, 5)
    elif cls == "debris":
        img = rng.integers(0, 255, (h, w, 3), dtype=np.uint8)
    elif cls == "step":
        img[: h // 2] = 200
        img[h // 2:] = 60
    elif cls == "gap":
        img[:] = 160
        img[20:44, 20:44] = 0
    elif cls == "blocked":
        img[:] = 90
        img[:, 24:40] = 230
    noise = rng.integers(-8, 8, img.shape)
    return Image.fromarray(np.clip(img.astype(int) + noise, 0, 255).astype(np.uint8))


def make_dataset(tmp_path, per_class=6):
    rng = np.random.default_rng(1)
    img_dir = tmp_path / "frames"
    img_dir.mkdir()
    labels = tmp_path / "labels.csv"
    with open(labels, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["image_name", "run_id", "rule_class", "human_class", "labelled_by"])
        w.writeheader()
        for run in ("1", "2"):
            for cls in terrain.MODEL_CLASSES:
                for k in range(per_class):
                    name = f"r{run}_dog1_terrain_{cls}_{k}.png"
                    synth_image(cls, rng).save(img_dir / name)
                    w.writerow({"image_name": name, "run_id": run, "rule_class": "flat", "human_class": cls, "labelled_by": "test"})
    return img_dir, labels


def load_train_module():
    spec = importlib.util.spec_from_file_location("train_terrain", ROOT / "scripts" / "train_terrain.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def tiny_embed(images):
    rows = []
    for im in images:
        a = np.asarray(im.convert("L").resize((8, 8)), np.float32).ravel()
        a = np.concatenate([a, [a.std()]])
        rows.append(a / (np.linalg.norm(a) + 1e-6))
    return np.stack(rows)


def test_train_terrain_end_to_end_synthetic(tmp_path):
    img_dir, labels = make_dataset(tmp_path)
    train = load_train_module()
    out, report_path = tmp_path / "terrain_model.joblib", tmp_path / "report.json"
    report = train.main(
        ["--labels", str(labels), "--images", str(img_dir), "--test-run", "2", "--out", str(out), "--report", str(report_path)],
        embed_fn=tiny_embed,
        zero_shot_fn=lambda emb: ["unknown"] * len(emb),
    )
    assert out.exists() and report_path.exists()
    saved = json.loads(report_path.read_text())
    for key in ("linear_probe", "zero_shot", "latency_ms", "probe_beats_baseline", "test_run"):
        assert key in saved
    assert saved["test_run"] == "2" and saved["train_runs"] == ["1"]
    probe = report["linear_probe"]
    assert len(probe["confusion_matrix"]) == 6
    assert set(probe["danger_recall"]) == {"gap", "step", "blocked"}
    assert probe["accuracy"] >= 0.8  # the synthetic patterns are easy
    assert report["probe_beats_baseline"] is True
    assert 0.0 <= probe["agreement_with_rules"] <= 1.0  # rules always said flat

    import joblib

    bundle = joblib.load(out)
    assert set(bundle["classes"]) == set(terrain.MODEL_CLASSES)


def test_train_terrain_needs_two_runs(tmp_path):
    img_dir, labels = make_dataset(tmp_path, per_class=2)
    rows = list(csv.DictReader(open(labels)))
    with open(labels, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(r for r in rows if r["run_id"] == "1")
    train = load_train_module()
    with pytest.raises(SystemExit):
        train.main(["--labels", str(labels), "--images", str(img_dir), "--out", str(tmp_path / "m"), "--report", str(tmp_path / "r")],
                   embed_fn=tiny_embed, zero_shot_fn=lambda e: ["unknown"] * len(e))


# ---- real CLIP (needs downloaded weights) --------------------------------

@needs_clip
def test_clip_classify_and_latency():
    rng = np.random.default_rng(2)
    imgs = [synth_image(c, rng).resize((640, 480)) for c in terrain.MODEL_CLASSES for _ in range(4)]
    terrain.classify(imgs[0])  # warm up (model load)
    lat = []
    for im in imgs:
        buf = io.BytesIO()
        im.save(buf, format="JPEG")
        data = buf.getvalue()
        t0 = time.perf_counter()
        cls, conf = terrain.classify(data)  # from encoded bytes to classified
        lat.append(time.perf_counter() - t0)
        assert cls in TERRAIN_CLASSES
        assert 0.0 <= conf <= 1.0
    p50, p95 = np.percentile(lat, 50) * 1000, np.percentile(lat, 95) * 1000
    print(f"\nCLIP classify latency over {len(lat)} frames: p50 {p50:.0f} ms, p95 {p95:.0f} ms")
    assert p95 < 2000


@needs_clip
def test_train_with_clip_and_probe_is_used(tmp_path):
    img_dir, labels = make_dataset(tmp_path, per_class=4)
    train = load_train_module()
    out = tmp_path / "terrain_model.joblib"
    report = train.main(
        ["--labels", str(labels), "--images", str(img_dir), "--test-run", "2", "--out", str(out), "--report", str(tmp_path / "r.json")]
    )
    assert report["latency_ms"]["p95"] > 0
    cls, conf, source = terrain.classify_detailed(img_dir / "r2_dog1_terrain_gap_0.png", {"terrain_model_path": str(out)})
    assert source == "linear_probe"
    assert cls in TERRAIN_CLASSES
