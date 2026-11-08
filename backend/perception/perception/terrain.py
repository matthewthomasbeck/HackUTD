"""Terrain recognition camera model, advisory only (docs/specs/perception.md section 9).

The robot decides terrain in real time with its own LiDAR and IMU rules and
never waits for this service. This model only gives an advisory hint that may
raise or lower the robot's confidence; it never overrides a safety stop.

Two stages:
  1. Zero-shot CLIP baseline (openai/clip-vit-base-patch32), one prompt per class.
  2. Linear probe: frozen CLIP image embeddings plus a LogisticRegression,
     loaded from data/terrain_model.joblib when that file exists
     (written by scripts/train_terrain.py).

`classify(image) -> (terrain_class, confidence)`; below terrain_min_conf the
class is `unknown`. `fuse(rule_class, camera_class, camera_conf)` is the shared
fusion rule. `router` adds POST /terrain and GET /terrain/latest.

Example trace: the bridge posts a frame with rule_class "flat". CLIP gives
debris 0.72, so classify returns ("debris", 0.72). fuse("flat", "debris", 0.72)
keeps the rule class "flat" (they disagree), lowers its confidence to
1.0 * (1 - 0.5 * 0.72) = 0.64, and raises the action one step, from
continue to slow. Until terrain_hint_enabled is true (after the probe beats
the baseline), the HTTP answer is "unknown" with confidence 0, which the robot
treats as no advice.
"""

from __future__ import annotations

import io
import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

log = logging.getLogger("perception.terrain")

TERRAIN_CLASSES = ("flat", "debris", "step", "gap", "blocked", "unknown")
MODEL_CLASSES = ("flat", "debris", "step", "gap", "blocked")  # classes with a prompt

PROMPTS = {
    "flat": "a photo of flat clear floor",
    "debris": "a photo of loose debris and rubble on the floor",
    "step": "a photo of a step or ledge",
    "gap": "a photo of a gap or hole in the floor",
    "blocked": "a photo of a wall or obstacle blocking the way",
}

# Suggested action for a camera class (section 9). Advice, not a robot action.
SUGGESTED_ACTION = {
    "flat": "continue",
    "debris": "slow",
    "step": "slow",
    "gap": "stop",
    "blocked": "steer",
    "unknown": "slow",
}

# Least to most cautious.
ACTION_ORDER = ("continue", "slow", "steer", "stop")

_PKG_ROOT = Path(__file__).resolve().parent.parent  # backend/perception

DEFAULTS: dict = {
    "terrain_min_conf": 0.5,
    "terrain_max_age_s": 5.0,
    "terrain_write_db": False,
    "terrain_min_interval_s": 1.0,
    "terrain_hint_enabled": False,
    "terrain_clip_model": "openai/clip-vit-base-patch32",
    "terrain_model_path": str(_PKG_ROOT / "data" / "terrain_model.joblib"),
    "terrain_max_bytes": 8 * 1024 * 1024,
    "terrain_frames_csv": str(_PKG_ROOT / "data" / "terrain_frames.csv"),
}

_cfg_override: dict = {}


def configure(cfg: dict | None = None) -> None:
    """Merge a cfg dict (flat keys, or a whole config with a `terrain` table)."""
    global _cfg_override
    if cfg and isinstance(cfg.get("terrain"), dict):
        cfg = cfg["terrain"]
    _cfg_override = dict(cfg or {})


def settings() -> dict:
    out = dict(DEFAULTS)
    out.update(_cfg_override)
    return out


# ---- fusion rule (pure) --------------------------------------------------

def _caution(action: str) -> int:
    return ACTION_ORDER.index(action)


