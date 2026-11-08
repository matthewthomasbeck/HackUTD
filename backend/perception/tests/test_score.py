"""Tests for perception.score (docs/specs/perception.md sections 7 and 10)."""

import itertools
import json

import pytest

from perception.score import (
    BANNED_WORDS,
    DEFAULTS,
    LAST_REASON,
    compute_score,
    should_write,
)


def score(breathing="detected", rate=17.0, q=0.8, vis=60.0, t=0.0, d=0.8, kept=False, cfg=None, reason=None):
    return compute_score(breathing, rate, q, vis, t, d, kept, cfg, reason=reason)


# ---- formula, hand-checked ------------------------------------------------

def test_hand_checked_example_84():
    # not_detected, v = 0.2, t = 15: 100 * (0.5 + 0.24 + 0.1) = 84.0
    r = score("not_detected", None, 0.2, 20.0, 15.0, 0.9)
    assert r["score"] == 84.0
    assert r["level"] == "immediate"


def test_normal_breathing_formula():
    # detected 17/min, v = 0.6, t = 0: 100 * (0.5 * 0.3 + 0.3 * 0.4 + 0) = 27.0
    r = score("detected", 17.0, 0.8, 60.0, 0.0, 0.8)
    assert r["score"] == 27.0
    assert r["level"] == "delayed"
    assert r["confidence"] == 0.64


def test_abnormal_rate_formula():
    # detected 34/min, v = 1.0, t = 30: 100 * (0.45 + 0 + 0.2) = 65.0
    r = score("detected", 34.0, 0.8, 100.0, 30.0, 0.8)
    assert r["score"] == 65.0


def test_wait_term_saturates():
    a = score("detected", 17.0, vis=100.0, t=30.0)["score"]
    b = score("detected", 17.0, vis=100.0, t=300.0)["score"]
    assert a == b == 35.0


def test_score_clamped_and_rounded():
    r = score("unknown", None, 0.0, 0.0, 1000.0, 0.5)
    assert r["score"] == 100.0
    r = score("detected", 17.0, vis=33.3, t=7.0)
    assert r["score"] == round(r["score"], 1)
    assert 0.0 <= r["score"] <= 100.0


def test_negative_wait_treated_as_zero():
    assert score(t=-5.0)["score"] == score(t=0.0)["score"]


def test_weights_come_from_config():
    cfg = {"w_breath": 1.0, "w_buried": 0.0, "w_wait": 0.0}
    assert score("not_detected", None, cfg=cfg)["score"] == 100.0
    # the whole config with a [score] sub-table also works
    assert score("not_detected", None, cfg={"score": cfg})["score"] == 100.0


# ---- level rules ----------------------------------------------------------

@pytest.mark.parametrize(
    "breathing,rate,vis,expected",
    [
        ("not_detected", None, 90.0, "immediate"),
        ("unknown", None, 90.0, "immediate"),
        (None, None, 90.0, "immediate"),
        ("detected", 31.0, 90.0, "immediate"),
        ("detected", 9.0, 90.0, "immediate"),
        ("detected", 17.0, 29.0, "immediate"),
        ("detected", 17.0, None, "immediate"),  # unknown visibility is treated as buried
        ("detected", 17.0, 30.0, "delayed"),
        ("detected", 30.0, 90.0, "delayed"),  # boundary: not over 30
        ("detected", 10.0, 90.0, "delayed"),  # boundary: not under 10
        ("detected", None, 90.0, "immediate"),  # detected with no rate: the urgent direction
    ],
)
def test_level_rules(breathing, rate, vis, expected):
    assert score(breathing, rate, vis=vis)["level"] == expected


def test_level_thresholds_from_config():
    cfg = {"rr_high": 40.0}
    assert score("detected", 35.0, vis=90.0, cfg=cfg)["level"] == "delayed"


