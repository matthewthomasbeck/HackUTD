"""scripts/benchmark_public.py on synthetic cases only (task A1): fast, no downloads.

A few cases keep the run short; tests/test_breathing_synthetic.py covers the full table.
"""

from __future__ import annotations

import json

from _synth_helpers import load_script

bench = load_script("benchmark_public")

CASES = ["f0.25", "f0.6", "still", "dark"]


def test_synthetic_reference_mode(tmp_path):
    out = tmp_path / "results.json"
    args = ["--source", "synthetic", "--mode", "reference", "--synthetic-dir", str(tmp_path / "clips"),
            "--out", str(out)]
    for c in CASES:
        args += ["--case", c]
    assert bench.main(args) == 0
    report = json.loads(out.read_text())
    rows = {r["window"]: r for r in report["rows"]}
    assert set(rows) == set(CASES)
    for name in ("f0.25", "f0.6"):
        r = rows[name]
        assert r["result"] == "detected", r["reasons"]
        assert r["abs_error_bpm"] <= 1.5  # the tolerance in test_breathing_synthetic.py
        assert r["confidence"] >= 0.5
    assert rows["still"]["result"] != "detected"
    assert rows["dark"]["abstained"] and rows["dark"]["reason"] == "clip too dark, needs light"
    s = report["summary"]["synthetic/reference"]
    assert s["expect_met"] == f"{len(CASES)}/{len(CASES)}"
    assert s["failures"] == 0


def test_mpsc_rows_never_get_accuracy():
    rows = [{"source": "mpsc", "mode": "service", "result": "detected", "rate_bpm": 14.0,
             "confidence": 0.8, "abstained": False, "reason": None, "truth_bpm": None}]
    s = bench.summarize(rows)["mpsc/service"]
    assert "mae_bpm" not in s and "within_3_bpm" not in s
    assert s["accuracy"].startswith("not reported")