def fuse(
    rule_class: str,
    camera_class: str,
    camera_conf: float,
    rule_conf: float = 1.0,
    rule_action: str | None = None,
) -> dict:
    """Combine the robot's rule result with the camera hint (section 9).

    - Agree: confidence = 1 - (1 - c_rule) * (1 - c_cam).
    - Disagree: confidence = c_rule * (1 - 0.5 * c_cam), and the rule class stays.
    - The action may only become more cautious, by one step at most
      (continue to slow, slow to steer), and never into or out of stop.
    - A camera confidence of 0 is no advice: the rule result is returned unchanged.

    rule_action defaults to the suggested action of the rule class.
    Returns {"terrain_class", "confidence", "action"}.
    """
    if rule_class not in TERRAIN_CLASSES:
        raise ValueError(f"unknown rule class {rule_class!r}")
    if camera_class not in TERRAIN_CLASSES:
        raise ValueError(f"unknown camera class {camera_class!r}")
    c_rule = min(1.0, max(0.0, float(rule_conf)))
    c_cam = min(1.0, max(0.0, float(camera_conf)))
    action = rule_action or SUGGESTED_ACTION[rule_class]
    if action not in ACTION_ORDER:
        raise ValueError(f"unknown action {action!r}")

    if c_cam <= 0.0:
        return {"terrain_class": rule_class, "confidence": round(c_rule, 3), "action": action}

    if camera_class == rule_class:
        conf = 1.0 - (1.0 - c_rule) * (1.0 - c_cam)
    else:
        conf = c_rule * (1.0 - 0.5 * c_cam)

    if action != "stop":
        cam_action = SUGGESTED_ACTION[camera_class]
        cur = _caution(action)
        if _caution(cam_action) > cur and cur < _caution("steer"):
            # one step more cautious, never into stop
            action = ACTION_ORDER[cur + 1]

    return {"terrain_class": rule_class, "confidence": round(conf, 3), "action": action}


# ---- model ---------------------------------------------------------------

class _Model:
    """Lazy CLIP plus an optional linear probe, shared by classify and training."""

    def __init__(self):
        self._lock = threading.Lock()
        self.name = None
        self.model = None
        self.processor = None
        self.text_feats = None
        self.probe = None
        self.probe_path = None
        self.probe_mtime = None

    def load(self, name: str):
        with self._lock:
            if self.model is not None and self.name == name:
                return
            import torch
            from transformers import CLIPModel, CLIPProcessor

            self.processor = CLIPProcessor.from_pretrained(name)
            self.model = CLIPModel.from_pretrained(name).eval()
            prompts = [PROMPTS[c] for c in MODEL_CLASSES]
            with torch.no_grad():
                tok = self.processor(text=prompts, return_tensors="pt", padding=True)
                feats = _as_tensor(self.model.get_text_features(**tok))
            self.text_feats = feats / feats.norm(dim=-1, keepdim=True)
            self.name = name

    def embed(self, images: list) -> np.ndarray:
        """L2-normalized CLIP image embeddings, one row per image."""
        import torch

        with torch.no_grad():
            inputs = self.processor(images=images, return_tensors="pt")
            feats = _as_tensor(self.model.get_image_features(**inputs))
            feats = feats / feats.norm(dim=-1, keepdim=True)
        return feats.cpu().numpy()

    def zero_shot(self, emb: np.ndarray) -> np.ndarray:
        import torch

        img = torch.from_numpy(emb)
        scale = self.model.logit_scale.exp()
        logits = scale * img @ self.text_feats.T
        return logits.softmax(dim=-1).detach().cpu().numpy()

    def load_probe(self, path: str):
        p = Path(path)
        if not p.exists():
            self.probe = None
            self.probe_path = None
            return None
        mtime = p.stat().st_mtime
        if self.probe is not None and self.probe_path == str(p) and self.probe_mtime == mtime:
            return self.probe
        import joblib

        bundle = joblib.load(p)
        if not isinstance(bundle, dict) or "classifier" not in bundle:
            log.warning("terrain probe %s is not a train_terrain.py bundle; ignored", p)
            self.probe = None
            return None
        self.probe, self.probe_path, self.probe_mtime = bundle, str(p), mtime
        return bundle


def _as_tensor(out):
    """get_*_features returns a tensor in most transformers versions, an output object in some."""
    if hasattr(out, "pooler_output") and not hasattr(out, "norm"):
        return out.pooler_output
    return out


_model = _Model()


def to_pil(image):
    """Accept a path, bytes, a PIL image, or a numpy array (BGR from OpenCV, or gray)."""
    from PIL import Image

    if isinstance(image, Image.Image):
        return image.convert("RGB")
    if isinstance(image, (bytes, bytearray, memoryview)):
        img = Image.open(io.BytesIO(bytes(image)))
        img.load()
        return img.convert("RGB")
    if isinstance(image, (str, os.PathLike)):
        with Image.open(image) as img:
            img.load()
            return img.convert("RGB")
    if isinstance(image, np.ndarray):
        arr = image
        if arr.ndim == 2:
            return Image.fromarray(arr.astype(np.uint8)).convert("RGB")
        if arr.ndim == 3 and arr.shape[2] >= 3:
            return Image.fromarray(arr[:, :, 2::-1].astype(np.uint8))  # BGR to RGB
    raise TypeError(f"unsupported image type {type(image).__name__}")


