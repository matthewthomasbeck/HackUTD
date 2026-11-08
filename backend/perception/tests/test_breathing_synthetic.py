"""The synthetic clip table of docs/specs/perception.md section 10.

Every clip uses the torso as the operator ROI so the result does not depend on YOLO.
"""

from __future__ import annotations

import json

import pytest

from perception import breathing
from perception.breathing import analyze

from _synth_helpers import NO_YOLO, synth

ROI = synth.TORSO_ROI


@pytest.fixture(scope="module")
def clip_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("synthetic")


_cache: dict = {}


def run_case(clip_dir, name, *, roi=ROI, cfg=None, out_dir=None):
    path = clip_dir / f"{name}.avi"
    if not path.exists():
        synth.make_clip(path, **synth.CASES[name]["params"])
    merged = dict(NO_YOLO)
    merged.update(cfg or {})
    key = (name, roi, json.dumps(merged, sort_keys=True), out_dir)
    if key not in _cache:
        _cache[key] = analyze(str(path), roi=roi, cfg=merged, out_dir=out_dir)
    return _cache[key]


def check_invariants(r):
    assert r["breathing"] in ("detected", "not_detected", "unknown")
    if r["breathing"] != "detected":
        assert r["rate_bpm"] is None
        assert r["breathing_confidence"] <= 0.3
    assert 0.0 <= r["breathing_confidence"] <= 1.0
    assert not breathing.contains_banned_word(r)
    json.dumps(r)  # serializable


@pytest.mark.parametrize("f", [0.15, 0.25, 0.4, 0.6, 0.9])
def test_rate_detected(clip_dir, f):
    r = run_case(clip_dir, f"f{f}")
    check_invariants(r)
    assert r["breathing"] == "detected", r["reasons"]
    assert abs(r["rate_bpm"] - 60 * f) <= 1.5
    assert r["breathing_confidence"] >= 0.5
    assert r["roi_source"] == "operator"


def test_small_amplitude(clip_dir):
    r = run_case(clip_dir, "small_amp")
    check_invariants(r)
    assert r["breathing"] in ("detected", "unknown")
    if r["breathing"] == "detected":
        assert abs(r["rate_bpm"] - 15.0) <= 1.5


@pytest.mark.parametrize("name,reason", [
    ("short", "clip too short"),
    ("sway", "camera or scene moved"),
    ("flicker", "lighting or exposure changed"),
    ("flat_torso", "no texture on chest region"),
    ("dark", "clip too dark, needs light"),
    ("noisy", "clip too noisy (low light)"),
])
def test_gate_reasons(clip_dir, name, reason):
    r = run_case(clip_dir, name)
    check_invariants(r)
    assert r["breathing"] == "unknown"
    assert r["reasons"] == [reason]
    assert r["rate_bpm"] is None


def test_still_visible_torso_not_detected(clip_dir):
    r = run_case(clip_dir, "still", cfg={"chest_visible_k": 1.0})
    check_invariants(r)
    assert r["breathing"] == "not_detected"
    assert r["breathing_confidence"] <= 0.3


def test_still_center_roi_unknown(clip_dir):
    r = run_case(clip_dir, "still", roi=None)
    check_invariants(r)
    assert r["roi_source"] == "center"
    assert r["chest_visible_k"] == 0.4
    assert r["breathing"] == "unknown"


def test_fan_outside_roi(clip_dir):
    r = run_case(clip_dir, "fan")
    check_invariants(r)
    assert r["breathing"] == "detected"
    assert abs(r["rate_bpm"] - 15.0) <= 1.5


def test_irregular_never_confidently_wrong(clip_dir):
    r = run_case(clip_dir, "irregular")
    check_invariants(r)
    mean_bpm = 60 * 0.3  # frequency drifts linearly from 0.2 to 0.4 Hz
    confident_wrong = (r["breathing"] == "detected" and r["breathing_confidence"] > 0.5
                       and abs(r["rate_bpm"] - mean_bpm) > 3)
    assert not confident_wrong


def test_result_shape_and_outputs(clip_dir, tmp_path):
    out = tmp_path / "job"
    r = run_case(clip_dir, "f0.25", out_dir=str(out))
    for key in ("survivor_id", "detection_id", "clip_url", "breathing", "rate_bpm", "breathing_confidence",
                "visibility_pct", "visibility_source", "roi_source", "chest_visible_k", "quality", "reasons",
                "warnings", "fps", "duration_s", "timings_ms", "display_clip_url", "spectrum_url",
                "roi_image_url", "person_image_url", "person_confirmed", "person_conf", "params"):
        assert key in r
    for key in ("concentration", "snr_db", "half_agreement", "flow_agreement", "background_ratio", "flicker_peak"):
        assert key in r["quality"]
    assert set(r["timings_ms"]) == {"read", "yolo", "signals", "evm"}
    assert r["fps"] == 30.0 and r["duration_s"] == 20.0
    # No person (YOLO off): visibility is none, never 0.
    assert r["visibility_pct"] is None and r["visibility_source"] == "none"
    assert r["params"]["band_lo_hz"] == 0.1 and r["params"]["nfft"] == 4096
    assert json.loads((out / "result.json").read_text())["breathing"] == "detected"
    assert (out / "roi.jpg").stat().st_size > 0


def test_unreadable_clip(tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video")
    r = analyze(str(bad), cfg=NO_YOLO)
    check_invariants(r)
    assert r["breathing"] == "unknown" and r["reasons"] == ["clip unreadable"]
    assert r["breathing_confidence"] == 0.0


def test_rescan_rule():
    keep = breathing.rescan_keeps_earlier
    assert keep("detected", "unknown")
    assert keep("not_detected", "unknown")
    assert not keep(None, "unknown")
    assert not keep("unknown", "unknown")
    assert not keep("not_detected", "detected")
    assert not keep("detected", "not_detected")
    assert breathing.REASON_EARLIER_KEPT == "latest clip unclear, earlier result kept"


def test_banned_word_check():
    assert breathing.contains_banned_word({"reasons": ["Deceased"]})
    assert breathing.contains_banned_word(["has no pulse"])
    assert not breathing.contains_banned_word({"reasons": ["breathing unclear"]})
    for s in (breathing.REASON_CAMERA_MOVED, breathing.REASON_LIGHTING, breathing.REASON_BAND_EDGE,
              breathing.REASON_UNCLEAR, breathing.REASON_EARLIER_KEPT):
        assert not breathing.contains_banned_word(s)
