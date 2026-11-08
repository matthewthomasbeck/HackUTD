"""Step 1 (video.py): fps rule, duration, samples, trimming, and the clip gates."""

from __future__ import annotations

import numpy as np
import pytest

from perception import video

from _synth_helpers import textured_frames, write_frames


def test_fps_rule():
    cfg = video.merge_cfg(None)
    assert video.pick_fps(24.0, 30.0, cfg) == (24.0, [])  # form field wins
    assert video.pick_fps(None, 30.0, cfg) == (30.0, [])  # container if 5..120
    assert video.pick_fps(None, 0.0, cfg) == (30.0, ["fps assumed"])
    assert video.pick_fps(None, 1000.0, cfg) == (30.0, ["fps assumed"])


def test_read_basic(tmp_path):
    p = write_frames(tmp_path / "c.avi", textured_frames(16 * 20), fps=20)
    clip = video.read_clip(p)
    assert clip.reason is None
    assert clip.fps == 20.0 and clip.n_frames == 320 and clip.duration_s == 16.0
    assert clip.gray.shape == (320, 72, 96) and clip.gray.dtype == np.uint8
    assert len(clip.samples) == 5 and clip.samples[0].shape == (72, 96, 3)
    assert clip.middle is clip.samples[2]
    assert clip.noise_sigma == pytest.approx(2.0, abs=0.6)


def test_form_fps_overrides(tmp_path):
    p = write_frames(tmp_path / "c.avi", textured_frames(16 * 20), fps=20)
    clip = video.read_clip(p, fps=16.0)
    assert clip.fps == 16.0 and clip.duration_s == 20.0


def test_too_short(tmp_path):
    p = write_frames(tmp_path / "c.avi", textured_frames(10 * 20), fps=20)
    assert video.read_clip(p).reason == "clip too short"


def test_frame_rate_too_low(tmp_path):
    p = write_frames(tmp_path / "c.avi", textured_frames(20 * 8), fps=8)
    assert video.read_clip(p).reason == "frame rate too low"


def test_too_dark(tmp_path):
    p = write_frames(tmp_path / "c.avi", textured_frames(16 * 20, mean=20, std=5), fps=20)
    assert video.read_clip(p).reason == "clip too dark, needs light"


def test_too_noisy(tmp_path):
    p = write_frames(tmp_path / "c.avi", textured_frames(16 * 20, noise=12), fps=20)
    clip = video.read_clip(p)
    assert clip.reason == "clip too noisy (low light)"
    assert clip.noise_sigma > 6


def test_unreadable(tmp_path):
    assert video.read_clip(str(tmp_path / "missing.mp4")).reason == "clip unreadable"


def test_long_clip_uses_middle(tmp_path):
    n = 40 * 10
    frames = textured_frames(n, size=(48, 36))
    frames[:, 0, 0] = np.arange(n) % 256  # frame index stamp
    p = write_frames(tmp_path / "c.avi", frames, fps=10)
    clip = video.read_clip(p)
    assert clip.n_frames == 300 and clip.duration_s == 30.0
    assert int(clip.gray[0, 0, 0]) == 50  # (400 - 300) // 2


def test_downscale_wide_frames(tmp_path):
    p = write_frames(tmp_path / "c.avi", textured_frames(16 * 10, size=(1280, 720)), fps=10)
    clip = video.read_clip(p)
    assert clip.scale == 0.5 and clip.gray.shape[1:] == (360, 640)
    assert clip.samples[0].shape[:2] == (720, 1280)
    assert clip.full_size == (1280, 720)