def embed_images(images: list, cfg: dict | None = None) -> np.ndarray:
    s = dict(settings(), **(cfg or {}))
    _model.load(s["terrain_clip_model"])
    return _model.embed([to_pil(im) for im in images])


def probs_from_embedding(emb: np.ndarray, cfg: dict | None = None) -> tuple[dict, str]:
    """Class probabilities for one embedding, and which model produced them."""
    s = dict(settings(), **(cfg or {}))
    _model.load(s["terrain_clip_model"])
    probe = _model.load_probe(s["terrain_model_path"])
    if probe is not None:
        clf = probe["classifier"]
        p = clf.predict_proba(emb.reshape(1, -1))[0]
        classes = [str(c) for c in clf.classes_]
        return dict(zip(classes, map(float, p))), "linear_probe"
    p = _model.zero_shot(emb.reshape(1, -1))[0]
    return dict(zip(MODEL_CLASSES, map(float, p))), "zero_shot"


def decide(probs: dict, min_conf: float) -> tuple[str, float]:
    """Top class and its probability; `unknown` when below min_conf."""
    cls, conf = max(probs.items(), key=lambda kv: kv[1])
    conf = round(float(conf), 3)
    if conf < min_conf or cls not in TERRAIN_CLASSES:
        return "unknown", conf
    return cls, conf


def classify(image, cfg: dict | None = None) -> tuple[str, float]:
    """Classify one frame. Returns (terrain_class, confidence = top class probability)."""
    cls, conf, _ = classify_detailed(image, cfg)
    return cls, conf


def classify_detailed(image, cfg: dict | None = None) -> tuple[str, float, str]:
    s = dict(settings(), **(cfg or {}))
    emb = embed_images([image], s)[0]
    probs, source = probs_from_embedding(emb, s)
    cls, conf = decide(probs, float(s["terrain_min_conf"]))
    return cls, conf, source


def clip_weights_available(name: str | None = None) -> bool:
    """True when the CLIP weights are in the local Hugging Face cache (no download)."""
    try:
        from huggingface_hub import try_to_load_from_cache

        name = name or DEFAULTS["terrain_clip_model"]
        hit = try_to_load_from_cache(name, "config.json")
        return isinstance(hit, str)
    except Exception:
        return False


# ---- HTTP ----------------------------------------------------------------

def parse_observed_at(value: str) -> datetime:
    """ISO 8601 UTC (the contract's JSON time format), or Unix seconds or milliseconds."""
    v = value.strip()
    try:
        num = float(v)
    except ValueError:
        num = None
    if num is not None:
        if num > 1e11:  # milliseconds
            num /= 1000.0
        return datetime.fromtimestamp(num, tz=timezone.utc)
    if v.endswith("Z") or v.endswith("z"):
        v = v[:-1] + "+00:00"
    dt = datetime.fromisoformat(v)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


_state_lock = threading.Lock()
_last_accept: dict[str, float] = {}  # robot_id -> monotonic time of the last accepted frame
_latest: dict[str, dict] = {}  # robot_id -> latest result


def reset_state() -> None:
    with _state_lock:
        _last_accept.clear()
        _latest.clear()


def latest() -> dict:
    with _state_lock:
        return {k: dict(v) for k, v in _latest.items()}


def _ext_for(filename: str | None) -> str:
    ext = Path(filename or "").suffix.lower().lstrip(".")
    return ext if ext in ("jpg", "jpeg", "png") else "jpg"


FRAMES_CSV_FIELDS = ("image_name", "run_id", "robot_id", "rule_class", "observed_at", "camera_class", "camera_conf")


def run_id_from_name(name: str) -> str:
    """Media names start with r<run_id>_ (perception.md section 2); 0 if not."""
    head = (name or "").split("_", 1)[0]
    return head[1:] if head.startswith("r") and head[1:].isdigit() else "0"


def _log_frame(path: str, row: dict) -> None:
    """Append one stored frame to the labelling list read by scripts/label_terrain.py."""
    import csv

    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    new = not p.exists()
    with _state_lock, open(p, "a", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FRAMES_CSV_FIELDS)
        if new:
            w.writeheader()
        w.writerow({k: row.get(k, "") for k in FRAMES_CSV_FIELDS})


def _enc_enum(tag: str) -> dict:
    return {tag: []}


def _enc_opt(value) -> dict:
    return {"none": []} if value is None else {"some": value}


