"""Run the public breathing inputs through the PRIMARY pipeline (task A1, docs/tasks/eric-remaining.md).

The reference numbers in codex-reference/ measure the reference code. This script feeds the
same windows through perception.breathing.analyze, the entry point scripts/analyze_clip.py and
the service use, and writes one row per window and mode.

Sources (each is skipped with a note when its files are missing):
  synthetic  the 15 cases of scripts/make_synthetic.py, known rates (generated if missing)
  vrwi       4 VRWi windows, one seated subject, belt-derived truth
             (prepare with codex-reference/scripts/prepare_reference_clips.py)
  mpsc       16 MPSC-RR windows, NO public rate labels: coverage and abstentions only
             (prepare with codex-reference/scripts/prepare_public_clips.py)

Modes:
  reference  operator ROI where the reference run had one (synthetic torso, VRWi torso box),
             center ROI for MPSC-RR, YOLO off: the same inputs as the reference "ours" runs
  service    no operator ROI, YOLO on as config.toml sets it: what the service does with an
             uploaded clip and no chest box

Usage:
  python scripts/benchmark_public.py                                  # every source, both modes
  python scripts/benchmark_public.py --source synthetic --mode reference
  python scripts/benchmark_public.py --score --debug-dir data/derived/benchmark   # A3: score and roi.jpg
"""

from __future__ import annotations

