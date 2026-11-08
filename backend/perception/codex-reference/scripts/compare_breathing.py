"""Run pinned external methods and our pipeline in isolated, timed processes.

External sources stay under ignored data/benchmarks with their licenses.
Public unlabelled rates are comparisons, never accuracy ground truth.
"""
import argparse
import ast
import contextlib
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REFERENCES = ROOT / "data" / "benchmarks"


def prepare():
    manifest = json.loads((ROOT / "testdata/public/baselines.json").read_text())
    for entry in manifest:
        target = REFERENCES / entry["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            with urllib.request.urlopen(entry["url"], timeout=60) as response:
                target.write_bytes(response.read())
        if hashlib.sha256(target.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError(f"Reference checksum mismatch: {target}")


def reference_rate(values, fps):
    """Common harness readout for resPyre waveform functions, not its full evaluator."""
    import numpy as np
    from scipy.signal import butter, detrend, sosfiltfilt
    values = np.asarray(values, dtype=float)
    if not np.isfinite(values).all() or np.std(values) < 1e-9:
        return None
    values = sosfiltfilt(butter(2, [0.1, 1], fs=fps, btype="bandpass", output="sos"), detrend(values))
    nfft = max(4096, 2 ** int(np.ceil(np.log2(4 * len(values)))))
    power = abs(np.fft.rfft(values * np.hanning(len(values)), nfft)) ** 2
    frequencies = np.fft.rfftfreq(nfft, 1 / fps)
    selected = (frequencies >= 0.1) & (frequencies <= 1)
    return round(float(frequencies[selected][np.argmax(power[selected])]) * 60, 2)


def worker(method, path, roi):
    import cv2 as cv
    import numpy as np
    cv.setNumThreads(1)
    started = time.perf_counter()
    if method == "ours":
        sys.path.insert(0, str(ROOT))
        from perception.breathing import analyze_clip
        result = analyze_clip(path, roi=roi, config={"use_yolo": False})
        return {"rate_bpm": result.get("rate_bpm"), "decision": result.get("breathing"),
                "confidence": result.get("breathing_confidence"),
                "reasons": result.get("reasons", []), "runtime_s": time.perf_counter() - started}
    if method == "lightweight":
        sys.path.insert(0, str(REFERENCES / "lightweight"))
        # Upstream parses argv during import. Isolate it from this harness's flags.
        sys.argv = ["IOF.py"]
        from IOF import ImproveOpticalFlow
        with contextlib.redirect_stdout(io.StringIO()):
            values, fft, pc, cp, nfcp = ImproveOpticalFlow(
                str(path), QualityLevel=0.1, FSS=True, CGOF=True,
                filter=True, Normalization=True, RR_Evaluation=True)
        return {"rate_bpm": float(fft), "peak_count_bpm": float(pc),
                "crossing_bpm": float(cp), "feedback_bpm": float(nfcp),
                "decision": "unconditional_estimate", "confidence": None,
                "runtime_s": time.perf_counter() - started}
    cap = cv.VideoCapture(str(path))
    fps = cap.get(cv.CAP_PROP_FPS)
    frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        height, width = frame.shape[:2]
        x, y, w, h = roi or (int(width * .3), int(height * .3), int(width * .4), int(height * .4))
        gray = cv.cvtColor(frame[y:y+h, x:x+w], cv.COLOR_BGR2GRAY)
        frames.append(cv.resize(gray, (160, 120)))
    cap.release()
    from tqdm import tqdm
    source = ast.parse((REFERENCES / "respyre/motion.py").read_text())
    name = "OF" if method == "respyre_of" else "DoF"
    function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == name)
    namespace = {"cv": cv, "np": np, "time": time, "tqdm": tqdm}
    # Compile the exact pinned function without importing unrelated deep-model dependencies.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        exec(compile(ast.Module(body=[function], type_ignores=[]), "respyre/motion.py", "exec"), namespace)
        values, elapsed = namespace[name](frames, fps)
    return {"rate_bpm": reference_rate(values, fps), "decision": "waveform_with_harness_fft",
            "confidence": None, "runtime_s": time.perf_counter() - started,
            "upstream_extractor_s": elapsed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, help="JSON array: file, optional roi and truth_bpm")
    parser.add_argument("--output", type=Path, default=ROOT / "data/benchmarks/comparison.json")
    parser.add_argument("--methods", nargs="+", default=["respyre_of", "respyre_dof", "lightweight", "ours"])
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--worker", choices=["respyre_of", "respyre_dof", "lightweight", "ours"])
    parser.add_argument("--video", type=Path)
    parser.add_argument("--roi", type=str)
    args = parser.parse_args()
    if args.worker:
        try:
            roi = tuple(map(int, args.roi.split(","))) if args.roi else None
            print(json.dumps(worker(args.worker, args.video, roi), allow_nan=False))
        except Exception as error:
            print(json.dumps({"error": f"{type(error).__name__}: {error}"}))
        return
    prepare()
    if args.cases:
        cases = json.loads(args.cases.read_text())
    else:
        public = ROOT / "testdata/public"
        cases = [{"file": str(public / row["file"]), "split": row["split"],
                  "truth_bpm": None, "dataset": "MPSC-RR"}
                 for row in json.loads((public / "prepared.json").read_text())]
    results = []
    for case in cases:
        for method in args.methods:
            command = [sys.executable, str(Path(__file__).resolve()), "--worker", method,
                       "--video", str(Path(case["file"]).resolve())]
            if case.get("roi"):
                command += ["--roi", ",".join(map(str, case["roi"]))]
            try:
                run = subprocess.run(command, text=True, capture_output=True, timeout=args.timeout,
                                     env={**os.environ, "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1"})
                outcome = json.loads(run.stdout.strip().splitlines()[-1])
            except (subprocess.TimeoutExpired, ValueError, IndexError) as error:
                outcome = {"error": f"{type(error).__name__}: {error}"}
            row = {**case, "method": method, **outcome}
            truth = case.get("truth_bpm")
            if truth is not None and outcome.get("rate_bpm") is not None:
                row["absolute_error_bpm"] = abs(outcome["rate_bpm"] - truth)
            results.append(row)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(results, indent=2, allow_nan=False) + "\n")
            print(f"{Path(case['file']).name} {method}: {outcome}", flush=True)
    print(f"Wrote {len(results)} method runs to {args.output}")


if __name__ == "__main__":
    main()
