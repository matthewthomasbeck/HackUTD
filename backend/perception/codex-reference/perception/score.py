"""START-inspired priority aid. Formula weights are untuned, not a diagnosis."""
import math
import re
from .config import SCORE_DEFAULTS

BANNED = re.compile(r"dead|deceased|expectant|no pulse", re.I)


def compute_score(breathing="unknown", rate_bpm=None, breathing_confidence=0.0,
                  visibility_pct=None, waiting_minutes=0.0, thermal_confidence=None,
                  clip_analyzed=False, gate_reasons=(), earlier_result_kept=False, config=None):
    cfg = {**SCORE_DEFAULTS, **(config or {})}
    if breathing not in {"detected", "not_detected", "unknown"}:
        raise ValueError("invalid breathing status")
    for value in [breathing_confidence, waiting_minutes, visibility_pct, thermal_confidence, rate_bpm]:
        if value is not None and not math.isfinite(value):
            raise ValueError("score inputs must be finite")
    if breathing == "detected" and (rate_bpm is None or rate_bpm <= 0):
        raise ValueError("detected breathing needs a positive rate")
    q = min(1, max(0, breathing_confidence))
    v = min(1, max(0, visibility_pct / 100)) if visibility_pct is not None else 0
    t = max(0, waiting_minutes)
    d = 0.5 if thermal_confidence is None else min(1, max(0, thermal_confidence))
    abnormal = breathing == "detected" and (rate_bpm < cfg["rr_low"] or rate_bpm > cfg["rr_high"])
    term = cfg["b_absent"] if breathing != "detected" else (cfg["b_abnormal"] if abnormal else cfg["b_normal"])
    level = "immediate" if breathing != "detected" or abnormal or v < cfg["v_buried"] else "delayed"
    score = round(min(100, max(0, 100 * (cfg["w_breath"] * term + cfg["w_buried"] * (1-v)
        + cfg["w_wait"] * min(1, t / cfg["wait_full_min"])))), 1)
    confidence = round(q*d if breathing == "detected" else min(cfg["absent_conf_cap"], d), 2)
    reasons = []
    if breathing == "not_detected":
        reasons.append("no signs of life detected, low confidence")
    elif breathing == "unknown":
        reasons.append("breathing unclear, re-scan" if clip_analyzed else "no breathing clip yet")
        reasons.extend(str(reason) for reason in gate_reasons)
    else:
        reason = f"breathing {rate_bpm:.0f}/min"
        if abnormal:
            reason += f", {'over' if rate_bpm > cfg['rr_high'] else 'under'} {cfg['rr_high'] if rate_bpm > cfg['rr_high'] else cfg['rr_low']}"
        reasons.append(reason)
    if visibility_pct is None:
        reasons.append("visibility unknown, treated as buried")
    else:
        reasons.append(f"about {visibility_pct:.0f}% of body visible (approx.)")
        if v < cfg["v_buried"]:
            reasons.append("mostly buried")
    if t >= 1:
        reasons.append(f"waiting {t:.0f} min")
    reasons.append("thermal confidence missing" if thermal_confidence is None else f"thermal confidence {d:.2f}")
    if earlier_result_kept:
        reasons.append("latest clip unclear, earlier result kept")
    reasons = [reason[:48] for reason in reasons if not BANNED.search(reason)][:7] + ["needs human triage"]
    return dict(level=level, score=score, confidence=confidence, reasons=reasons)


def meaningful_change(previous, current, config=None):
    cfg = {**SCORE_DEFAULTS, **(config or {})}
    return previous is None or previous["level"] != current["level"] or abs(previous["score"]-current["score"]) >= cfg["rescore_min_delta"] or abs(previous["confidence"]-current["confidence"]) >= cfg["rescore_conf_delta"]