import argparse
import csv
import json
import platform
import statistics
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # backend/perception
REPO = ROOT.parent.parent
for p in (ROOT, ROOT / "scripts"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

import analyze_clip  # noqa: E402  (try_score, shared with the CLI)
import make_synthetic  # noqa: E402
from perception import breathing  # noqa: E402
from perception.config import load_config  # noqa: E402

REF = ROOT / "codex-reference"
DEFAULT_SYNTHETIC_DIR = ROOT / "data" / "benchmarks" / "synthetic"
DEFAULT_VRWI_CASES = REF / "data" / "vrwi" / "cases.json"
DEFAULT_MPSC_DIR = REF / "testdata" / "public"
DEFAULT_OUT = ROOT / "testdata" / "public" / "primary-results.json"
SOURCES = ("synthetic", "vrwi", "mpsc")
MODES = ("reference", "service")
WITHIN_BPM = 3.0  # the "within 3/min" column of docs/research/breathing-repos.md


def rel(path) -> str:
    """Repo-relative path, so results do not show the laptop's home folder."""
    p = Path(path).resolve()
    try:
        return str(p.relative_to(REPO))
    except ValueError:
        return str(p)


def synthetic_cases(folder: Path, names=None) -> list[dict]:
    """Known-truth cases. truth_bpm is set only where the clip has one clean rate."""
    cases = []
    for name, case in make_synthetic.CASES.items():
        if names and name not in names:
            continue
        path = folder / f"{name}.avi"
        if not path.exists():
            make_synthetic.make_clip(path, **case["params"])
        params = case["params"]
        clean = case["expect"] in ("detected", "detected_or_unknown") and params.get("motion", "torso") == "torso"
        cases.append({"source": "synthetic", "subject": "synthetic", "window": name, "file": path,
                      "truth_bpm": round(60 * params.get("f", 0.25), 2) if clean else None,
                      "expect": case["expect"], "roi": make_synthetic.TORSO_ROI})
    return cases


def vrwi_cases(path: Path) -> list[dict]:
    if not path.exists():
        return []
    cases = []
    for row in json.loads(path.read_text()):
        cases.append({"source": "vrwi", "subject": row["subject"], "window": f"{row['start_s']:03d}s",
                      "file": Path(row["file"]), "truth_bpm": row.get("truth_bpm"),
                      "reference_accepted": row.get("reference_accepted"), "roi": tuple(row["roi"])})
    return cases


def mpsc_cases(folder: Path) -> list[dict]:
    truth = folder / "truth.csv"
    if not truth.exists():
        return []
    cases = []
    with truth.open(newline="") as f:
        for row in csv.DictReader(f):
            clip = folder / row["file"]
            stem = Path(row["file"]).stem  # s1_front_030s
            # Never accuracy: the pinned release has no rate labels (truth_bpm is empty).
            cases.append({"source": "mpsc", "subject": row["who"], "window": stem, "file": clip,
                          "truth_bpm": None, "split": row["split"], "roi": None})
    return cases


def run_case(case: dict, mode: str, base_cfg: dict, score_cfg: dict, *, score: bool, debug_dir):
    cfg = dict(base_cfg)
    roi = None
    if mode == "reference":
        cfg["yolo_enabled"] = False
        roi = case["roi"]
    out_dir = None
    if debug_dir:
        out_dir = str(Path(debug_dir) / mode / case["source"] / case["window"])
    row = {k: v for k, v in case.items() if k not in ("file", "roi")}
    row.update({"file": rel(case["file"]), "mode": mode,
                "operator_roi": list(roi) if roi else None})
    if not Path(case["file"]).exists():
        row.update({"error": "clip missing"})
        return row
    t0 = time.perf_counter()
    try:
        r = breathing.analyze(str(case["file"]), roi=roi, cfg=cfg, out_dir=out_dir)
    except Exception as exc:  # a crash is a result, not a reason to stop the run
        row.update({"error": f"{type(exc).__name__}: {exc}"})
        return row
    row.update({
        "result": r["breathing"], "rate_bpm": r["rate_bpm"], "confidence": r["breathing_confidence"],
        "reason": (r["reasons"] or [None])[0], "reasons": r["reasons"], "warnings": r["warnings"],
        "abstained": r["breathing"] == breathing.UNKNOWN, "roi_source": r["roi_source"],
        "visibility_pct": r["visibility_pct"], "runtime_s": round(time.perf_counter() - t0, 2),
    })
    if case.get("truth_bpm") is not None and r["rate_bpm"] is not None:
        row["abs_error_bpm"] = round(abs(r["rate_bpm"] - case["truth_bpm"]), 2)
    if case.get("expect"):
        row["expect_met"] = expect_met(case["expect"], case.get("truth_bpm"), r)
    if score:
        s, note = analyze_clip.try_score(r, score_cfg)
        row["score"] = s if s is not None else {"error": note}
    return row


def expect_met(expect: str, truth, r: dict) -> bool:
    """The same expectations tests/test_breathing_synthetic.py checks, as one flag per row."""
    b, rate, conf = r["breathing"], r["rate_bpm"], r["breathing_confidence"]
    if expect == "detected":
        return b == "detected" and truth is not None and abs(rate - truth) <= 1.5
    if expect == "detected_or_unknown":
        return b == "unknown" or (b == "detected" and truth is not None and abs(rate - truth) <= 1.5)
    if expect == "not_detected":
        return b != "detected"
    if expect == "not_confidently_wrong":
        return b != "detected" or conf < 0.5
    return b == "unknown" and expect in r["reasons"]  # a gate reason, for example "clip too dark, needs light"


def summarize(rows: list[dict]) -> dict:
    """Per source and mode. MPSC-RR rows never get accuracy fields."""
    out: dict = {}
    for row in rows:
        out.setdefault(f"{row['source']}/{row['mode']}", []).append(row)
    summary = {}
    for key, group in out.items():
        ok = [r for r in group if "error" not in r]
        s = {"windows": len(group), "failures": len(group) - len(ok),
             "detected": sum(r["result"] == "detected" for r in ok),
             "not_detected": sum(r["result"] == "not_detected" for r in ok),
             "abstained": sum(r["abstained"] for r in ok),
             "abstain_reasons": dict(sorted(_count(r["reason"] for r in ok if r["abstained"]).items()))}
        s["coverage"] = round(s["detected"] / len(group), 3) if group else None
        if ok:
            s["median_confidence"] = round(statistics.median(r["confidence"] for r in ok), 2)
        labelled = [r for r in ok if r.get("truth_bpm") is not None]
        if key.startswith("mpsc/"):
            s["accuracy"] = "not reported: MPSC-RR has no public rate labels"
        elif labelled:
            errs = [r["abs_error_bpm"] for r in labelled if "abs_error_bpm" in r]
            s["labelled_windows"] = len(labelled)
            s["labelled_with_rate"] = len(errs)
            s["mae_bpm"] = round(statistics.mean(errs), 2) if errs else None
            s["within_3_bpm"] = f"{sum(e <= WITHIN_BPM for e in errs)}/{len(labelled)}"
            conf = [r for r in labelled if "abs_error_bpm" in r and r["confidence"] >= 0.5]
            s["confident_within_3_bpm"] = f"{sum(r['abs_error_bpm'] <= WITHIN_BPM for r in conf)}/{len(conf)}"
        if any("expect_met" in r for r in ok):
            s["expect_met"] = f"{sum(r.get('expect_met', False) for r in ok)}/{len(group)}"
        summary[key] = s
    return summary


def _count(values) -> dict:
    counts: dict = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    return counts


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", action="append", choices=SOURCES, help="repeatable; default every source")
    ap.add_argument("--mode", action="append", choices=MODES, help="repeatable; default both")
    ap.add_argument("--case", action="append", help="synthetic case name (repeatable); default every case")
    ap.add_argument("--synthetic-dir", type=Path, default=DEFAULT_SYNTHETIC_DIR)
    ap.add_argument("--vrwi-cases", type=Path, default=DEFAULT_VRWI_CASES)
    ap.add_argument("--mpsc-dir", type=Path, default=DEFAULT_MPSC_DIR)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--score", action="store_true", help="also compute the critical score per row (A3)")
    ap.add_argument("--debug-dir", type=Path, default=None, help="write result.json, roi.jpg, spectrum.png per row")
    args = ap.parse_args(argv)

    service_cfg = load_config()
    base_cfg = dict(service_cfg["breathing"])
    sources = args.source or list(SOURCES)
    modes = args.mode or list(MODES)

    cases, notes = [], []
    if "synthetic" in sources:
        cases += synthetic_cases(args.synthetic_dir, args.case)
    if "vrwi" in sources:
        found = vrwi_cases(args.vrwi_cases)
        cases += found
        if not found:
            notes.append(f"vrwi skipped: {rel(args.vrwi_cases)} missing")
    if "mpsc" in sources:
        found = mpsc_cases(args.mpsc_dir)
        cases += found
        if not found:
            notes.append(f"mpsc skipped: no truth.csv in {rel(args.mpsc_dir)}")
    for n in notes:
        print(n, file=sys.stderr)

    rows = []
    for mode in modes:
        for case in cases:
            row = run_case(case, mode, base_cfg, service_cfg["score"], score=args.score, debug_dir=args.debug_dir)
            rows.append(row)
            shown = row.get("error") or f"{row['result']} rate={row['rate_bpm']} conf={row['confidence']} {row['reason'] or ''}"
            print(f"{mode:9s} {row['source']:9s} {row['window']:16s} {shown}", file=sys.stderr, flush=True)

    report = {
        "checked": date.today().isoformat(),
        "pipeline": "primary (perception.breathing.analyze)",
        "platform": platform.platform(),
        "modes": {"reference": "operator ROI where the reference had one, center ROI for MPSC-RR, YOLO off",
                  "service": "no operator ROI, YOLO as config.toml sets it"},
        "limitations": [
            "VRWi: four windows from one seated subject; belt-derived truth; time-zero alignment follows the authors' preprocessing and was not independently verified.",
            "MPSC-RR has no public rate labels in the pinned release; its rows report coverage and abstentions only, never accuracy.",
            "Synthetic clips have known rates but are not camera footage.",
            "No threshold was tuned on these windows for this run.",
        ],
        "notes": notes,
        "summary": summarize(rows),
        "rows": rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, default=str) + "\n")
    print(json.dumps(report["summary"], indent=2))
    print(f"wrote {len(rows)} rows to {rel(args.out)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