def test_never_minor_or_unknown():
    for b, rr, vis, t, d, kept in itertools.product(
        (None, "detected", "not_detected", "unknown"),
        (None, 5.0, 17.0, 45.0),
        (None, 0.0, 29.9, 30.0, 100.0),
        (0.0, 12.0, 60.0),
        (None, 0.0, 0.9),
        (False, True),
    ):
        r = compute_score(b, rr, 0.7, vis, t, d, kept)
        assert r["level"] in ("immediate", "delayed")


def test_invalid_breathing_rejected():
    with pytest.raises(ValueError):
        score("dead")


# ---- confidence -----------------------------------------------------------

def test_confidence_detected_is_q_times_d():
    assert score("detected", 17.0, q=0.5, d=0.9)["confidence"] == 0.45


@pytest.mark.parametrize("b", ["not_detected", "unknown", None])
def test_confidence_capped_when_no_breathing_seen(b):
    r = score(b, None, q=1.0, d=0.95)
    assert r["confidence"] == 0.3
    r = score(b, None, q=1.0, d=0.2)
    assert r["confidence"] == 0.2


def test_thermal_missing_uses_half():
    r = score("detected", 17.0, q=0.8, d=None)
    assert r["confidence"] == 0.4
    assert "thermal confidence missing" in r["reasons"]


# ---- reasons --------------------------------------------------------------

def test_reasons_detected_normal_order():
    r = score("detected", 17.4, q=0.8, vis=59.0, t=12.5, d=0.82)
    assert r["reasons"] == [
        "breathing 17/min",
        "about 59% of body visible (approx.)",
        "waiting 12 min",
        "thermal confidence 0.82",
        "needs human triage",
    ]


def test_reasons_fast_and_slow():
    assert score("detected", 34.0)["reasons"][0] == "breathing 34/min, over 30"
    assert score("detected", 8.0)["reasons"][0] == "breathing 8/min, under 10"
    # rounding never shows a rate equal to the threshold
    assert score("detected", 30.4)["reasons"][0] == "breathing 30.4/min, over 30"


def test_reasons_not_detected_buried():
    r = score("not_detected", None, vis=20.0, t=15.0, d=0.9)
    assert r["reasons"] == [
        "no signs of life detected, low confidence",
        "about 20% of body visible (approx.)",
        "mostly buried",
        "waiting 15 min",
        "thermal confidence 0.90",
        "needs human triage",
    ]


def test_reasons_unknown_with_gate_reason():
    r = score("unknown", None, vis=None, reason="camera or scene moved")
    assert r["reasons"][:3] == [
        "breathing unclear, re-scan",
        "camera or scene moved",
        "visibility unknown, treated as buried",
    ]
    assert "mostly buried" not in r["reasons"]


def test_reasons_unknown_without_duplicate():
    r = score("unknown", None, reason="breathing unclear")
    assert r["reasons"].count("breathing unclear") == 0
    assert r["reasons"][0] == "breathing unclear, re-scan"


def test_reasons_no_clip_yet():
    r = compute_score(None, None, 0.0, None, 0.0, None, False)
    assert r["reasons"][0] == "no breathing clip yet"
    assert r["level"] == "immediate"
    assert r["confidence"] <= 0.3


def test_reasons_wait_under_one_minute_omitted():
    assert not any(s.startswith("waiting") for s in score(t=0.9)["reasons"])
    assert "waiting 1 min" in score(t=1.0)["reasons"]


def test_reasons_earlier_result_kept():
    r = score("detected", 17.0, kept=True)
    assert r["reasons"][-2] == "latest clip unclear, earlier result kept"


def test_many_reasons_truncate_to_six_and_keep_triage_last():
    # Rate unknown, mostly buried, waiting, thermal missing, earlier result kept: 7 candidate
    # reasons. set_critical_score rejects more than 6, so the list stops at 6 and the last
    # one is still "needs human triage".
    r = compute_score("detected", None, 0.7, 20.0, 10.0, None, True)
    assert len(r["reasons"]) == 6
    assert r["reasons"][-1] == LAST_REASON
    assert r["reasons"].count(LAST_REASON) == 1


