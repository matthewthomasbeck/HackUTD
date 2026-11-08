"""Prepare public VRWi clips with independent belt-derived reference rates.

Requires NumPy, SciPy, ffmpeg, and ffprobe. Sensor/video zero alignment follows
the authors' respWaveShaping code; this is an assumption, not independently
verified synchronization. No sensor extrapolation is permitted here.
"""
import csv
from datetime import datetime, time as time_of_day
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

import numpy as np
from scipy.signal import butter, detrend, find_peaks, sosfiltfilt

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/vrwi"


def belt_rate(path, start, duration):
    rows = list(csv.DictReader(path.open(), delimiter="\t"))
    def timestamp(value):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return datetime.combine(datetime.min.date(), time_of_day.fromisoformat(value))
    origin = timestamp(rows[0]["DateTime"])
    timestamps = []
    values = []
    for row in rows:
        elapsed = (timestamp(row["DateTime"]) - origin).total_seconds()
        if timestamps and elapsed <= timestamps[-1]:
            continue
        timestamps.append(elapsed)
        values.append(float(row["RespValue"]))
    if timestamps[0] > start or timestamps[-1] < start + duration:
        raise ValueError("Sensor does not cover this full window")
    times = np.arange(start, start + duration, 1 / 30)
    waveform = np.interp(times, timestamps, values)
    if not np.isfinite(waveform).all() or np.std(waveform) < 1e-9:
        raise ValueError("Invalid or flat reference waveform")
    waveform = sosfiltfilt(butter(2, [0.1, 1.0], fs=30, btype="bandpass", output="sos"), detrend(waveform))
    nfft = 8192
    power = abs(np.fft.rfft(waveform * np.hanning(len(waveform)), nfft)) ** 2
    frequencies = np.fft.rfftfreq(nfft, 1 / 30)
    indices = np.flatnonzero((frequencies >= 0.1) & (frequencies <= 1))
    peak = indices[np.argmax(power[indices])]
    peaks, _ = find_peaks(waveform, distance=15, prominence=float(np.std(waveform)) * .5)
    crossing_rate = 60 / float(np.median(np.diff(peaks) / 30)) if len(peaks) > 2 else None
    return {"fft_bpm": round(float(frequencies[peak] * 60), 2),
            "peak_interval_bpm": round(crossing_rate, 2) if crossing_rate else None,
            "peak_at_band_edge": bool(peak in (indices[0], indices[-1]))}


def main():
    manifest = json.loads((ROOT / "testdata/public/vrwi.json").read_text())
    DATA.mkdir(parents=True, exist_ok=True)
    cases = []
    for item in manifest["archives"]:
        archive = DATA / item["name"]
        temporary = archive.with_suffix(archive.suffix + ".part")
        if not archive.exists():
            if not temporary.exists() or temporary.stat().st_size != item["bytes"]:
                with urllib.request.urlopen(item["url"], timeout=60) as response:
                    with temporary.open("wb") as output:
                        shutil.copyfileobj(response, output)
            with temporary.open("rb") as stream:
                checksum = hashlib.file_digest(stream, "sha256").hexdigest()
            if checksum != item["sha256"]:
                raise ValueError("Archive checksum mismatch")
            temporary.replace(archive)
        with archive.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != item["sha256"]:
                raise ValueError("Archive checksum mismatch")
        with tarfile.open(archive) as source:
            for member in source:
                # Extract only regular resting-session video and belt files, no links.
                if not member.isfile() or "session_resting" not in member.name:
                    continue
                if Path(member.name).name not in ("video.mp4", "resp_value_thoracic.tsv", "resp_value_abdominal.tsv"):
                    continue
                target = DATA / "original" / member.name
                if not target.resolve().is_relative_to((DATA / "original").resolve()):
                    raise ValueError("Unsafe archive path")
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists():
                    with source.extractfile(member) as incoming, target.open("wb") as output:
                        shutil.copyfileobj(incoming, output)
        for video in (DATA / "original" / archive.stem).rglob("video.mp4"):
            for start in (30, 60, 90, 120):
                reference = {key: belt_rate(video.parent / f"resp_value_{key}.tsv", start, 20)
                             for key in ("thoracic", "abdominal")}
                thoracic, abdominal = reference["thoracic"]["fft_bpm"], reference["abdominal"]["fft_bpm"]
                acceptable = (abs(thoracic - abdominal) <= 3
                              and all(not r["peak_at_band_edge"] for r in reference.values())
                              and all(r["peak_interval_bpm"] is not None
                                      and abs(r["fft_bpm"] - r["peak_interval_bpm"]) <= 3 for r in reference.values()))
                clip = DATA / "clips" / f"{archive.stem}_resting_{start:03d}s.mp4"
                clip.parent.mkdir(exist_ok=True)
                if not clip.exists():
                    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start),
                                    "-i", str(video), "-t", "20", "-an", "-vf", "fps=30",
                                    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", str(clip)], check=True)
                probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
                                        "-show_entries", "stream=nb_read_frames", "-of", "json", str(clip)],
                                       capture_output=True, text=True, check=True)
                if int(json.loads(probe.stdout)["streams"][0]["nb_read_frames"]) != 600:
                    raise ValueError("Reference clip is not 600 frames")
                cases.append({"file": str(clip), "dataset": "VRWi", "subject": archive.stem,
                              "split": item["split"], "start_s": start,
                              "roi": [250, 550, 600, 500],
                              "roi_source": "visually selected torso box on M14 resting preview, not a breathing label",
                              "truth_bpm": round((thoracic + abdominal) / 2, 2) if acceptable else None,
                              "reference": reference, "reference_accepted": acceptable,
                              "label_source": "belt_fft_with_peak_and_dual_belt_checks",
                              "alignment": "video zero equals first sensor timestamp, per upstream preprocessing"})
    if not cases:
        raise ValueError("No resting-session inputs found in archive")
    (DATA / "cases.json").write_text(json.dumps(cases, indent=2) + "\n")
    print(f"Prepared {len(cases)} clips; {sum(row['reference_accepted'] for row in cases)} reference windows accepted.")


if __name__ == "__main__":
    main()
