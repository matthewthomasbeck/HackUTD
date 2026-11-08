"""Keep A2's tuning split and acceptance rule honest without public downloads."""
import json

import pytest

from _synth_helpers import load_script, synth

audit = load_script("audit_quality_gates")


def test_selection_requires_nuisance_rejection_and_labelled_rate():
    good = [{"source": "vrwi", "abs_error_bpm": 0.2},
            {"source": "synthetic", "expect_met": True}]
    assert audit.eligible(good)
    assert not audit.eligible([])
    assert not audit.eligible(good + [{"source": "vrwi"}])
    assert not audit.eligible(good + [{"source": "vrwi", "abs_error_bpm": 4}])
    assert not audit.eligible(good + [{"source": "synthetic", "expect_met": False}])


def test_development_never_reads_held_out_results_and_cannot_refreeze(tmp_path, monkeypatch):
    cases = [{"source": "vrwi", "window": w} for w in audit.DEV + audit.HELD]
    monkeypatch.setattr(audit, "checked_cases", lambda: (cases, []))
    monkeypatch.setattr(audit.bench, "synthetic_cases", lambda *_: [])
    seen = []

    def run(cases, cfg, variant):
        seen.extend(c["window"] for c in cases)
        return [{"source": "vrwi", "abs_error_bpm": 0.2, "mode": "reference",
                 "result": "detected", "confidence": 0.4, "abstained": False,
                 "truth_bpm": 15, "reason": None}]

    monkeypatch.setattr(audit, "run", run)
    audit.main(["develop", "--out-dir", str(tmp_path)])
    assert seen == list(audit.DEV)
    frozen = json.loads((tmp_path / "quality-gates-development.json").read_text())
    assert frozen["selected_overrides"] == {"flicker_c_max": 0.5}
    with pytest.raises(FileExistsError):
        audit.main(["develop", "--out-dir", str(tmp_path)])


def test_evaluation_requires_frozen_development(tmp_path, monkeypatch):
    monkeypatch.setattr(audit, "checked_cases", lambda: ([], []))
    with pytest.raises(FileNotFoundError):
        audit.main(["evaluate", "--out-dir", str(tmp_path)])


@pytest.mark.parametrize("name,expected,reason", [
    ("f0.25", "detected", None),
    ("flicker", "unknown", "lighting or exposure changed"),
    ("sway", "unknown", "camera or scene moved"),
])
def test_configured_gates_preserve_breathing_and_reject_nuisances(tmp_path, cfg, name, expected, reason):
    path = tmp_path / f"{name}.avi"
    synth.make_clip(path, **synth.CASES[name]["params"])
    r = audit.breathing.analyze(str(path), roi=synth.TORSO_ROI,
                                cfg={**cfg["breathing"], "yolo_enabled": False})
    assert r["breathing"] == expected
    assert r["reasons"] == ([] if reason is None else [reason])
    if expected == "detected":
        assert abs(r["rate_bpm"] - 15) <= 1.5
    else:
        assert r["rate_bpm"] is None