def _all_outputs():
    gate_reasons = (
        None,
        "camera or scene moved",
        "lighting or exposure changed",
        "clip too dark, needs light",
        "a gate reason that is much longer than forty eight characters in total",
    )
    for b, rr, vis, t, d, kept, gr in itertools.product(
        (None, "detected", "not_detected", "unknown"),
        (None, 4.0, 17.0, 30.4, 61.0),
        (None, 0.0, 10.0, 59.0, 100.0),
        (0.0, 5.0, 45.0),
        (None, 0.82),
        (False, True),
        gate_reasons,
    ):
        yield compute_score(b, rr, 0.6, vis, t, d, kept, reason=gr)


def test_reason_limits_everywhere():
    for r in _all_outputs():
        reasons = r["reasons"]
        assert 1 <= len(reasons) <= 6  # the module rejects more than 6 score reasons
        assert reasons[-1] == LAST_REASON
        assert reasons.count(LAST_REASON) == 1
        for s in reasons:
            assert isinstance(s, str) and 0 < len(s) <= 48


def test_banned_words_never_in_output():
    for r in _all_outputs():
        blob = json.dumps(r).lower()
        for word in BANNED_WORDS:
            assert word not in blob


def test_banned_word_in_gate_reason_is_dropped():
    r = score("unknown", None, reason="maybe deceased")
    blob = json.dumps(r).lower()
    assert "deceased" not in blob


def test_banned_words_list_is_complete():
    assert set(BANNED_WORDS) == {"dead", "deceased", "expectant", "no pulse"}


# ---- meaningful-change rule ----------------------------------------------

def test_should_write_never_scored():
    assert should_write(None, score())


def test_should_write_level_change():
    prev = {"level": "delayed", "score": 27.0, "confidence": 0.64}
    new = dict(prev, level="immediate")
    assert should_write(prev, new)


def test_should_write_score_delta():
    prev = {"level": "immediate", "score": 50.0, "confidence": 0.3}
    assert not should_write(prev, dict(prev, score=51.9))
    assert should_write(prev, dict(prev, score=52.0))
    assert should_write(prev, dict(prev, score=48.0))


def test_should_write_conf_delta():
    prev = {"level": "delayed", "score": 27.0, "confidence": 0.30}
    assert not should_write(prev, dict(prev, confidence=0.34))
    assert should_write(prev, dict(prev, confidence=0.35))


def test_should_write_config_override():
    prev = {"level": "delayed", "score": 27.0, "confidence": 0.3}
    assert not should_write(prev, dict(prev, score=31.0), {"rescore_min_delta": 5.0})


def test_waiting_survivor_rewritten_about_every_three_minutes():
    # with default weights the waiting term adds about 0.67 points a minute
    prev = score("detected", 17.0, vis=60.0, t=0.0)
    writes = 0
    for minute in range(1, 31):
        new = score("detected", 17.0, vis=60.0, t=float(minute))
        if should_write(prev, new):
            writes += 1
            prev = new
    assert 8 <= writes <= 11


def test_defaults_match_spec_table():
    assert DEFAULTS["rr_high"] == 30 and DEFAULTS["rr_low"] == 10
    assert DEFAULTS["v_buried"] == 0.3
    assert (DEFAULTS["b_absent"], DEFAULTS["b_abnormal"], DEFAULTS["b_normal"]) == (1.0, 0.9, 0.3)
    assert (DEFAULTS["w_breath"], DEFAULTS["w_buried"], DEFAULTS["w_wait"]) == (0.5, 0.3, 0.2)
    assert DEFAULTS["wait_full_min"] == 30
    assert DEFAULTS["absent_conf_cap"] == 0.3
    assert DEFAULTS["rescore_interval_s"] == 60
    assert DEFAULTS["rescore_min_delta"] == 2.0
    assert DEFAULTS["rescore_conf_delta"] == 0.05
