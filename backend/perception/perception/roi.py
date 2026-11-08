"""Step 2 of the breathing pipeline: the chest region (docs/specs/perception.md section 4),
the visibility estimate (section 5), and the person check on a camera still.

Rectangles are (x, y, w, h) in full-resolution pixels. Boxes from YOLO are [x1, y1, x2, y2].

Chest ROI sources, first that succeeds wins:
  operator  the roi given by the caller
  pose      YOLO pose keypoints (shoulders 5, 6 and hips 11, 12)
  box       YOLO person box without usable keypoints
  center    a fixed center region

If ultralytics is not importable, or the weights fail to load, or yolo_enabled is false,
pose and box give nothing and the pipeline falls back to center.
"""

from __future__ import annotations

import math
import os
import threading
import time
from pathlib import Path

import cv2
import numpy as np

_PKG_ROOT = Path(__file__).resolve().parent.parent  # backend/perception

# Defaults from the [breathing] table in perception.md section 4. Keys not in that table:
# yolo_fallback_model, yolo_weights_dir, yolo_enabled, chest_visible_k (test-only override).
DEFAULTS = {
    "yolo_model": "yolo26n-pose.pt",
    "yolo_fallback_model": "yolo11n-pose.pt",
    "yolo_weights_dir": str(_PKG_ROOT / "data" / "weights"),
    "yolo_enabled": True,
    "yolo_conf": 0.25,
    "kp_conf": 0.5,
    "person_confirm_conf": 0.5,
    "chest_width_factor": 1.1,
    "center_roi_frac": 0.4,
    "min_roi_px": 40,
    "sat_frac_max": 0.2,
    "dark_mean_min": 8,
    "tex_min": 4,
    "chest_visible_k": None,
}

# COCO keypoint indices.
L_SHOULDER, R_SHOULDER, L_HIP, R_HIP = 5, 6, 11, 12
TORSO_KPS = (L_SHOULDER, R_SHOULDER, L_HIP, R_HIP)
FACE_KPS = (0, 1, 2, 3, 4)  # nose, eyes, ears
N_KPS = 17

BG_STRIP_FRAC = 0.15  # border strip depth for the background ROI
K_BY_SOURCE = {"operator": 0.8, "box": 0.5, "center": 0.4}

REASON_TOO_SMALL = "chest region too small"
REASON_OVEREXPOSED = "chest region overexposed (glare from the robot light)"
REASON_TOO_DARK = "chest region too dark"
REASON_NO_TEXTURE = "no texture on chest region"
WARN_BG_UNAVAILABLE = "background gate unavailable"

# Colors for drawing (BGR).
WHITE, GREEN, BLUE, YELLOW = (255, 255, 255), (0, 255, 0), (255, 0, 0), (0, 255, 255)

# ---------------------------------------------------------------------------
# YOLO model, loaded once per process.

_model = None
_model_name: str | None = None
_load_tried = False
_load_lock = threading.Lock()


def merge_cfg(cfg: dict | None) -> dict:
    out = dict(DEFAULTS)
    if cfg:
        out.update(cfg)
    return out


def _weights_path(name: str, cfg: dict) -> str:
    """An existing path is used as is; a bare name lives in yolo_weights_dir (downloaded there on first use)."""
    if os.path.sep in name or os.path.exists(name):
        return name
    d = Path(cfg["yolo_weights_dir"])
    d.mkdir(parents=True, exist_ok=True)
    return str(d / name)


def load_model(cfg: dict | None = None):
    """Load the pose model once (yolo_model, else yolo_fallback_model). Returns the model or None."""
    global _model, _model_name, _load_tried
    cfg = merge_cfg(cfg)
    if not cfg["yolo_enabled"]:
        return None
    with _load_lock:
        if _load_tried:
            return _model
        _load_tried = True
        try:
            from ultralytics import YOLO
        except Exception:
            return None
        for name in (cfg["yolo_model"], cfg["yolo_fallback_model"]):
            if not name:
                continue
            try:
                _model = YOLO(_weights_path(name, cfg))
                _model_name = name
                return _model
            except Exception:
                _model = None
        return None


def yolo_loaded() -> bool:
    """True when the pose model is loaded. Does not load it; call load_model() at startup."""
    return _model is not None


def loaded_model_name() -> str | None:
    return _model_name


