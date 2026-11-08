"""Train the terrain linear probe and write its evaluation report (perception.md section 9).

Frozen CLIP image embeddings plus sklearn LogisticRegression, trained only on
human labels, split by run (never by frame), with one full run held out.

    python scripts/train_terrain.py --labels data/terrain_labels.csv --test-run 3

Inputs: the labels CSV from scripts/label_terrain.py
(image_name, run_id, rule_class, human_class, labelled_by) and the image files,
found by name under --images (default data/media, searched recursively).

Outputs:
  data/terrain_model.joblib   {"classifier", "classes", "clip_model", ...}, loaded by terrain.py
  data/terrain_report.json    confusion matrices, per-class precision and recall,
                              recall on gap/step/blocked, agreement with the rule
                              class, latency p50 and p95, baseline versus probe,
                              and probe_beats_baseline (turn the hint on only if true)
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from perception import terrain  # noqa: E402

DANGER = ("gap", "step", "blocked")
IMAGE_EXTS = (".jpg", ".jpeg", ".png")


def read_labels(path: Path) -> list[dict]:
    rows = []
    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            human = (row.get("human_class") or "").strip()
            if human not in terrain.TERRAIN_CLASSES:
                continue  # skipped or unlabelled frames are not training data
            rows.append(
                {
                    "image_name": row["image_name"].strip(),
                    "run_id": str(row.get("run_id", "0")).strip() or "0",
                    "rule_class": (row.get("rule_class") or "unknown").strip(),
                    "human_class": human,
                }
            )
    return rows


def index_images(dirs: list[Path]) -> dict[str, Path]:
    found: dict[str, Path] = {}
    for d in dirs:
        if d.is_file():
            found.setdefault(d.name, d)
            continue
        for p in d.rglob("*"):
            if p.suffix.lower() in IMAGE_EXTS:
                found.setdefault(p.name, p)
    return found


def metrics(truth: list[str], pred: list[str], rules: list[str]) -> dict:
    from sklearn.metrics import confusion_matrix, precision_recall_fscore_support

    labels = list(terrain.TERRAIN_CLASSES)
    cm = confusion_matrix(truth, pred, labels=labels)
    prec, rec, _, support = precision_recall_fscore_support(truth, pred, labels=labels, zero_division=0)
    per_class = {
        c: {"precision": round(float(p), 3), "recall": round(float(r), 3), "support": int(n)}
        for c, p, r, n in zip(labels, prec, rec, support)
    }
    n = len(truth)
    agree = [p == r for p, r in zip(pred, rules)]
    disagreements = [(t, p, r) for t, p, r, a in zip(truth, pred, rules, agree) if not a]
    sided_camera = sum(1 for t, p, r in disagreements if t == p)
    sided_rules = sum(1 for t, p, r in disagreements if t == r)
    return {
        "n": n,
        "accuracy": round(float(np.mean([t == p for t, p in zip(truth, pred)])) if n else 0.0, 3),
        "labels": labels,
        "confusion_matrix": cm.tolist(),
        "per_class": per_class,
        "danger_recall": {c: per_class[c]["recall"] for c in DANGER},
        "agreement_with_rules": round(float(np.mean(agree)) if n else 0.0, 3),
        "disagreements": {
            "count": len(disagreements),
            "human_sided_with_camera": sided_camera,
            "human_sided_with_rules": sided_rules,
            "human_sided_with_neither": len(disagreements) - sided_camera - sided_rules,
        },
    }


def beats(probe: dict, base: dict) -> bool:
    """The probe must be at least as good on every dangerous class that has test
    examples, and strictly better in accuracy."""
    for c in DANGER:
        if probe["per_class"][c]["support"] == 0:
            continue
        if probe["danger_recall"][c] < base["danger_recall"][c]:
            return False
    return probe["accuracy"] > base["accuracy"]


def percentile_ms(values: list[float], q: float) -> float:
    return round(float(np.percentile(values, q)) * 1000, 1) if values else 0.0


def default_embed(images: list) -> np.ndarray:
    return terrain.embed_images(images)


def default_zero_shot(emb: np.ndarray) -> list[str]:
    s = terrain.settings()
    out = []
    for row in emb:
        p = terrain._model.zero_shot(row.reshape(1, -1))[0]
        cls, _ = terrain.decide(dict(zip(terrain.MODEL_CLASSES, map(float, p))), float(s["terrain_min_conf"]))
        out.append(cls)
    return out


def main(argv: list[str] | None = None, embed_fn=None, zero_shot_fn=None) -> dict:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--labels", type=Path, default=ROOT / "data" / "terrain_labels.csv")
    ap.add_argument("--images", type=Path, nargs="*", default=[ROOT / "data" / "media"])
    ap.add_argument("--test-run", help="run_id held out as the test set (default: the last run)")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "terrain_model.joblib")
    ap.add_argument("--report", type=Path, default=ROOT / "data" / "terrain_report.json")
    ap.add_argument("--C", type=float, default=1.0, help="inverse regularization strength")
    args = ap.parse_args(argv)

    embed_fn = embed_fn or default_embed
    zero_shot_fn = zero_shot_fn or default_zero_shot
    min_conf = float(terrain.settings()["terrain_min_conf"])

    rows = read_labels(args.labels)
    images = index_images(list(args.images))
    missing = [r["image_name"] for r in rows if r["image_name"] not in images]
    rows = [r for r in rows if r["image_name"] in images]
    if missing:
        print(f"warning: {len(missing)} labelled images not found, skipped", file=sys.stderr)
    runs = sorted({r["run_id"] for r in rows}, key=lambda x: (len(x), x))
    if len(runs) < 2:
        raise SystemExit("need labels from at least two runs (split by run, one full run held out)")
    test_run = args.test_run if args.test_run is not None else runs[-1]
    if test_run not in runs:
        raise SystemExit(f"test run {test_run} has no labelled frames; runs: {runs}")
    train = [r for r in rows if r["run_id"] != test_run]
    test = [r for r in rows if r["run_id"] == test_run]
    if len({r["human_class"] for r in train}) < 2:
        raise SystemExit("training runs need at least two classes")

    # Embeddings for training (batched).
    train_emb = embed_fn([terrain.to_pil(images[r["image_name"]]) for r in train])
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    # Standardize first: normalized CLIP embeddings have tiny per-feature spread,
    # so an unscaled LogisticRegression underfits and every class stays below
    # terrain_min_conf.
    clf = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=args.C, class_weight="balanced"))
    clf.fit(train_emb, [r["human_class"] for r in train])

    # Test set, one image at a time from file read to classified, for latency.
    probe_pred, test_embs, lat = [], [], []
    for r in test:
        t0 = time.perf_counter()
        img = terrain.to_pil(images[r["image_name"]])
        emb = embed_fn([img])
        p = clf.predict_proba(emb)[0]
        cls, _ = terrain.decide(dict(zip(map(str, clf.classes_), map(float, p))), min_conf)
        lat.append(time.perf_counter() - t0)
        probe_pred.append(cls)
        test_embs.append(emb[0])
    base_pred = list(zero_shot_fn(np.stack(test_embs)))

    truth = [r["human_class"] for r in test]
    rules = [r["rule_class"] for r in test]
    probe_m = metrics(truth, probe_pred, rules)
    base_m = metrics(truth, base_pred, rules)
    report = {
        "trained_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "clip_model": terrain.settings()["terrain_clip_model"],
        "train_runs": [x for x in runs if x != test_run],
        "test_run": test_run,
        "n_train": len(train),
        "n_test": len(test),
        "train_class_counts": {c: sum(1 for r in train if r["human_class"] == c) for c in terrain.TERRAIN_CLASSES},
        "latency_ms": {"p50": percentile_ms(lat, 50), "p95": percentile_ms(lat, 95)},
        "linear_probe": probe_m,
        "zero_shot": base_m,
        "probe_beats_baseline": beats(probe_m, base_m),
    }

    import joblib

    args.out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "classifier": clf,
            "classes": [str(c) for c in clf.classes_],
            "clip_model": report["clip_model"],
            "trained_at": report["trained_at"],
            "train_runs": report["train_runs"],
            "test_run": test_run,
        },
        args.out,
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2))
    print(
        f"probe accuracy {probe_m['accuracy']} vs zero-shot {base_m['accuracy']}; "
        f"danger recall probe {probe_m['danger_recall']} vs zero-shot {base_m['danger_recall']}; "
        f"latency p50 {report['latency_ms']['p50']} ms, p95 {report['latency_ms']['p95']} ms; "
        f"probe beats baseline: {report['probe_beats_baseline']}"
    )
    print(f"wrote {args.out} and {args.report}")
    return report


if __name__ == "__main__":
    main()
