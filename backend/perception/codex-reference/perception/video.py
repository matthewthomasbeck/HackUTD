"""Bounded video decoding and acquisition-quality measurements."""

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


class ClipReadError(ValueError):
    """The source could not be decoded, distinct from invalid caller settings."""


@dataclass
class Video:
    frames: np.ndarray
    samples: list
    fps: float
    duration_s: float
    original_shape: tuple
    warnings: list
    mean: float
    noise_sigma: float


def read_clip(path, fps=None, config=None):
    cfg = config or {}
    capture = cv2.VideoCapture(str(Path(path)))
    if not capture.isOpened():
        capture.release()
        raise ClipReadError("clip unreadable")
    warnings = []
    container_fps = capture.get(cv2.CAP_PROP_FPS)
    rate = float(fps) if fps is not None else container_fps
    if fps is not None and (not np.isfinite(rate) or rate <= 0):
        capture.release()
        raise ValueError("frame rate invalid")
    if fps is None and (not np.isfinite(rate) or not 5 <= rate <= 120):
        rate = float(cfg.get("default_fps", 30))
        warnings.append("fps assumed")
    maximum = float(cfg.get("max_duration_s", 30))
    total = capture.get(cv2.CAP_PROP_FRAME_COUNT)
    start = max(0, int((total - maximum * rate) / 2)) if total > 0 else 0
    if start:
        capture.set(cv2.CAP_PROP_POS_FRAMES, start)
    frames, samples = [], []
    sample_indices = set(np.linspace(0, min(maximum * rate, total or maximum * rate) - 1,
                                         int(cfg.get("yolo_frames", 5))).astype(int))
    original_shape = None
    try:
        for index in range(int(maximum * rate)):
            ok, color = capture.read()
            if not ok:
                break
            original_shape = color.shape[:2]
            if index in sample_indices:
                samples.append(color.copy())
            gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
            factor = min(1.0, 640 / gray.shape[1], 480 / gray.shape[0])
            if factor < 1:
                gray = cv2.resize(gray, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
            frames.append(gray)
        if not frames:
            raise ClipReadError("clip unreadable")
        if not samples:
            samples = [cv2.cvtColor(frames[len(frames) // 2], cv2.COLOR_GRAY2BGR)]
    finally:
        capture.release()
    values = np.stack(frames)
    noise = []
    for index in np.linspace(0, len(values) - 2, min(20, len(values) - 1)).astype(int):
        difference = ((values[index + 1].astype(np.float32) - values[index]) / np.sqrt(2)).astype(np.float32)
        # Subtract local structure instead of smoothing away the noise to be measured.
        residual = difference - cv2.medianBlur(difference, 5)
        noise.append(float(np.std(residual)))
    return Video(values, samples, rate, len(values) / rate, original_shape, warnings,
                 float(values.mean()), float(np.median(noise)) if noise else 0.0)