def _best_detection(result):
    """(box xyxy, box conf, keypoints xy (17, 2), keypoint conf (17,)) of the highest-confidence box, or None."""
    boxes = getattr(result, "boxes", None)
    if boxes is None or len(boxes) == 0:
        return None
    confs = boxes.conf.cpu().numpy()
    i = int(np.argmax(confs))
    box = boxes.xyxy.cpu().numpy()[i].astype(float)
    kxy = np.full((N_KPS, 2), np.nan)
    kconf = np.zeros(N_KPS)
    kps = getattr(result, "keypoints", None)
    if kps is not None and kps.xy is not None and len(kps.xy) > i:
        kxy = kps.xy.cpu().numpy()[i].astype(float)
        if kps.conf is not None:
            kconf = kps.conf.cpu().numpy()[i].astype(float)
        else:
            kconf = np.where(np.isfinite(kxy).all(axis=1), 1.0, 0.0)
    return box, float(confs[i]), kxy, kconf


def run_pose(frames_bgr: list[np.ndarray], cfg: dict | None = None) -> dict | None:
    """YOLO pose on the sample frames, combined over frames.

    Returns None when there is no model or no person in any frame. Else:
    box (median of each coordinate), box_conf (median), kp_xy (17, 2) median position over
    frames where that keypoint's confidence is at least kp_conf (nan if none), kp_conf (17,)
    median confidence over frames with a person, n_frames (frames with a person).
    """
    cfg = merge_cfg(cfg)
    model = load_model(cfg)
    if model is None or not frames_bgr:
        return None
    results = model(list(frames_bgr), conf=float(cfg["yolo_conf"]), verbose=False)
    boxes, bconfs, kxys, kconfs = [], [], [], []
    for r in results:
        det = _best_detection(r)
        if det is None:
            continue
        boxes.append(det[0])
        bconfs.append(det[1])
        kxys.append(det[2])
        kconfs.append(det[3])
    if not boxes:
        return None
    kxys = np.stack(kxys)  # (F, 17, 2)
    kconfs = np.stack(kconfs)  # (F, 17)
    kp_xy = np.full((N_KPS, 2), np.nan)
    for j in range(N_KPS):
        good = kconfs[:, j] >= float(cfg["kp_conf"])
        if good.any():
            kp_xy[j] = np.median(kxys[good, j, :], axis=0)
    return {
        "box": np.median(np.stack(boxes), axis=0).tolist(),
        "box_conf": float(np.median(bconfs)),
        "kp_xy": kp_xy,
        "kp_conf": np.median(kconfs, axis=0),
        "n_frames": len(boxes),
    }


# ---------------------------------------------------------------------------
# Rectangle helpers.


def clamp_rect(rect, size) -> tuple[int, int, int, int]:
    """Clamp (x, y, w, h) to a frame of size (width, height)."""
    W, H = size
    x, y, w, h = rect
    x0 = int(max(0, min(W, math.floor(x))))
    y0 = int(max(0, min(H, math.floor(y))))
    x1 = int(max(0, min(W, math.ceil(x + w))))
    y1 = int(max(0, min(H, math.ceil(y + h))))
    return (x0, y0, max(0, x1 - x0), max(0, y1 - y0))


def box_to_rect(box) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = box
    return (x1, y1, x2 - x1, y2 - y1)


def grow_rect(rect, frac: float, size) -> tuple[int, int, int, int]:
    """Grow (x, y, w, h) by frac of its size in total (half on each side), clamped."""
    x, y, w, h = rect
    return clamp_rect((x - w * frac / 2, y - h * frac / 2, w * (1 + frac), h * (1 + frac)), size)


def subtract_rect(rect, excl) -> tuple[int, int, int, int]:
    """The largest axis-aligned piece of rect that lies outside excl."""
    x, y, w, h = rect
    ex, ey, ew, eh = excl
    ix0, iy0 = max(x, ex), max(y, ey)
    ix1, iy1 = min(x + w, ex + ew), min(y + h, ey + eh)
    if ix0 >= ix1 or iy0 >= iy1:
        return rect
    pieces = [
        (x, y, ix0 - x, h),  # left of the overlap
        (ix1, y, x + w - ix1, h),  # right
        (x, y, w, iy0 - y),  # above
        (x, iy1, w, y + h - iy1),  # below
    ]
    best = max(pieces, key=lambda r: max(0, r[2]) * max(0, r[3]))
    return (best[0], best[1], max(0, best[2]), max(0, best[3]))


