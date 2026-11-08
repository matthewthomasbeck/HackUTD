"""Critical score: a pure function with no I/O (docs/specs/perception.md section 7).

The score is a START-like triage aid, not a diagnosis.
It turns the breathing result, visibility, waiting time, and thermal confidence
into a level (immediate or delayed), a score from 0 to 100 (higher is more
urgent), a confidence, and short reason strings for the dashboard and agents.

Every weight and threshold lives in DEFAULTS and can be overridden by the
`[score]` section of config.toml (pass it as `cfg`).
The weights are untuned guesses from the research.

Example trace (the hand-checked case from section 10):
    breathing = "not_detected", visibility 20%, waiting 15 min
    breath_term = b_absent = 1.0
    W = min(1, 15 / 30) = 0.5
    score = 100 * (0.5 * 1.0 + 0.3 * (1 - 0.2) + 0.2 * 0.5)
          = 100 * (0.5 + 0.24 + 0.1) = 84.0
    level = immediate (breathing not detected, and v < 0.3)
"""

from __future__ import annotations

import math

# Defaults from the "Score config ([score], all tunable)" table.
DEFAULTS: dict = {
    "rr_high": 30.0,
    "rr_low": 10.0,
    "v_buried": 0.3,
    "b_absent": 1.0,
    "b_abnormal": 0.9,
    "b_normal": 0.3,
    "w_breath": 0.5,
    "w_buried": 0.3,
    "w_wait": 0.2,
    "wait_full_min": 30.0,
    "absent_conf_cap": 0.3,
    "rescore_interval_s": 60,
    "rescore_min_delta": 2.0,
    "rescore_conf_delta": 0.05,
}

BREATHING_VALUES = ("detected", "not_detected", "unknown")

# Words that must never appear in any score output (CONTRACTS.md: no dead or
# expectant value anywhere; perception.md section 7 reason rules).
BANNED_WORDS = ("dead", "deceased", "expectant", "no pulse")

MAX_REASON_LEN = 48
MAX_REASONS = 6                     # set_critical_score rejects more (spacetimedb.md section 7)
LAST_REASON = "needs human triage"
THERMAL_DEFAULT = 0.5

# Small tolerance so a change of exactly the configured delta counts, despite
# floating point (0.35 - 0.30 is 0.0499999...).
_EPS = 1e-9


def merged_config(cfg: dict | None = None) -> dict:
    """Return DEFAULTS with `cfg` merged over it.

    `cfg` may be the `[score]` section itself, or the whole config with a
    `score` sub-table.
    """
    out = dict(DEFAULTS)
    if cfg:
        section = cfg.get("score") if isinstance(cfg.get("score"), dict) else cfg
        out.update(section)
    return out


def _clamp01(x: float) -> float:
    return min(1.0, max(0.0, float(x)))


def _num(x: float) -> str:
    """Format a config number for a reason string: 30.0 -> "30", 7.5 -> "7.5"."""
    return f"{float(x):g}"


def _rate_text(rr: float, threshold: float | None = None) -> str:
    """Whole breaths per minute, unless rounding would make it equal the threshold."""
    text = f"{rr:.0f}"
    if threshold is not None and float(text) == float(threshold):
        text = f"{rr:.1f}"
    return text


def is_clean(text: str) -> bool:
    """True when `text` contains none of the banned words (case-insensitive)."""
    low = text.lower()
    return not any(word in low for word in BANNED_WORDS)


def breath_term(b: str, rr: float | None, cfg: dict) -> float:
    """Breathing part of the score: absent, abnormal rate, or normal."""
    if b in ("not_detected", "unknown"):
        return cfg["b_absent"]
    # A detected result without a rate should not happen (the breathing
    # pipeline always sends a rate with `detected`); treat it as abnormal,
    # the more urgent direction.
    if rr is None or rr > cfg["rr_high"] or rr < cfg["rr_low"]:
        return cfg["b_abnormal"]
    return cfg["b_normal"]


def compute_level(b: str, rr: float | None, v: float, cfg: dict) -> str:
    """`immediate` or `delayed`; never `minor`, never `unknown` once scored."""
    if b in ("not_detected", "unknown"):
        return "immediate"
    if rr is None or rr > cfg["rr_high"] or rr < cfg["rr_low"]:
        return "immediate"
    if v < cfg["v_buried"]:
        return "immediate"
    return "delayed"


def _finish_reasons(raw: list[str]) -> list[str]:
    """Apply the reason rules: clean, at most 48 chars, at most MAX_REASONS (6), last is fixed."""
    out: list[str] = []
    for r in raw:
        r = r.strip()
        if not r or not is_clean(r) or r == LAST_REASON or r in out:
            continue
        if len(r) > MAX_REASON_LEN:
            r = r[: MAX_REASON_LEN - 3].rstrip(" ,") + "..."
        out.append(r)
    out = out[: MAX_REASONS - 1]
    out.append(LAST_REASON)
    return out


