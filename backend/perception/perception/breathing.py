"""Breathing pipeline, steps 3 to 8 (docs/specs/perception.md section 4).

analyze(path) reads a clip, picks the chest ROI, builds the motion signals, and returns the
result JSON: breathing (detected / not_detected / unknown), rate_bpm (detected only),
breathing_confidence, quality measures, reasons, warnings, and the config used.

Signals:
  pic         primary: signed mean intensity of 8 by 8 cells on the chest ROI, detrended,
              band-passed, flat cells dropped, first principal component
  flow        cross-check: Farneback flow along the torso axis, summed into displacement;
              it can only lower confidence
  background  PIC on a background strip, for the camera-motion gate
  flicker     mean intensity of the frame outside the person, for the lighting gate

The result is a triage aid; it never says more than whether breathing motion was seen.
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path

import cv2
import numpy as np
from scipy.signal import butter, detrend, sosfiltfilt

from . import roi as roi_mod
from . import video

# Defaults from the [breathing] table in perception.md section 4 (this module's keys);
# video.DEFAULTS and roi.DEFAULTS hold the rest, and all three merge into one config.
OWN_DEFAULTS = {
    "roi_max_w": 160,
    "roi_max_h": 120,
    "grid": 8,
    "band_lo_hz": 0.1,
    "band_hi_hz": 1.0,
    "filter_order": 2,
    "nfft": 4096,
    "peak_halfwidth_hz": 0.05,
    "c_min": 0.15,
    "c_good": 0.5,
    "c_detect": 0.35,
    "snr_detect_db": 6,
    "half_tol_bpm": 6,
    "flow_tol_bpm": 4,
    "bg_ratio_max": 0.5,
    "flicker_c_max": 0.5,
    "k_not_detected": 0.75,
    # Not in the spec table: the chest PIC must have at least this many times the band power
    # of the same pipeline run on white noise matched to each cell's own noise level, or the
    # chest counts as having no motion above sensor noise (see noise_null_ratio).
    "motion_null_ratio_min": 4.0,
}
DEFAULTS = {**video.DEFAULTS, **roi_mod.DEFAULTS, **OWN_DEFAULTS}

DETECTED, NOT_DETECTED, UNKNOWN = "detected", "not_detected", "unknown"

REASON_CAMERA_MOVED = "camera or scene moved"
REASON_LIGHTING = "lighting or exposure changed"
REASON_BAND_EDGE = "peak at band edge"
REASON_UNCLEAR = "breathing unclear"
REASON_EARLIER_KEPT = "latest clip unclear, earlier result kept"

BANNED_WORDS = ("dead", "deceased", "expectant", "no pulse")

LOW_CONF_CAP = 0.3  # not_detected and unknown never carry more than this
FLOW_DISAGREE_FACTOR = 0.7
BG_UNAVAILABLE_FACTOR = 0.8
FLICKER_MASK_GROW = 0.5  # the chest ROI is grown by this much before it is left out of the flicker signal


def merge_cfg(cfg: dict | None) -> dict:
    out = dict(DEFAULTS)
    if cfg:
        out.update(cfg)
    return out


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


# ---------------------------------------------------------------------------
# Steps 4 to 6: detrend, band-pass, spectrum, peak.


def bandpass(x: np.ndarray, fps: float, cfg: dict) -> np.ndarray:
    """Linear detrend then zero-phase Butterworth band-pass along the last axis."""
    x = detrend(np.asarray(x, dtype=np.float64), axis=-1, type="linear")
    sos = butter(int(cfg["filter_order"]), [float(cfg["band_lo_hz"]), float(cfg["band_hi_hz"])],
                 btype="bandpass", fs=fps, output="sos")
    return sosfiltfilt(sos, x, axis=-1)


def nfft_for(n: int, cfg: dict) -> int:
    """nfft samples, or the next power of two above 4 times the length if that is longer."""
    return max(int(cfg["nfft"]), 1 << int(math.ceil(math.log2(max(2, 4 * n)))))


def spectrum(x: np.ndarray, fps: float, cfg: dict):
    """Hann window, zero-pad, rfft. Returns (freqs, power, band mask)."""
    x = np.asarray(x, dtype=np.float64)
    n = len(x)
    nfft = nfft_for(n, cfg)
    X = np.fft.rfft(x * np.hanning(n), n=nfft)
    P = np.abs(X) ** 2
    f = np.fft.rfftfreq(nfft, d=1.0 / fps)
    band = (f >= float(cfg["band_lo_hz"])) & (f <= float(cfg["band_hi_hz"]))
    return f, P, band


def find_peak(f: np.ndarray, P: np.ndarray, band: np.ndarray):
    """(f*, index, at_edge): argmax in band, refined by a parabola on log power."""
    idx = np.flatnonzero(band)
    if idx.size == 0:
        return float("nan"), -1, True
    i = int(idx[np.argmax(P[idx])])
    at_edge = i == idx[0] or i == idx[-1]
    fstar = float(f[i])
    if 0 < i < len(P) - 1:
        eps = 1e-30
        a, b, c = (math.log(P[i - 1] + eps), math.log(P[i] + eps), math.log(P[i + 1] + eps))
        den = a - 2 * b + c
        if den < 0:
            delta = 0.5 * (a - c) / den
            if abs(delta) <= 1:
                fstar = float(f[i] + delta * (f[1] - f[0]))
    return fstar, i, bool(at_edge)


def power_near(f, P, band, f0, hw) -> float:
    m = band & (np.abs(f - f0) <= hw)
    return float(P[m].sum())


def concentration(f, P, band, f0, hw) -> float:
    total = float(P[band].sum())
    return power_near(f, P, band, f0, hw) / total if total > 0 else 0.0


def snr_db(P, band, i) -> float:
    med = float(np.median(P[band])) if band.any() else 0.0
    if med <= 0 or i < 0:
        return 0.0
    return 10.0 * math.log10(max(P[i], 1e-30) / med)


def analyze_signal(x, fps, cfg) -> dict:
    """Spectrum, peak, concentration, and SNR of an already filtered signal."""
    f, P, band = spectrum(x, fps, cfg)
    fstar, i, edge = find_peak(f, P, band)
    hw = float(cfg["peak_halfwidth_hz"])
    return {"f": f, "P": P, "band": band, "fstar": fstar, "i": i, "edge": edge,
            "c": concentration(f, P, band, fstar, hw), "snr_db": snr_db(P, band, i)}


# ---------------------------------------------------------------------------
# Step 3: motion signals.


def crop_stack(gray: np.ndarray, rect_full, scale: float, cfg: dict) -> np.ndarray:
    """Crop a full-res rect from every downscaled frame, shrink to fit roi_max_w by roi_max_h
    (keeping aspect), and blur 3 by 3. Returns (T, h, w) uint8."""
    T, Hs, Ws = gray.shape
    x, y, w, h = rect_full
    x0 = int(max(0, min(Ws - 1, math.floor(x * scale))))
    y0 = int(max(0, min(Hs - 1, math.floor(y * scale))))
    x1 = int(max(x0 + 1, min(Ws, math.ceil((x + w) * scale))))
    y1 = int(max(y0 + 1, min(Hs, math.ceil((y + h) * scale))))
    crop = gray[:, y0:y1, x0:x1]
    ch, cw = crop.shape[1:]
    s = min(1.0, float(cfg["roi_max_w"]) / cw, float(cfg["roi_max_h"]) / ch)
    out_w, out_h = max(1, int(round(cw * s))), max(1, int(round(ch * s)))
    out = np.empty((T, out_h, out_w), dtype=np.uint8)
    for t in range(T):
        fr = crop[t]
        if s < 1.0:
            fr = cv2.resize(fr, (out_w, out_h), interpolation=cv2.INTER_AREA)
        out[t] = cv2.GaussianBlur(fr, (3, 3), 0)
    return out


def cell_means(stack: np.ndarray, grid: int) -> np.ndarray:
    """Signed mean intensity per cell per frame: (cells, T)."""
    T, h, w = stack.shape
    gy = min(grid, h)
    gx = min(grid, w)
    ys = np.linspace(0, h, gy + 1).round().astype(int)
    xs = np.linspace(0, w, gx + 1).round().astype(int)
    st = stack.astype(np.float32)
    rows = []
    for a in range(gy):
        for b in range(gx):
            rows.append(st[:, ys[a]:ys[a + 1], xs[b]:xs[b + 1]].mean(axis=(1, 2)))
    return np.stack(rows).astype(np.float64)


def pic_from_cells(M: np.ndarray, fps: float, cfg: dict) -> np.ndarray:
    """Detrend and band-pass each cell, drop cells below the 25th percentile of variance,
    and return the first principal component in gray levels.

    The component is the projection on the first unit singular vector divided by
    sqrt(cells kept), so a motion of amplitude a in every cell gives amplitude a, and the
    chest and background signals are on the same scale for the background ratio.
    """
    Y = bandpass(M, fps, cfg)
    var = Y.var(axis=1)
    keep = var >= np.percentile(var, 25)
    Y = Y[keep]
    Y = Y - Y.mean(axis=1, keepdims=True)
    if Y.shape[0] == 0:
        return np.zeros(M.shape[1])
    U, S, Vt = np.linalg.svd(Y, full_matrices=False)
    return (S[0] * Vt[0]) / math.sqrt(Y.shape[0])


def flow_signal(stack: np.ndarray, axis) -> np.ndarray:
    """Farneback flow between consecutive ROI frames, mean along the torso axis, summed into displacement."""
    ux, uy = axis if axis is not None else (0.0, 1.0)
    vel = np.zeros(stack.shape[0] - 1)
    for t in range(stack.shape[0] - 1):
        fl = cv2.calcOpticalFlowFarneback(stack[t], stack[t + 1], None, 0.5, 3, 15, 3, 5, 1.2, 0)
        vel[t] = float(np.mean(fl[..., 0] * ux + fl[..., 1] * uy))
    return np.cumsum(vel)


def flicker_signal(gray: np.ndarray, exclusions_full: list, scale: float) -> np.ndarray:
    """Mean intensity of each downscaled frame outside the excluded rects (person box, grown chest ROI).

    Leaving the person out keeps a breathing chest from showing up as a lighting change.
    """
    T, H, W = gray.shape
    mask = np.ones((H, W), dtype=bool)
    for r in exclusions_full:
        if r is None:
            continue
        x, y, w, h = r
        x0, y0 = int(math.floor(x * scale)), int(math.floor(y * scale))
        x1, y1 = int(math.ceil((x + w) * scale)), int(math.ceil((y + h) * scale))
        mask[max(0, y0):max(0, y1), max(0, x0):max(0, x1)] = False
    if mask.sum() < 0.05 * H * W:
        mask[:] = True
    return gray[:, mask].astype(np.float64).mean(axis=1)


def noise_null_ratio(M: np.ndarray, pic: np.ndarray, fps: float, cfg: dict) -> float:
    """Band power of the chest PIC divided by the band power of a noise-only PIC.

    Why: on a still scene the PIC is pure sensor noise, and with a 20 s clip the strongest
    of about a dozen spectral bins still holds a quarter or more of the band power, and the
    background strip holds the same noise. So concentration, SNR, and the background ratio
    cannot tell a still chest from motion. This compares against a null instead: each cell's
    white noise level comes from its second difference (breathing barely changes that), white
    noise of that level (fixed seed, so results repeat) goes through the same PIC steps, and
    the ratio of band powers says whether anything moved above the noise.
    """
    sigma = np.std(np.diff(M, n=2, axis=1), axis=1) / math.sqrt(6.0)
    rng = np.random.default_rng(0)
    null = rng.standard_normal(M.shape) * sigma[:, None]
    null_pic = pic_from_cells(null, fps, cfg)
    p_null = float(np.var(null_pic))
    return float(np.var(pic)) / p_null if p_null > 0 else float("inf")


def half_rates(M: np.ndarray, fps: float, cfg: dict):
    """Rate (per minute) of the first and second half of the clip, steps 4 to 6 on each half."""
    n = M.shape[1]
    h = n // 2
    rates = []
    for part in (M[:, :h], M[:, h:]):
        sig = pic_from_cells(part, fps, cfg)
        rates.append(60.0 * analyze_signal(sig, fps, cfg)["fstar"])
    return rates


def half_agreement(r1: float, r2: float, cfg: dict) -> float:
    d = abs(r1 - r2)
    if not math.isfinite(d):
        return 0.0
    tol = float(cfg["half_tol_bpm"])
    if d <= tol:
        return 1.0
    if d <= 2 * tol:
        return 0.5
    return 0.0


# ---------------------------------------------------------------------------
# Result building.


def _base_result(cfg: dict) -> dict:
    return {
        "survivor_id": None, "detection_id": None, "clip_url": None,
        "breathing": UNKNOWN, "rate_bpm": None, "breathing_confidence": 0.0,
        "visibility_pct": None, "visibility_source": "none",
        "roi_source": None, "chest_visible_k": None,
        "quality": {"concentration": None, "snr_db": None, "half_agreement": None,
                    "flow_agreement": None, "background_ratio": None, "flicker_peak": None},
        "reasons": [], "warnings": [],
        "fps": None, "duration_s": None,
        "timings_ms": {"read": 0, "yolo": 0, "signals": 0, "evm": 0},
        "display_clip_url": None, "spectrum_url": None, "roi_image_url": None,
        "person_image_url": None, "person_confirmed": None, "person_conf": None,
        "debug": {},
        "params": _public_params(cfg),
    }


def _public_params(cfg: dict) -> dict:
    """The config for result.json, with the weights folder relative to backend/perception
    so a served result does not show the laptop's home folder."""
    out = dict(cfg)
    wd = out.get("yolo_weights_dir")
    if isinstance(wd, str):
        try:
            out["yolo_weights_dir"] = str(Path(wd).resolve().relative_to(roi_mod._PKG_ROOT))
        except ValueError:
            pass
    return out