def rect_pixels(gray: np.ndarray, rect) -> np.ndarray:
    x, y, w, h = rect
    return gray[y:y + h, x:x + w]


# ---------------------------------------------------------------------------
# Chest ROI builders.


def _visible(pose: dict, j: int, kp_conf: float) -> bool:
    return bool(pose["kp_conf"][j] >= kp_conf and np.isfinite(pose["kp_xy"][j]).all())


def chest_from_pose(pose: dict, size, cfg: dict):
    """Chest ROI from keypoints: (rect, torso axis unit vector) or None.

    Needs both shoulders, or one shoulder plus one hip. Torso axis from the shoulder
    midpoint S to the hip midpoint H; the ROI covers S to S + 0.6 (H - S), widened to
    chest_width_factor times the shoulder width, as an image-aligned rectangle.
    """
    kc = float(cfg["kp_conf"])
    xy = pose["kp_xy"]
    shoulders = [j for j in (L_SHOULDER, R_SHOULDER) if _visible(pose, j, kc)]
    hips = [j for j in (L_HIP, R_HIP) if _visible(pose, j, kc)]
    if len(shoulders) == 2:
        S = (xy[L_SHOULDER] + xy[R_SHOULDER]) / 2
        sw = float(np.linalg.norm(xy[L_SHOULDER] - xy[R_SHOULDER]))
    elif len(shoulders) == 1 and hips:
        S = xy[shoulders[0]].copy()
        sw = None  # set from the torso length below
    else:
        return None
    if len(hips) == 2:
        H = (xy[L_HIP] + xy[R_HIP]) / 2
    elif len(hips) == 1:
        H = xy[hips[0]].copy()
    else:
        # Hips hidden: H = S + 1.2 * shoulder width, perpendicular to the shoulder line, away
        # from the face if any face keypoint is visible, else toward the box center, else down.
        # Not the box's long axis: a torso that fills a wide frame gives a wide box although the
        # person is upright (MPSC-RR front clips, A3 review 2026-11-08).
        v = xy[R_SHOULDER] - xy[L_SHOULDER]
        u = np.array([-v[1], v[0]]) / max(float(np.linalg.norm(v)), 1e-9)
        face = [xy[j] for j in FACE_KPS if _visible(pose, j, kc)]
        if face:
            toward = S - np.mean(face, axis=0)
        else:
            bx, by, bw, bh = box_to_rect(pose["box"])
            toward = np.array([bx + bw / 2, by + bh / 2]) - S
        side = float(np.dot(u, toward))
        if abs(side) < 1e-6:
            side = u[1]  # no cue: the image-down side
        if side < 0:
            u = -u
        H = S + 1.2 * sw * u
    d = H - S
    L = float(np.linalg.norm(d))
    if L < 1.0:
        return None
    if sw is None:
        # One shoulder plus one hip: estimate the shoulder width from the torso length,
        # using the same 1.2 ratio the spec uses when the hips are missing (inference).
        sw = L / 1.2
    if sw < 1.0:
        return None
    u = d / L
    n = np.array([-u[1], u[0]])
    E = S + 0.6 * d
    hw = float(cfg["chest_width_factor"]) * sw / 2
    corners = np.array([S + n * hw, S - n * hw, E + n * hw, E - n * hw])
    x0, y0 = corners.min(axis=0)
    x1, y1 = corners.max(axis=0)
    return clamp_rect((x0, y0, x1 - x0, y1 - y0), size), (float(u[0]), float(u[1]))


def chest_from_box(box, size):
    """Chest ROI from the person box: upright, lying (wider by more than 1.3), or other."""
    x, y, w, h = box_to_rect(box)
    if w <= 0 or h <= 0:
        return None
    if h > w:
        fx, fy = (0.25, 0.75), (0.20, 0.55)
    elif w > 1.3 * h:
        fx, fy = (0.30, 0.70), (0.25, 0.75)
    else:
        fx, fy = (0.25, 0.75), (0.25, 0.75)
    return clamp_rect((x + fx[0] * w, y + fy[0] * h, (fx[1] - fx[0]) * w, (fy[1] - fy[0]) * h), size)