def compute_score(
    breathing: str | None,
    rate_bpm: float | None,
    breathing_conf: float,
    visibility_pct: float | None,
    minutes_waiting: float,
    thermal_conf: float | None,
    earlier_kept: bool,
    cfg: dict | None = None,
    reason: str | None = None,
) -> dict:
    """Score one survivor.

    breathing: "detected", "not_detected", "unknown", or None when no
        breathing clip has been analyzed yet.
    rate_bpm: breaths per minute, used only when breathing is "detected".
    breathing_conf: the breathing result's confidence, 0 to 1.
    visibility_pct: 0 to 100, or None when unknown (treated as buried).
    minutes_waiting: minutes since survivor.created_at while still waiting.
    thermal_conf: thermal confidence of the latest linked detection, or None.
    earlier_kept: True when a newer unclear clip did not replace an earlier result.
    reason: the breathing result's gate reason (for example
        "camera or scene moved"), added after "breathing unclear, re-scan".

    Returns {"level", "score", "confidence", "reasons"}.
    """
    c = merged_config(cfg)

    no_clip = breathing is None
    b = "unknown" if no_clip else breathing
    if b not in BREATHING_VALUES:
        raise ValueError(f"breathing must be one of {BREATHING_VALUES} or None, got {breathing!r}")

    rr = float(rate_bpm) if (b == "detected" and rate_bpm is not None) else None
    q = _clamp01(breathing_conf or 0.0)
    vis_known = visibility_pct is not None and not math.isnan(float(visibility_pct))
    v = _clamp01(float(visibility_pct) / 100.0) if vis_known else 0.0
    t = max(0.0, float(minutes_waiting or 0.0))
    d_known = thermal_conf is not None and not math.isnan(float(thermal_conf))
    d = _clamp01(thermal_conf) if d_known else THERMAL_DEFAULT

    # Level.
    level = compute_level(b, rr, v, c)

    # Score.
    w_term = min(1.0, t / c["wait_full_min"]) if c["wait_full_min"] > 0 else 1.0
    score = 100.0 * (
        c["w_breath"] * breath_term(b, rr, c)
        + c["w_buried"] * (1.0 - v)
        + c["w_wait"] * w_term
    )
    score = round(min(100.0, max(0.0, score)), 1)

    # Confidence: absence of evidence is weak, so cap it.
    if b == "detected":
        confidence = q * d
    else:
        confidence = min(c["absent_conf_cap"], d)
    confidence = round(confidence, 2)

    # Reasons, in the order of the table in section 7.
    reasons: list[str] = []
    if b == "not_detected":
        reasons.append("no signs of life detected, low confidence")
    elif b == "unknown" and no_clip:
        reasons.append("no breathing clip yet")
    elif b == "unknown":
        reasons.append("breathing unclear, re-scan")
        if reason and reason.strip() and reason.strip() != "breathing unclear":
            reasons.append(reason.strip())
    elif rr is None:
        reasons.append("breathing seen, rate unknown")
    elif rr > c["rr_high"]:
        reasons.append(f"breathing {_rate_text(rr, c['rr_high'])}/min, over {_num(c['rr_high'])}")
    elif rr < c["rr_low"]:
        reasons.append(f"breathing {_rate_text(rr, c['rr_low'])}/min, under {_num(c['rr_low'])}")
    else:
        reasons.append(f"breathing {_rate_text(rr)}/min")

    if vis_known:
        reasons.append(f"about {v * 100:.0f}% of body visible (approx.)")
        if v < c["v_buried"]:
            reasons.append("mostly buried")
    else:
        reasons.append("visibility unknown, treated as buried")

    if t >= 1:
        reasons.append(f"waiting {int(t)} min")

    if d_known:
        reasons.append(f"thermal confidence {d:.2f}")
    else:
        reasons.append("thermal confidence missing")

    if earlier_kept:
        reasons.append("latest clip unclear, earlier result kept")

    return {
        "level": level,
        "score": score,
        "confidence": confidence,
        "reasons": _finish_reasons(reasons),
    }


def should_write(prev: dict | None, new: dict, cfg: dict | None = None) -> bool:
    """Meaningful-change rule for set_critical_score (section 7, re-score).

    Write when the survivor was never scored, the level changed, the score
    moved by at least rescore_min_delta, or the confidence moved by at least
    rescore_conf_delta.
    """
    if not prev:
        return True
    c = merged_config(cfg)
    if prev.get("level") != new.get("level"):
        return True
    if prev.get("score") is None or prev.get("confidence") is None:
        return True
    if abs(float(new["score"]) - float(prev["score"])) + _EPS >= c["rescore_min_delta"]:
        return True
    if abs(float(new["confidence"]) - float(prev["confidence"])) + _EPS >= c["rescore_conf_delta"]:
        return True
    return False