def _write_outputs(result: dict, out_dir: str | None, spec=None, cfg=None) -> None:
    if not out_dir:
        return
    d = Path(out_dir)
    d.mkdir(parents=True, exist_ok=True)
    if spec is not None:
        try:
            _plot_spectrum(spec, result, str(d / "spectrum.png"), cfg)
        except Exception as exc:  # the plot is for debugging only
            result["warnings"].append(f"spectrum plot failed: {type(exc).__name__}")
    (d / "result.json").write_text(json.dumps(result, indent=2))


def _plot_spectrum(spec: dict, result: dict, path: str, cfg: dict) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    f, P, band = spec["f"], spec["P"], spec["band"]
    fig, ax = plt.subplots(figsize=(6, 3), dpi=100)
    ax.plot(60 * f[band], P[band] / max(P[band].max(), 1e-30))
    ax.axvline(60 * spec["fstar"], linestyle="--")
    ax.set_xlabel("breaths per minute")
    ax.set_ylabel("relative power")
    ax.set_title(f"{result['breathing']}  conf {result['breathing_confidence']}")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def _finish(result: dict, breathing: str, conf: float, reason: str | None = None, rate=None) -> dict:
    result["breathing"] = breathing
    if breathing != DETECTED:
        conf = min(LOW_CONF_CAP, conf)
        rate = None
    result["breathing_confidence"] = round(max(0.0, conf), 2)
    result["rate_bpm"] = None if rate is None else round(rate, 1)
    if reason:
        result["reasons"].append(reason)
    return result