def center_roi(size, cfg: dict):
    W, H = size
    f = float(cfg["center_roi_frac"])
    return clamp_rect(((1 - f) / 2 * W, (1 - f) / 2 * H, f * W, f * H), size)


def background_roi(gray: np.ndarray, exclusions: list, cfg: dict):
    """The border strip (15% deep) with the highest pixel std, outside the exclusions.

    Returns (rect, std) or (None, best std) when no strip has std of at least tex_min.
    """
    H, W = gray.shape[:2]
    dh, dw = int(round(BG_STRIP_FRAC * H)), int(round(BG_STRIP_FRAC * W))
    strips = [(0, 0, W, dh), (0, H - dh, W, dh), (0, 0, dw, H), (W - dw, 0, dw, H)]
    best, best_std = None, -1.0
    for s in strips:
        r = s
        for e in exclusions:
            if e is not None:
                r = subtract_rect(r, e)
        if r[2] < 8 or r[3] < 8:
            continue
        sd = float(np.std(rect_pixels(gray, r)))
        if sd > best_std:
            best, best_std = r, sd
    if best is None or best_std < float(cfg["tex_min"]):
        return None, max(best_std, 0.0)
    return tuple(int(v) for v in best), best_std


# ---------------------------------------------------------------------------
# Selection, checks, drawing.


def visibility_from_pose(pose: dict | None, cfg: dict):
    """(visibility_pct, visibility_source). None and "none" when no person or no visible keypoint (never 0)."""
    if pose is None:
        return None, "none"
    n_vis = int(np.sum(pose["kp_conf"] >= float(cfg["kp_conf"])))
    if n_vis == 0:
        return None, "none"
    return round(100.0 * n_vis / N_KPS, 1), "pose"


