"""A2: develop a gate threshold, freeze it, then evaluate without reselection.

Run `python scripts/audit_quality_gates.py develop`, then `... evaluate`.
Uses local prepared A1 inputs; never downloads data or contacts the database.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import benchmark_public as bench
from perception import breathing
from perception.config import load_config

OUT = bench.ROOT / "testdata/public"
DEV = ("030s", "060s")
HELD = ("090s", "120s")
# Fixed before A2 reruns. Choose the smallest relaxation that recovers development
# rates within 3/min in both modes while preserving all synthetic expectations.
CANDIDATES = (0.5, 0.6, 0.7, 0.8, 0.9)


def run(cases, cfg, variant):
    rows = []
    for case in cases:
        modes = ("reference",) if case["source"] == "synthetic" else bench.MODES
        for mode in modes:
            c = dict(cfg)
            if mode == "reference":
                c["yolo_enabled"] = False
            result = breathing.analyze(str(case["file"]),
                                       roi=case["roi"] if mode == "reference" else None, cfg=c)
            row = {k: v for k, v in case.items() if k not in ("file", "roi")}
            row.update(file=bench.rel(case["file"]), mode=mode, variant=variant,
                       result=result["breathing"], rate_bpm=result["rate_bpm"],
                       confidence=result["breathing_confidence"],
                       reason=next(iter(result["reasons"]), None),
                       abstained=result["breathing"] == "unknown",
                       quality=result["quality"], debug=result["debug"],
                       roi_source=result["roi_source"])
            if case.get("truth_bpm") is not None and result["rate_bpm"] is not None:
                row["abs_error_bpm"] = round(abs(result["rate_bpm"] - case["truth_bpm"]), 2)
            if case.get("expect"):
                row["expect_met"] = bench.expect_met(case["expect"], case.get("truth_bpm"), result)
            rows.append(row)
            print(variant, case["source"], mode, case["window"], row["result"], row["rate_bpm"],
                  row["reason"], flush=True)
    return rows


def eligible(rows):
    return bool(rows) and all(r.get("expect_met", False) if r["source"] == "synthetic"
               else r.get("abs_error_bpm", float("inf")) <= bench.WITHIN_BPM for r in rows)


def checked_cases():
    vrwi = bench.vrwi_cases(bench.DEFAULT_VRWI_CASES)
    mpsc = bench.mpsc_cases(bench.DEFAULT_MPSC_DIR)
    if {r["window"] for r in vrwi} != set(DEV + HELD) or len(mpsc) != 16:
        raise ValueError("Prepare all four VRWi and sixteen MPSC-RR windows first")
    if any(not Path(c["file"]).is_file() for c in vrwi + mpsc):
        raise FileNotFoundError("A prepared public clip is missing")
    return vrwi, mpsc


def write(path, report):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + "\n")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("stage", choices=("develop", "evaluate"))
    ap.add_argument("--out-dir", type=Path, default=OUT)
    args = ap.parse_args(argv)
    freeze = args.out_dir / "quality-gates-development.json"
    vrwi, mpsc = checked_cases()
    # Explicitly ignore .env and exported tuning overrides for repeatable results.
    cfg = load_config(env_path="/dev/null", environ={})["breathing"]
    cfg["flicker_c_max"] = 0.5  # A1 baseline, even after config.toml adopts A2's choice.
    if args.stage == "develop":
        if freeze.exists():
            raise FileExistsError("Development is frozen; use a new output directory for a new study")
        cases = [c for c in vrwi if c["window"] in DEV]
        cases += bench.synthetic_cases(bench.DEFAULT_SYNTHETIC_DIR)
        trials = []
        for threshold in CANDIDATES:
            candidate = {**cfg, "flicker_c_max": threshold}
            rows = run(cases, candidate, f"flicker_c_max={threshold}")
            trials.append({"flicker_c_max": threshold, "eligible": eligible(rows),
                           "summary": bench.summarize(rows), "rows": rows})
            if trials[-1]["eligible"]:
                break
        selected = next((t["flicker_c_max"] for t in trials if t["eligible"]), cfg["flicker_c_max"])
        write(freeze, {"development": DEV, "held_out": HELD,
                      "limitations": "All four VRWi windows were seen in A1; one subject, temporal split only, not an independent test.",
                      "selection_rule": "First candidate with all development rates within 3/min and all synthetic expectations passing; otherwise retain baseline.",
                      "candidates": CANDIDATES, "base_config": breathing._public_params(cfg),
                      "selected_overrides": {"flicker_c_max": selected}, "trials": trials})
    else:
        frozen_bytes = freeze.read_bytes()
        frozen = json.loads(frozen_bytes)
        # Use the actual frozen base configuration, even if config.toml has changed.
        cfg = dict(frozen["base_config"])
        weights = Path(cfg["yolo_weights_dir"])
        if not weights.is_absolute():
            cfg["yolo_weights_dir"] = str(bench.ROOT / weights)
        selected = {**cfg, **frozen["selected_overrides"]}
        cases = [c for c in vrwi if c["window"] in HELD] + mpsc
        rows = run(cases, cfg, "baseline") + run(cases, selected, "selected")
        # Diagnostic ceiling only. Gate bypass is never a deployment candidate;
        # it reveals whether a rejected window hides a usable or wrong rate.
        bypass = {**cfg, "flicker_c_max": 2.0, "bg_ratio_max": float("inf")}
        rows += run(cases + [c for c in vrwi if c["window"] in DEV], bypass, "both_gates_bypassed")
        write(args.out_dir / "quality-gates-evaluation.json", {
            "freeze_sha256": hashlib.sha256(frozen_bytes).hexdigest(),
            "selected_overrides": frozen["selected_overrides"],
            "summary": {v: bench.summarize([r for r in rows if r["variant"] == v])
                        for v in ("baseline", "selected", "both_gates_bypassed")}, "rows": rows})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
