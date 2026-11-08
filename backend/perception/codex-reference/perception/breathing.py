"""PIC breathing estimates with independent motion and lighting rejection gates."""

import csv
import json
import time
from pathlib import Path

import cv2
import numpy as np
from scipy import signal

from .roi import background_roi, clamp_box, draw_person, draw_regions, select_roi
from .video import ClipReadError, read_clip


DEFAULTS = dict(default_fps=30, min_fps=10, min_duration_s=15, max_duration_s=30,
    yolo_model="yolo26n-pose.pt", yolo_conf=0.25, kp_conf=0.5, yolo_frames=5,
    person_confirm_conf=0.5, chest_width_factor=1.1, center_roi_frac=0.4,
    min_roi_px=40, roi_max_w=160, roi_max_h=120, grid=8,
    clip_dark_mean_min=40, clip_noise_max=6, sat_frac_max=0.2,
    dark_mean_min=8, tex_min=4, band_lo_hz=0.1, band_hi_hz=1.0,
    filter_order=2, nfft=4096, peak_halfwidth_hz=0.05, c_min=0.15,
    c_good=0.5, c_detect=0.35, snr_detect_db=6, half_tol_bpm=6,
    flow_tol_bpm=4, bg_ratio_max=0.5, flicker_c_max=0.5, k_not_detected=0.75,
    flicker_min_std=0.5, bg_flow_min_px=0.1, bg_flow_concentration_min=0.35)


def settings(config=None):
    if config is None:
        supplied = {}
    elif isinstance(config, dict):
        supplied = config.get("breathing", config)
    else:
        supplied = getattr(config, "breathing", {})
    cfg = {**DEFAULTS, **supplied}
    if not 0 < cfg["band_lo_hz"] < cfg["band_hi_hz"] < cfg["min_fps"] / 2:
        raise ValueError("invalid breathing filter band")
    if not cfg["c_min"] < cfg["c_good"] <= 1:
        raise ValueError("invalid breathing concentration thresholds")
    if not 0 < cfg["min_duration_s"] <= cfg["max_duration_s"]:
        raise ValueError("invalid breathing duration limits")
    if not isinstance(cfg["grid"],int) or not 2 <= cfg["grid"] <= 32:
        raise ValueError("invalid breathing grid")
    return cfg


def bandpass(values, fps, cfg):
    x = signal.detrend(np.asarray(values, dtype=float), axis=-1, type="linear")
    sos = signal.butter(cfg["filter_order"], [cfg["band_lo_hz"], cfg["band_hi_hz"]],
                        fs=fps, btype="bandpass", output="sos")
    return signal.sosfiltfilt(sos, x, axis=-1)


def crop_frames(frames, region, cfg):
    x, y, width, height = region
    factor = min(1.0, cfg["roi_max_w"]/width, cfg["roi_max_h"]/height)
    size = (max(cfg["grid"], round(width*factor)), max(cfg["grid"], round(height*factor)))
    return np.stack([cv2.GaussianBlur(cv2.resize(frame[y:y+height, x:x+width], size,
                                               interpolation=cv2.INTER_AREA), (3,3), 0)
                     for frame in frames])


def pic_signal(frames, fps, cfg, remove_uniform=False):
    grid = cfg["grid"]
    rows = np.array_split(np.arange(frames.shape[1]), grid)
    columns = np.array_split(np.arange(frames.shape[2]), grid)
    cells = np.stack([frames[:, r[0]:r[-1]+1, c[0]:c[-1]+1].mean(axis=(1,2))
                      for r in rows for c in columns])
    if remove_uniform:
        cells -= cells.mean(axis=0,keepdims=True)
    cells = bandpass(cells, fps, cfg)
    variances = cells.var(axis=1)
    cells = cells[variances >= np.percentile(variances, 25)]
    if not len(cells) or np.max(variances) < 1e-12:
        return np.zeros(len(frames))
    cells -= cells.mean(axis=1, keepdims=True)
    # Eigenvectors of the small cell covariance avoid a full time-by-time SVD.
    _, vectors = np.linalg.eigh(cells @ cells.T)
    return vectors[:, -1] @ cells / np.sqrt(len(cells))