def select_roi(samples_bgr: list[np.ndarray], roi=None, cfg: dict | None = None) -> dict:
    """Pick the chest ROI, background ROI, k, and visibility for a clip's sample frames."""
    cfg = merge_cfg(cfg)
    middle = samples_bgr[len(samples_bgr) // 2]
    H, W = middle.shape[:2]
    size = (W, H)
    warnings: list[str] = []

    t0 = time.perf_counter()
    pose = run_pose(samples_bgr, cfg) if cfg["yolo_enabled"] else None
    yolo_ms = int(round((time.perf_counter() - t0) * 1000))

    chest, axis, source = None, None, None
    if roi is not None:
        chest, source = clamp_rect(tuple(float(v) for v in roi), size), "operator"
    if chest is None and pose is not None:
        got = chest_from_pose(pose, size, cfg)
        if got is not None:
            (chest, axis), source = got, "pose"
    if chest is None and pose is not None:
        got = chest_from_box(pose["box"], size)
        if got is not None:
            chest, source = got, "box"
    if chest is None:
        chest, source = center_roi(size, cfg), "center"

    if source == "pose":
        kc = float(cfg["kp_conf"])
        k = sum(1 for j in TORSO_KPS if pose["kp_conf"][j] >= kc) / 4.0
    else:
        k = K_BY_SOURCE[source]
    if cfg.get("chest_visible_k") is not None:
        k = float(cfg["chest_visible_k"])

    vis_pct, vis_src = visibility_from_pose(pose, cfg)

    person_rect = clamp_rect(box_to_rect(pose["box"]), size) if pose is not None else None
    gray_mid = cv2.cvtColor(middle, cv2.COLOR_BGR2GRAY)
    bg, _ = background_roi(gray_mid, [person_rect, grow_rect(chest, 0.5, size)], cfg)
    if bg is None:
        warnings.append(WARN_BG_UNAVAILABLE)

    keypoints = None
    if pose is not None:
        keypoints = [
            [None if not np.isfinite(pose["kp_xy"][j][0]) else round(float(pose["kp_xy"][j][0]), 1),
             None if not np.isfinite(pose["kp_xy"][j][1]) else round(float(pose["kp_xy"][j][1]), 1),
             round(float(pose["kp_conf"][j]), 3)]
            for j in range(N_KPS)
        ]
    return {
        "roi_source": source,
        "chest": tuple(int(v) for v in chest),
        "axis": axis,
        "person_box": [round(float(v), 1) for v in pose["box"]] if pose is not None else None,
        "person_conf": round(pose["box_conf"], 3) if pose is not None else 0.0,
        "keypoints": keypoints,
        "k": float(k),
        "visibility_pct": vis_pct,
        "visibility_source": vis_src,
        "background": bg,
        "warnings": warnings,
        "yolo_ms": yolo_ms,
        "frame_size": size,
    }


def check_roi(middle_bgr: np.ndarray, chest, cfg: dict | None = None) -> str | None:
    """The ROI checks of step 2, in order; returns the reason string or None."""
    cfg = merge_cfg(cfg)
    x, y, w, h = chest
    m = int(cfg["min_roi_px"])
    if w < m or h < m:
        return REASON_TOO_SMALL
    gray = cv2.cvtColor(middle_bgr, cv2.COLOR_BGR2GRAY) if middle_bgr.ndim == 3 else middle_bgr
    px = rect_pixels(gray, chest).astype(np.float32)
    if float(np.mean(px >= 250)) > float(cfg["sat_frac_max"]):
        return REASON_OVEREXPOSED
    mean, sd = float(px.mean()), float(px.std())
    if mean < float(cfg["dark_mean_min"]) and sd < float(cfg["tex_min"]):
        return REASON_TOO_DARK
    if sd < float(cfg["tex_min"]):
        return REASON_NO_TEXTURE
    return None


def _draw_keypoints(img, keypoints, kp_conf: float):
    if not keypoints:
        return
    for x, y, c in keypoints:
        if x is None or y is None or c < kp_conf:
            continue
        cv2.circle(img, (int(round(x)), int(round(y))), 4, YELLOW, -1)


def _draw_rect(img, rect, color, thick=2):
    x, y, w, h = (int(v) for v in rect)
    cv2.rectangle(img, (x, y), (x + w, y + h), color, thick)


def draw_roi(middle_bgr: np.ndarray, sel: dict, out_path: str, cfg: dict | None = None) -> None:
    """roi.jpg: person box white, chest ROI green, background ROI blue, keypoints, roi_source text."""
    cfg = merge_cfg(cfg)
    img = middle_bgr.copy()
    if sel.get("person_box"):
        _draw_rect(img, box_to_rect(sel["person_box"]), WHITE)
    if sel.get("background"):
        _draw_rect(img, sel["background"], BLUE)
    if sel.get("chest"):
        _draw_rect(img, sel["chest"], GREEN)
    _draw_keypoints(img, sel.get("keypoints"), float(cfg["kp_conf"]))
    cv2.putText(img, str(sel.get("roi_source")), (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, GREEN, 2, cv2.LINE_AA)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), img)


def confirm_person(image_path: str, out_path: str, cfg: dict | None = None) -> dict:
    """Person check on a camera still (display only; never changes breathing or the score).

    Returns person_confirmed, person_conf (0 when no person), box ([x1, y1, x2, y2] or None),
    and draws the still with the box (white), keypoints at or above kp_conf, and "person <conf>".
    """
    cfg = merge_cfg(cfg)
    out = {"person_confirmed": False, "person_conf": 0.0, "box": None}
    img = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if img is None:
        out["error"] = "image unreadable"
        return out
    model = load_model(cfg)
    keypoints = None
    if model is not None:
        results = model([img], conf=float(cfg["yolo_conf"]), verbose=False)
        det = _best_detection(results[0]) if results else None
        if det is not None:
            box, conf, kxy, kconf = det
            out["person_conf"] = round(conf, 3)
            out["box"] = [round(float(v), 1) for v in box]
            keypoints = [[float(kxy[j][0]), float(kxy[j][1]), float(kconf[j])]
                         for j in range(len(kconf)) if np.isfinite(kxy[j]).all()]
    else:
        out["warning"] = "person model not loaded"
    out["person_confirmed"] = bool(out["person_conf"] >= float(cfg["person_confirm_conf"]))
    drawn = img.copy()
    if out["box"]:
        _draw_rect(drawn, box_to_rect(out["box"]), WHITE)
    _draw_keypoints(drawn, keypoints, float(cfg["kp_conf"]))
    cv2.putText(drawn, f"person {out['person_conf']:.2f}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, WHITE, 2,
                cv2.LINE_AA)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), drawn)
    return out
