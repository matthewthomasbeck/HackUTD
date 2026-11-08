"""Step 1 of the breathing pipeline: read a clip (docs/specs/perception.md section 4).

read_clip() returns a Clip with:
- gray: every frame as grayscale, downscaled so the width is at most signal_max_w
  (the signals in breathing.py use these),
- samples: yolo_frames full-resolution color frames, evenly spaced (for YOLO and roi.jpg),
- fps, duration_s, the darkness and noise measures, warnings,
- reason: None when the clip passed every step 1 gate, else the exact reason string.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

# Defaults from the [breathing] table in perception.md section 4.
# signal_max_w is not in the spec table: it caps the width of the frames kept for
# the signals, so a 1080p clip does not need gigabytes of memory.
DEFAULTS = {
    "default_fps": 30,
    "min_fps": 10,
    "min_duration_s": 15,
    "max_duration_s": 30,
    "yolo_frames": 5,
    "clip_dark_mean_min": 40,
    "clip_noise_max": 6,
    "signal_max_w": 640,
}

REASON_UNREADABLE = "clip unreadable"
REASON_TOO_SHORT = "clip too short"
REASON_FPS_LOW = "frame rate too low"
REASON_TOO_DARK = "clip too dark, needs light"
REASON_TOO_NOISY = "clip too noisy (low light)"
WARN_FPS_ASSUMED = "fps assumed"

NOISE_PAIRS = 20
COLOR_KEEP_MAX = 64


@dataclass
class Clip:
    gray: np.ndarray | None = None  # (T, h, w) uint8, downscaled
    scale: float = 1.0  # downscaled size / full-resolution size
    full_size: tuple[int, int] = (0, 0)  # (width, height) at full resolution
    samples: list[np.ndarray] = field(default_factory=list)  # full-res BGR frames
    fps: float = 0.0
    n_frames: int = 0
    duration_s: float = 0.0
    frame_mean: float | None = None
    noise_sigma: float | None = None
    warnings: list[str] = field(default_factory=list)
    reason: str | None = None

    @property
    def middle(self) -> np.ndarray | None:
        """The middle full-resolution sample frame (BGR), used for the ROI checks and roi.jpg."""
        if not self.samples:
            return None
        return self.samples[len(self.samples) // 2]


def merge_cfg(cfg: dict | None) -> dict:
    out = dict(DEFAULTS)
    if cfg:
        out.update(cfg)
    return out


def pick_fps(form_fps: float | None, container_fps: float, cfg: dict) -> tuple[float, list[str]]:
    """The fps rule: form field, else the container if between 5 and 120, else default_fps."""
    if form_fps is not None and form_fps > 0:
        return float(form_fps), []
    if container_fps and 5 <= container_fps <= 120:
        return float(container_fps), []
    return float(cfg["default_fps"]), [WARN_FPS_ASSUMED]


def estimate_noise(gray: np.ndarray, pairs: int = NOISE_PAIRS) -> float:
    """Median over sampled frame pairs of std((f[t+1] - f[t]) / sqrt(2)).

    A 5 by 5 median filter of the difference image is subtracted first, so real
    edges (motion) do not count as noise; what is left is the pixel noise.
    """
    n = gray.shape[0]
    if n < 2:
        return 0.0
    starts = np.unique(np.linspace(0, n - 2, num=min(pairs, n - 1)).astype(int))
    sigmas = []
    for t in starts:
        d = gray[t + 1].astype(np.float32) - gray[t].astype(np.float32)
        d_hp = d - cv2.medianBlur(d, 5)
        sigmas.append(float(np.std(d_hp)) / math.sqrt(2.0))
    return float(np.median(sigmas))


def read_clip(path: str, fps: float | None = None, cfg: dict | None = None) -> Clip:
    cfg = merge_cfg(cfg)
    clip = Clip()
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        clip.reason = REASON_UNREADABLE
        return clip
    container_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    clip.fps, clip.warnings = pick_fps(fps, container_fps, cfg)

    # Read every frame: color frames are kept only until we know which to sample,
    # so store the downscaled gray frames plus the full-res color frames' indices later.
    gray_frames = []
    # Full-res color frames are kept only for a thinned set of frame indices, so a long
    # high-resolution clip does not fill memory: when more than COLOR_KEEP_MAX are held,
    # every other one is dropped and the keep stride doubles.
    color_kept: dict[int, np.ndarray] = {}
    stride = 1
    scale = 1.0
    while True:
        ok, frame = cap.read()
        if not ok or frame is None:
            break
        if frame.ndim == 2:
            frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
        if not gray_frames:
            h, w = frame.shape[:2]
            clip.full_size = (w, h)
            scale = min(1.0, float(cfg["signal_max_w"]) / float(w))
        g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if scale < 1.0:
            g = cv2.resize(g, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        i = len(gray_frames)
        gray_frames.append(g)
        if i % stride == 0:
            color_kept[i] = frame
            if len(color_kept) > COLOR_KEEP_MAX:
                stride *= 2
                color_kept = {j: f for j, f in color_kept.items() if j % stride == 0}
    cap.release()

    if not gray_frames:
        clip.reason = REASON_UNREADABLE
        return clip

    n = len(gray_frames)
    duration = n / clip.fps
    # Longer than max_duration_s: keep the middle max_duration_s.
    max_n = int(round(float(cfg["max_duration_s"]) * clip.fps))
    start = 0
    if n > max_n > 0:
        start = (n - max_n) // 2
        gray_frames = gray_frames[start:start + max_n]
        n = len(gray_frames)
        duration = n / clip.fps

    clip.scale = scale
    clip.n_frames = n
    clip.duration_s = round(duration, 3)
    k = max(1, int(cfg["yolo_frames"]))
    targets = np.linspace(start, start + n - 1, num=min(k, n))
    kept = np.array(sorted(j for j in color_kept if start <= j < start + n))
    if kept.size == 0:
        kept = np.array(sorted(color_kept))
    chosen = []
    for t in targets:
        j = int(kept[np.argmin(np.abs(kept - t))])
        if j not in chosen:
            chosen.append(j)
    clip.samples = [color_kept[j] for j in chosen]
    del color_kept
    clip.gray = np.stack(gray_frames).astype(np.uint8)
    del gray_frames

    # Gates, in a fixed order; the first that fails gives the reason.
    if duration < float(cfg["min_duration_s"]):
        clip.reason = REASON_TOO_SHORT
        return clip
    if clip.fps < float(cfg["min_fps"]):
        clip.reason = REASON_FPS_LOW
        return clip
    clip.frame_mean = float(clip.gray.mean())
    if clip.frame_mean < float(cfg["clip_dark_mean_min"]):
        clip.reason = REASON_TOO_DARK
        return clip
    clip.noise_sigma = estimate_noise(clip.gray)
    if clip.noise_sigma > float(cfg["clip_noise_max"]):
        clip.reason = REASON_TOO_NOISY
        return clip
    return clip
