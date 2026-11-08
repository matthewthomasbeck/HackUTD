"""The documented offline command must use the primary scoring API and config."""
import json

from scripts import analyze_clip


def test_score_flag_returns_primary_score(capsys, monkeypatch):
    result = {"breathing": "not_detected", "rate_bpm": None,
              "breathing_confidence": 0.1, "visibility_pct": 20.0}
    seen = {}

    def analyze(path, **kwargs):
        seen.update(kwargs)
        return dict(result)

    monkeypatch.setattr(analyze_clip.breathing, "analyze", analyze)
    monkeypatch.setenv("PERCEPTION_BREATHING_C_DETECT", "0.42")
    monkeypatch.setenv("PERCEPTION_SCORE_W_BREATH", "0.4")
    assert analyze_clip.main(["clip.mp4", "--score", "--no-yolo", "--set", "c_detect=0.43"]) == 0
    out = json.loads(capsys.readouterr().out)
    assert seen["cfg"]["c_detect"] == 0.43
    assert seen["cfg"]["yolo_enabled"] is False
    assert out["score"]["level"] == "immediate"
    assert out["score"]["score"] == 64.0  # 100 * (0.4 + 0.3 * 0.8), no waiting
    assert out["score"]["confidence"] <= 0.3
    assert "needs human triage" in out["score"]["reasons"]