def analyze(path: str, *, fps: float | None = None, roi=None, cfg: dict | None = None,
            out_dir: str | None = None) -> dict:
    """Run the breathing pipeline on one clip and return the result JSON (perception.md section 4).

    fps overrides the container frame rate; roi (x, y, w, h, full-resolution pixels) is the
    operator chest region; cfg overrides DEFAULTS; out_dir, when given, receives result.json,
    roi.jpg, and spectrum.png.
    """
    cfg = merge_cfg(cfg)
    result = _base_result(cfg)

    t0 = time.perf_counter()
    clip = video.read_clip(path, fps=fps, cfg=cfg)
    result["timings_ms"]["read"] = int(round((time.perf_counter() - t0) * 1000))
    result["warnings"].extend(clip.warnings)
    result["fps"] = clip.fps or None
    result["duration_s"] = clip.duration_s or None
    result["debug"].update({"frame_mean": None if clip.frame_mean is None else round(clip.frame_mean, 1),
                            "noise_sigma": None if clip.noise_sigma is None else round(clip.noise_sigma, 2)})

    if not clip.samples:
        _finish(result, UNKNOWN, 0.0, clip.reason or video.REASON_UNREADABLE)
        _write_outputs(result, out_dir)
        return result

    # Step 2: chest ROI (also run on clips that failed a step 1 gate, so the visibility
    # estimate and roi.jpg still exist for the score and the dashboard).
    sel = roi_mod.select_roi(clip.samples, roi=roi, cfg=cfg)
    result["timings_ms"]["yolo"] = sel["yolo_ms"]
    result["roi_source"] = sel["roi_source"]
    result["chest_visible_k"] = sel["k"]
    result["visibility_pct"] = sel["visibility_pct"]
    result["visibility_source"] = sel["visibility_source"]
    result["debug"].update({"chest_roi": list(sel["chest"]),
                            "background_roi": None if sel["background"] is None else list(sel["background"]),
                            "person_box": sel["person_box"], "yolo_person_conf": sel["person_conf"],
                            "yolo_model": roi_mod.loaded_model_name()})
    if out_dir:
        roi_mod.draw_roi(clip.middle, sel, str(Path(out_dir) / "roi.jpg"), cfg)

    # Rule 1: a gate in step 1 or 2 failed.
    gate = clip.reason or roi_mod.check_roi(clip.middle, sel["chest"], cfg)
    if gate:
        _finish(result, UNKNOWN, 0.0, gate)
        _write_outputs(result, out_dir)
        return result
    result["warnings"].extend(sel["warnings"])

    t1 = time.perf_counter()
    fs = clip.fps
    chest = crop_stack(clip.gray, sel["chest"], clip.scale, cfg)
    M = cell_means(chest, int(cfg["grid"]))
    pic = pic_from_cells(M, fs, cfg)
    main = analyze_signal(pic, fs, cfg)
    fstar, c, snr = main["fstar"], main["c"], main["snr_db"]
    hw = float(cfg["peak_halfwidth_hz"])

    motion_ratio = noise_null_ratio(M, pic, fs, cfg)
    moving = motion_ratio >= float(cfg["motion_null_ratio_min"])

    r1, r2 = half_rates(M, fs, cfg)
    a = half_agreement(r1, r2, cfg)

    flow = bandpass(flow_signal(chest, sel["axis"] if sel["roi_source"] == "pose" else None), fs, cfg)
    fl = analyze_signal(flow, fs, cfg)
    flow_ok = bool(abs(60 * (fl["fstar"] - fstar)) <= float(cfg["flow_tol_bpm"]) and fl["c"] >= float(cfg["c_min"]))

    bg_available = sel["background"] is not None
    bg_ratio = None
    if bg_available:
        bg_stack = crop_stack(clip.gray, sel["background"], clip.scale, cfg)
        bg_pic = pic_from_cells(cell_means(bg_stack, int(cfg["grid"])), fs, cfg)
        bf, bP, bband = spectrum(bg_pic, fs, cfg)
        chest_near = power_near(main["f"], main["P"], main["band"], fstar, hw)
        bg_near = power_near(bf, bP, bband, fstar, hw)
        bg_ratio = bg_near / chest_near if chest_near > 0 else float("inf")

    person_rect = None
    if sel["person_box"] is not None:
        person_rect = roi_mod.box_to_rect(sel["person_box"])
    excl = [person_rect, roi_mod.grow_rect(sel["chest"], FLICKER_MASK_GROW, sel["frame_size"])]
    flick = analyze_signal(bandpass(flicker_signal(clip.gray, excl, clip.scale), fs, cfg), fs, cfg)
    flicker_peak = bool(abs(flick["fstar"] - fstar) <= hw and flick["c"] >= float(cfg["flicker_c_max"]))
    result["timings_ms"]["signals"] = int(round((time.perf_counter() - t1) * 1000))

    result["quality"] = {
        "concentration": round(c, 3), "snr_db": round(snr, 1), "half_agreement": a,
        "flow_agreement": flow_ok,
        "background_ratio": None if bg_ratio is None else round(min(bg_ratio, 1e6), 3),
        "flicker_peak": flicker_peak,
    }
    result["debug"].update({
        "motion_vs_noise": round(min(motion_ratio, 1e6), 2), "chest_motion": moving,
        "peak_hz": round(fstar, 4), "peak_at_band_edge": main["edge"],
        "half_rates_bpm": [round(r1, 1), round(r2, 1)],
        "flow_rate_bpm": round(60 * fl["fstar"], 1), "flow_concentration": round(fl["c"], 3),
        "flicker_rate_bpm": round(60 * flick["fstar"], 1), "flicker_concentration": round(flick["c"], 3),
    })

    k = sel["k"]
    q = clamp01((c - float(cfg["c_min"])) / (float(cfg["c_good"]) - float(cfg["c_min"]))) * a * k
    if not flow_ok:
        q *= FLOW_DISAGREE_FACTOR
    if not bg_available:
        q *= BG_UNAVAILABLE_FACTOR

    # Step 8, rules 2 to 6, first match decides. When the chest has no motion above sensor
    # noise, rules 2 to 4 cannot apply (a moving camera or a lighting change would move the
    # textured chest too), and the flat signal counts as "no periodic chest motion" in rule 5.
    flat = (c < float(cfg["c_min"]) and snr < float(cfg["snr_detect_db"])) or not moving
    if moving and bg_available and bg_ratio >= float(cfg["bg_ratio_max"]):
        _finish(result, UNKNOWN, 0.0, REASON_CAMERA_MOVED)
    elif moving and flicker_peak:
        _finish(result, UNKNOWN, 0.0, REASON_LIGHTING)
    elif moving and c >= float(cfg["c_detect"]) and snr >= float(cfg["snr_detect_db"]) and a >= 0.5:
        if main["edge"]:
            _finish(result, UNKNOWN, q, REASON_BAND_EDGE)
        else:
            _finish(result, DETECTED, q, rate=60.0 * fstar)
    elif k >= float(cfg["k_not_detected"]) and flat:
        _finish(result, NOT_DETECTED, min(LOW_CONF_CAP, LOW_CONF_CAP * k))
    else:
        _finish(result, UNKNOWN, q, REASON_UNCLEAR)

    _write_outputs(result, out_dir, spec=main, cfg=cfg)
    return result


# ---------------------------------------------------------------------------
# Re-scan rule (perception.md section 4).


def rescan_keeps_earlier(earlier: str | None, latest: str) -> bool:
    """True when the latest result must not replace the earlier one: an unknown never
    replaces an earlier detected or not_detected. The caller then keeps the earlier values,
    skips report_breathing, and adds REASON_EARLIER_KEPT to the score reasons."""
    return latest == UNKNOWN and earlier in (DETECTED, NOT_DETECTED)


def contains_banned_word(obj) -> bool:
    """True if any string in obj (nested dicts and lists included) contains a banned word."""
    text = json.dumps(obj).lower()
    return any(w in text for w in BANNED_WORDS)
