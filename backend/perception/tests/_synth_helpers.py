"""Shared helpers for the tests: load scripts/make_synthetic.py and write small clips."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent  # backend/perception


def load_script(name: str):
    path = ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"_script_{name}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


synth = load_script("make_synthetic")

# YOLO stays off in the synthetic tests so they do not depend on the model (perception.md section 10).
NO_YOLO = {"yolo_enabled": False}


def write_frames(path, frames, fps: float, codec: str = "FFV1") -> str:
    """Write gray uint8 frames (T, h, w) as a lossless 3-channel clip."""
    frames = np.asarray(frames, dtype=np.uint8)
    h, w = frames.shape[1:]
    wr = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*codec), fps, (w, h), True)
    assert wr.isOpened(), f"cannot write {path}"
    for f in frames:
        wr.write(cv2.cvtColor(f, cv2.COLOR_GRAY2BGR))
    wr.release()
    return str(path)


def textured_frames(n: int, size=(96, 72), mean=120.0, std=25.0, noise=2.0, seed=0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    w, h = size
    base = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 2.0)
    base = mean + std * (base - base.mean()) / (base.std() + 1e-9)
    out = base[None] + rng.normal(0, noise, (n, h, w)).astype(np.float32)
    return np.clip(np.round(out), 0, 255).astype(np.uint8)