def flow_signal(frames, fps, cfg, axis=None):
    axis = np.array([0.0, 1.0]) if axis is None else np.asarray(axis)
    displacement = np.zeros(len(frames))
    velocity = []
    for previous, current in zip(frames[:-1], frames[1:]):
        flow = cv2.calcOpticalFlowFarneback(previous, current, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        velocity.append(float(np.mean(flow[...,0]*axis[0] + flow[...,1]*axis[1])))
    displacement[1:] = np.cumsum(velocity)
    return bandpass(displacement, fps, cfg)


def spectrum(values, fps, cfg):
    values = np.asarray(values)
    nfft = max(int(cfg["nfft"]), 1 << int(np.ceil(np.log2(max(4*len(values), 2)))))
    frequencies = np.fft.rfftfreq(nfft, 1/fps)
    power = np.abs(np.fft.rfft(values*np.hanning(len(values)), n=nfft))**2
    indices = np.flatnonzero((frequencies >= cfg["band_lo_hz"]) &
                             (frequencies <= cfg["band_hi_hz"]))
    total = power[indices].sum()
    if total < 1e-10:
        return {"rate": None, "frequency": None, "concentration": 0.0, "snr_db": 0.0,
                "edge": False, "frequencies": frequencies, "power": power}
    peak = indices[np.argmax(power[indices])]
    refined = float(peak)
    if 0 < peak < len(power)-1:
        left, center, right = np.log(np.maximum(power[peak-1:peak+2], 1e-30))
        denominator = left - 2*center + right
        if abs(denominator) > 1e-12:
            refined += float(np.clip(0.5*(left-right)/denominator, -0.5, 0.5))
    frequency = refined*fps/nfft
    within = indices[np.abs(frequencies[indices]-frequency) <= cfg["peak_halfwidth_hz"]]
    concentration = float(power[within].sum()/total)
    snr = float(10*np.log10(max(power[peak],1e-30)/max(np.median(power[indices]),1e-30)))
    return {"rate": frequency*60, "frequency": frequency,
            "concentration": concentration, "snr_db": snr,
            "edge": bool(peak in (indices[0], indices[-1])),
            "frequencies": frequencies, "power": power}


def quality_measures(pic, flow, background, flicker, fps, cfg):
    main = spectrum(pic, fps, cfg)
    flow_spec = spectrum(flow, fps, cfg)
    background_spec = spectrum(background, fps, cfg) if background is not None else None
    flicker_spec = spectrum(flicker, fps, cfg)
    halves = [spectrum(bandpass(part, fps, cfg), fps, cfg)["rate"] for part in np.array_split(pic,2)]
    difference = abs(halves[0]-halves[1]) if all(v is not None for v in halves) else np.inf
    agreement = 1.0 if difference <= cfg["half_tol_bpm"] else (0.5 if difference <= 2*cfg["half_tol_bpm"] else 0.0)
    flow_agreement = bool(main["rate"] is not None and flow_spec["rate"] is not None
                          and abs(main["rate"]-flow_spec["rate"]) <= cfg["flow_tol_bpm"]
                          and flow_spec["concentration"] >= cfg["c_min"])
    ratio = 0.0
    if background_spec is not None and main["frequency"] is not None:
        window = np.abs(main["frequencies"]-main["frequency"]) <= cfg["peak_halfwidth_hz"]
        ratio = float(background_spec["power"][window].sum()/max(main["power"][window].sum(),1e-20))
    flicker_peak = bool(main["frequency"] is not None and flicker_spec["frequency"] is not None
                        and abs(main["frequency"]-flicker_spec["frequency"]) <= cfg["peak_halfwidth_hz"]
                        and flicker_spec["concentration"] >= cfg["flicker_c_max"]
                        and np.std(flicker) >= cfg["flicker_min_std"])
    quality = {"concentration": main["concentration"], "snr_db": main["snr_db"],
               "half_agreement": agreement, "flow_agreement": flow_agreement,
               "background_ratio": ratio, "flicker_peak": flicker_peak}
    return main, quality


def decide(peak, quality, k, background_available, cfg):
    c, snr, agreement = quality["concentration"], quality["snr_db"], quality["half_agreement"]
    q = float(np.clip((c-cfg["c_min"])/(cfg["c_good"]-cfg["c_min"]),0,1))*agreement*k
    if not quality["flow_agreement"]:
        q *= 0.7
    if not background_available:
        q *= 0.8
    if quality["background_ratio"] >= cfg["bg_ratio_max"] or quality.get("background_motion",False):
        return "unknown", None, 0.0, ["camera or scene moved"]
    if quality["flicker_peak"]:
        return "unknown", None, 0.0, ["lighting or exposure changed"]
    if peak["edge"]:
        return "unknown", None, min(0.3,round(q,2)), ["peak at band edge"]
    if c >= cfg["c_detect"] and snr >= cfg["snr_detect_db"] and agreement >= 0.5:
        return "detected", round(peak["rate"],1), round(q,2), []
    if k >= cfg["k_not_detected"] and c < cfg["c_min"] and snr < cfg["snr_detect_db"]:
        return "not_detected", None, round(min(0.3,0.3*k),2), ["no signs of life detected, low confidence"]
    return "unknown", None, round(min(0.3,q),2), ["breathing unclear"]


def analyze_clip(path, *, roi=None, fps=None, config=None, debug_dir=None):
    cfg = settings(config)
    started = time.perf_counter()
    result = {"breathing": "unknown", "rate_bpm": None, "breathing_confidence": 0.0,
              "visibility_pct": None, "visibility_source": "none", "roi_source": "none",
              "chest_visible_k": 0.0, "quality": {}, "reasons": [], "warnings": [],
              "person_confirmed": False, "person_conf": 0.0, "person_image_path": None,
              "roi_image_path": None, "spectrum_path": None, "display_clip_url": None,
              "spectrum_url": None, "roi_image_url": None, "person_image_url": None,
              "fps": None, "duration_s": 0.0, "timings_ms": {}, "params": cfg}
    def finish(reason=None):
        if reason:
            result["reasons"] = [reason]
        result["timings_ms"]["total"] = round(1000*(time.perf_counter()-started),1)
        result.update(breathing_status=result["breathing"], breathing_rate_bpm=result["rate_bpm"],
                      confidence=result["breathing_confidence"])
        if debug_dir:
            folder = Path(debug_dir)
            folder.mkdir(parents=True,exist_ok=True)
            (folder/"result.json").write_text(json.dumps(result,indent=2)+"\n")
        return result
    try:
        video = read_clip(path,fps,cfg)
    except ClipReadError:
        return finish("clip unreadable")
    result.update(fps=video.fps,duration_s=video.duration_s,warnings=video.warnings)
    result["timings_ms"]["read"] = round(1000*(time.perf_counter()-started),1)
    if video.duration_s < cfg["min_duration_s"]:
        return finish("clip too short")
    if video.fps < cfg["min_fps"]:
        return finish("frame rate too low")
    if video.mean < cfg["clip_dark_mean_min"]:
        return finish("clip too dark, needs light")
    if video.noise_sigma > cfg["clip_noise_max"]:
        return finish("clip too noisy (low light)")
    selected_at = time.perf_counter()
    try:
        selection = select_roi(video.samples,roi,cfg)
    except (ValueError,TypeError):
        return finish("invalid chest region")
    result["timings_ms"]["yolo"] = round(1000*(time.perf_counter()-selected_at),1)
    for key in ("roi_source","chest_visible_k","visibility_pct","visibility_source"):
        result[key] = selection[key]
    result.update(person_confirmed=selection["person"]["person_confirmed"],
                  person_conf=selection["person"]["person_conf"])
    if not selection["person"]["model_available"]:
        result["warnings"].append("person model unavailable")
    # Test-only visibility override is unavailable through service form fields.
    k = float(cfg.get("chest_visible_k",selection["chest_visible_k"]))
    result["chest_visible_k"] = k
    full_height, full_width = video.original_shape
    height,width = video.frames.shape[1:]
    scale = np.array([width/full_width,height/full_height,width/full_width,height/full_height])
    region = clamp_box(np.array(selection["roi"])*scale,width,height)
    result["roi"] = list(selection["roi"])
    if min(selection["roi"][2:]) < cfg["min_roi_px"]:
        return finish("chest region too small")
    x,y,w,h = region
    middle = video.frames[len(video.frames)//2]
    chest = middle[y:y+h,x:x+w]
    if np.mean(chest>=250) > cfg["sat_frac_max"]:
        return finish("chest region overexposed (glare from the robot light)")
    if chest.mean() < cfg["dark_mean_min"] and chest.std() < cfg["tex_min"]:
        return finish("chest region too dark")
    if chest.std() < cfg["tex_min"]:
        return finish("no texture on chest region")
    person_box = np.array(selection["person_box"])*scale if selection["person_box"] is not None else None
    background = background_roi(middle,person_box,region,cfg)
    if background is None:
        result["warnings"].append("background gate unavailable")
    signals_at = time.perf_counter()
    cropped = crop_frames(video.frames,region,cfg)
    pic = pic_signal(cropped,video.fps,cfg)
    flow = flow_signal(cropped,video.fps,cfg,selection["axis"])
    background_frames = crop_frames(video.frames,background,cfg) if background else None
    bg = pic_signal(background_frames,video.fps,cfg,remove_uniform=True) if background else None
    flicker = bandpass(video.frames.mean(axis=(1,2)),video.fps,cfg)
    peak,quality = quality_measures(pic,flow,bg,flicker,video.fps,cfg)
    if background_frames is not None:
        # Coherent background displacement rejects sway even when spatial PIC
        # gradients are weak. Uniform lighting is removed from background PIC.
        background_flow = flow_signal(background_frames,video.fps,cfg)
        background_peak = spectrum(background_flow,video.fps,cfg)
        quality["background_flow_std_px"] = float(np.std(background_flow))
        quality["background_flow_concentration"] = background_peak["concentration"]
        quality["background_motion"] = bool(np.std(background_flow) >= cfg["bg_flow_min_px"]
                and background_peak["concentration"] >= cfg["bg_flow_concentration_min"])
    status,rate,confidence,reasons = decide(peak,quality,k,background is not None,cfg)
    result.update(breathing=status,rate_bpm=rate,breathing_confidence=confidence,
                  reasons=reasons,quality=quality)
    result["timings_ms"]["signals"] = round(1000*(time.perf_counter()-signals_at),1)
    if debug_dir:
        folder = Path(debug_dir)
        folder.mkdir(parents=True,exist_ok=True)
        roi_path,person_path = folder/"roi.jpg",folder/"person.jpg"
        full_background = tuple(np.array(background)/scale) if background else None
        draw_regions(video.samples[len(video.samples)//2],selection,full_background,roi_path)
        draw_person(video.samples[len(video.samples)//2],selection["person"],output=person_path,config=cfg)
        result.update(roi_image_path=str(roi_path),person_image_path=str(person_path))
        with (folder/"signal.csv").open("w",newline="") as output:
            writer = csv.writer(output)
            writer.writerow(["t","pic","flow","background","flicker"])
            writer.writerows(zip(np.arange(len(pic))/video.fps,pic,flow,
                                 bg if bg is not None else np.zeros(len(pic)),flicker))
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            fig,axis = plt.subplots()
            axis.plot(peak["frequencies"]*60,peak["power"])
            axis.set(xlim=(6,60),xlabel="Breaths per minute",ylabel="Power")
            fig.savefig(folder/"spectrum.png")
            plt.close(fig)
            result["spectrum_path"] = str(folder/"spectrum.png")
        except ImportError:
            result["warnings"].append("spectrum renderer unavailable")
    return finish()
