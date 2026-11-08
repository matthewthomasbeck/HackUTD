"""Known-frequency inputs and independent acquisition rejection cases."""

import importlib.util
from pathlib import Path

import pytest
import cv2

from perception.breathing import analyze_clip

spec = importlib.util.spec_from_file_location("make_synthetic",Path(__file__).parents[1]/"scripts/make_synthetic.py")
synthetic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(synthetic)
cv2.setNumThreads(1)


@pytest.fixture
def run_case(tmp_path):
    def run(case="breathing",operator=True,**kwargs):
        row = synthetic.write_clip(tmp_path/f"{case}.avi",case=case,size=(320,240),**kwargs)
        config = {"use_yolo":False}
        if operator:
            config["chest_visible_k"] = 1.0
        return analyze_clip(row["file"],roi=row["roi"] if operator else None,config=config)
    return run


@pytest.mark.parametrize("frequency",[0.15,0.25,0.4,0.6,0.9])
def test_known_rates(run_case,frequency):
    result = run_case(frequency=frequency)
    assert result["breathing"] == "detected",result
    assert abs(result["rate_bpm"]-frequency*60)<=1.5
    assert result["breathing_confidence"]>=0.5


@pytest.mark.parametrize("case,reason",[
    ("sway","camera or scene moved"),("flicker","lighting or exposure changed"),
    ("flat","no texture on chest region"),("dark","clip too dark, needs light"),
    ("noisy","clip too noisy (low light)")])
def test_rejection_cases(run_case,case,reason):
    result = run_case(case=case)
    assert result["breathing"]=="unknown",result
    assert reason in result["reasons"],result
    assert result["rate_bpm"] is None
    assert result["breathing_confidence"]<=0.3


def test_still_visible_chest_and_unknown_center(run_case):
    visible = run_case(case="still")
    assert visible["breathing"]=="not_detected",visible
    assert visible["breathing_confidence"]<=0.3
    center = run_case(case="still",operator=False)
    assert center["breathing"]=="unknown",center


def test_short_clip(run_case):
    result = run_case(duration=12)
    assert result["breathing"]=="unknown"
    assert result["reasons"]==["clip too short"]


def test_small_motion_can_abstain(run_case):
    result = run_case(amplitude=0.3)
    assert result["breathing"] in ("detected","unknown")
    if result["breathing"]=="detected":
        assert abs(result["rate_bpm"]-15)<=1.5


def test_fan_outside_roi(run_case):
    result = run_case(case="fan")
    assert result["breathing"]=="detected",result
    assert abs(result["rate_bpm"]-15)<=1.5


def test_irregular_never_confidently_wrong(run_case):
    result = run_case(case="irregular")
    assert not(result["breathing"]=="detected" and result["breathing_confidence"]>0.5
               and abs(result["rate_bpm"]-18)>3),result


def test_unreadable_video(tmp_path):
    result = analyze_clip(tmp_path/"missing.mp4",config={"use_yolo":False})
    assert result["breathing"]=="unknown"
    assert result["reasons"]==["clip unreadable"]


def test_configuration_error_not_mislabeled_unreadable():
    with pytest.raises(ValueError,match="filter band"):
        analyze_clip("unused.mp4",config={"band_lo_hz":2,"band_hi_hz":1})


def test_internal_processing_error_not_mislabeled_unreadable(monkeypatch):
    def fail(*args,**kwargs):
        raise ValueError("internal processing failure")
    monkeypatch.setattr("perception.breathing.read_clip",fail)
    with pytest.raises(ValueError,match="internal processing failure"):
        analyze_clip("unused.mp4")
