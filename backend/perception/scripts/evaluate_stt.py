"""Evaluate the primary local STT path on voice fixtures and public speech.

Run from backend/perception with .venv/bin/python scripts/evaluate_stt.py.
Downloads only the pinned public audio fixture if absent. Model weights must
already be cached; use --allow-model-download to permit their first download.
Generated audio stays in git-ignored data/stt-evaluation/. No hosted ASR calls.
"""

from __future__ import annotations

import argparse
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import platform
import re
import statistics
import sys
import time
import urllib.request

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from perception import stt

REVISION = "846467d436117e44d54ad74f555d85c75834edb0"
PUBLIC_URL = f"https://raw.githubusercontent.com/SYSTRAN/faster-whisper/{REVISION}/tests/data/jfk.flac"
PUBLIC_SHA256 = "63a4b1e4c1dc655ac70961ffbf518acd249df237e5a0152faae9a4a836949715"
QUESTIONS = ("is_anyone_else_in_house_3", "how_many_still_unaccounted", "which_survivor_is_most_critical")


def words(text: str) -> list[str]:
    # The fixture's spoken digit and its written form are equivalent here.
    return re.findall(r"[a-z]+|[0-9]+", text.lower().replace("3", "three"))


def word_errors(reference: str, hypothesis: str) -> dict:
    ref, hyp = words(reference), words(hypothesis)
    previous = list(range(len(hyp) + 1))
    for i, a in enumerate(ref, 1):
        current = [i]
        for j, b in enumerate(hyp, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a != b)))
        previous = current
    return {"word_errors": previous[-1], "reference_words": len(ref),
            "wer": round(previous[-1] / len(ref), 4) if ref else None}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="small.en")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--allow-model-download", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "testdata/voice/stt-evaluation.json")
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    if not args.allow_model_download and not stt.whisper_weights_available(args.model):
        parser.error("model weights not cached; rerun with --allow-model-download on good internet")
    folder = ROOT / "data/stt-evaluation"
    folder.mkdir(parents=True, exist_ok=True)
    public = folder / "jfk.flac"
    if not public.exists():
        public.write_bytes(urllib.request.urlopen(PUBLIC_URL, timeout=30).read())
    if hashlib.sha256(public.read_bytes()).hexdigest() != PUBLIC_SHA256:
        raise ValueError("public fixture SHA256 mismatch")

    fixtures = []
    for name in QUESTIONS:
        path = ROOT / "testdata/voice" / f"{name}.wav"
        fixtures.append((name, stt.load_audio(str(path)), None, "repository_question_fixture", path))
    fixtures.append(("public_jfk_8s", stt.load_audio(str(public))[:8 * stt.SAMPLE_RATE],
                     "and so my fellow americans ask not what your country can do for you",
                     "public_speech", public))
    silence_path = ROOT / "testdata/voice/silence_2s.wav"
    fixtures.append(("fixture_silence_2s", stt.load_audio(str(silence_path)), "", "silence", silence_path))
    fixtures.append(("generated_silence_8s", np.zeros(8 * stt.SAMPLE_RATE, dtype=np.float32),
                     "", "silence", None))

    start = time.perf_counter()
    engine = stt.select_engine({"engine": "whisper_local", "whisper_model": args.model})
    startup_s = time.perf_counter() - start
    if engine != f"whisper_local:{args.model}":
        raise RuntimeError(f"requested local Whisper unavailable: selected {engine}")
    rows = []
    for index, (name, samples, truth, kind, source) in enumerate(fixtures):
        speech = kind != "silence"
        rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
        # Fixed independent Gaussian noise, scaled before PCM quantization.
        noise = np.random.default_rng(20261108 + index).standard_normal(len(samples))
        noise /= np.sqrt(np.mean(noise ** 2))
        levels = [("clean", 0.0, None)]
        if speech:
            levels += [("snr_20db", rms / 10, 20), ("snr_0db", rms, 0)]
        else:
            # SNR is undefined for silence, so report absolute noise RMS.
            levels += [("noise_rms_0.01", 0.01, None), ("noise_rms_0.1", 0.1, None)]
        for condition, noise_rms, snr_db in levels:
            mixed = samples + noise * noise_rms
            peak = float(np.max(np.abs(mixed)))
            gain = min(1.0, 0.99 / peak) if peak else 1.0
            path = folder / f"{name}-{condition}.wav"
            sf.write(path, mixed * gain, stt.SAMPLE_RATE, subtype="PCM_16")
            results, timings = [], []
            for _ in range(args.repeats):
                start = time.perf_counter()
                result = stt.transcribe(str(path))
                timings.append(time.perf_counter() - start)
                if result["engine"] != engine:
                    raise RuntimeError("Whisper failed during evaluation; refusing fallback results")
                results.append(result)
            row = {
                "fixture": name, "kind": kind, "condition": condition,
                "seconds": round(len(samples) / stt.SAMPLE_RATE, 4),
                "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest() if source else None,
                "snr_db": snr_db, "noise_rms_before_gain": round(noise_rms, 6), "gain": round(gain, 6),
                "reference_text": truth if kind == "public_speech" else None,
                "expected_speech": speech,
                "runs": [dict(r, elapsed_s=round(t, 4)) for r, t in zip(results, timings)],
                "median_s": round(statistics.median(timings), 4), "max_s": round(max(timings), 4),
                "all_transcripts_equal": len({r["transcript"] for r in results}) == 1,
                # Question filenames are hints, not independently verified transcripts.
                **(word_errors(truth, results[0]["transcript"]) if kind == "public_speech" else {}),
                "silence_pass": all(not r["transcript"] for r in results) if not speech else None,
            }
            rows.append(row)
            print(f"{name:36} {condition:17} {row['median_s']:6.3f}s {results[0]['transcript']!r}", flush=True)
    from faster_whisper.utils import download_model
    weights = Path(download_model(args.model, local_files_only=True))
    report = {
        "date": "2026-11-08", "engine": engine, "compute": "cpu/int8", "beam_size": 5,
        "vad_filter": True, "condition_on_previous_text": False, "no_speech_max": 0.6,
        "platform": platform.platform(), "processor": platform.processor(),
        "python": platform.python_version(),
        "versions": {p: version(p) for p in ("faster-whisper", "ctranslate2", "numpy", "soundfile")},
        "model_snapshot": weights.name,
        "weights_bytes": sum(p.stat().st_size for p in weights.rglob("*") if p.is_file()),
        "startup_with_silence_probe_s": round(startup_s, 4), "repeats": args.repeats,
        "source": {"url": PUBLIC_URL, "revision": REVISION, "sha256": PUBLIC_SHA256,
                   "transformation": "first 8 seconds after resampling to 16 kHz mono",
                   "license_note": "Upstream faster-whisper repository MIT license; JFK inaugural address is US federal government speech."},
        "limits": ["Question fixture recording provenance is not documented; no human-voice generalization claim.",
                   "One public speaker and three short question fixtures are a smoke evaluation, not an ASR benchmark.",
                   "Gaussian noise does not represent crowd speech, reverberation or robot noise.",
                   "Timings exclude model initialization/download and are affected by concurrent laptop work.",
                   "Confidence is the engine's segment log-probability estimate, not calibrated accuracy.",
                   "No hosted Riva, glasses microphone or live voice round trip was tested."],
        "rows": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    return 0 if all(row["silence_pass"] is not False for row in rows) else 1


if __name__ == "__main__":
    raise SystemExit(main())