def _write_db(robot_id, lat, lon, cls, conf, action, image_url, observed_at_iso) -> None:
    from perception import stdb  # lazy: written by another module

    args = [
        robot_id,
        _enc_opt(lat),
        _enc_opt(lon),
        _enc_enum(cls),
        conf,
        "camera_model",
        _enc_enum(action),
        image_url,
        _enc_opt(observed_at_iso),
    ]
    stdb.call("report_terrain", args)


def _build_router():
    r = APIRouter()

    @r.post("/terrain")
    def post_terrain(
        file: UploadFile = File(...),
        robot_id: str = Form(...),
        observed_at: str = Form(...),
        rule_class: str = Form("unknown"),
        rule_conf: float | None = Form(None),
        lat: float | None = Form(None),
        lon: float | None = Form(None),
    ):
        s = settings()
        received = datetime.now(timezone.utc)
        try:
            obs = parse_observed_at(observed_at)
        except (ValueError, OverflowError, OSError):
            raise HTTPException(400, "observed_at must be ISO 8601 UTC") from None
        if rule_class not in TERRAIN_CLASSES:
            raise HTTPException(400, f"rule_class must be one of {', '.join(TERRAIN_CLASSES)}")

        age_s = (received - obs).total_seconds()
        if age_s > float(s["terrain_max_age_s"]):
            return JSONResponse({"detail": "frame too old", "age_s": round(age_s, 2)}, status_code=409)

        now = time.monotonic()
        with _state_lock:
            last = _last_accept.get(robot_id)
            if last is not None and now - last < float(s["terrain_min_interval_s"]):
                return JSONResponse({"detail": "at most one terrain frame per second per robot"}, status_code=429)
            _last_accept[robot_id] = now

        data = file.file.read(int(s["terrain_max_bytes"]) + 1)
        if not data or len(data) > int(s["terrain_max_bytes"]):
            raise HTTPException(400, "empty or oversized image")
        try:
            image = to_pil(data)
        except Exception:
            raise HTTPException(400, "could not decode image") from None

        from perception import media  # lazy: written by another module

        saved = media.save_bytes(
            data,
            ext=_ext_for(file.filename),
            kind="terrain",
            robot_id=robot_id,
            original_filename=file.filename,
        )

        t0 = time.perf_counter()
        cls, conf, source = classify_detailed(image, s)
        latency_ms = round(1000 * (time.perf_counter() - t0), 1)

        hint_on = bool(s["terrain_hint_enabled"])
        out_cls, out_conf = (cls, conf) if hint_on else ("unknown", 0.0)
        fused = fuse(rule_class, cls, conf if hint_on else 0.0, rule_conf if rule_conf is not None else 1.0)
        record = {
            "robot_id": robot_id,
            "terrain_class": cls,
            "confidence": conf,
            "model": source,
            "suggested_action": SUGGESTED_ACTION[cls],
            "hint_enabled": hint_on,
            "rule_class": rule_class,
            "fused": fused,
            "observed_at": observed_at,
            "received_at": received.isoformat().replace("+00:00", "Z"),
            "image_url": saved.get("url"),
            "latency_ms": latency_ms,
        }
        with _state_lock:
            _latest[robot_id] = record
        if s.get("terrain_frames_csv"):
            try:
                _log_frame(
                    s["terrain_frames_csv"],
                    {
                        "image_name": saved.get("name", ""),
                        "run_id": run_id_from_name(saved.get("name", "")),
                        "robot_id": robot_id,
                        "rule_class": rule_class,
                        "observed_at": observed_at,
                        "camera_class": cls,
                        "camera_conf": conf,
                    },
                )
            except OSError as exc:
                log.warning("could not append to the terrain frames list: %s", exc)

        if s["terrain_write_db"] and hint_on:
            try:
                obs_iso = obs.isoformat().replace("+00:00", "Z")
                _write_db(robot_id, lat, lon, cls, conf, SUGGESTED_ACTION[cls], saved.get("url"), obs_iso)
            except Exception as exc:
                log.warning("report_terrain failed: %s", exc)

        return {"terrain_class": out_cls, "confidence": out_conf, "observed_at": observed_at}

    @r.get("/terrain/latest")
    def get_latest(robot_id: str | None = None):
        rows = latest()
        if robot_id is not None:
            if robot_id not in rows:
                raise HTTPException(404, "no terrain result for this robot")
            return rows[robot_id]
        return rows

    return r


router = _build_router()
