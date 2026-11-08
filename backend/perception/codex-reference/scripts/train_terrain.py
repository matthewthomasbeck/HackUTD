"""Frozen CLIP embeddings plus a run-separated logistic regression probe.

This script requires independently labelled images, which may be public images.
It never manufactures labels from the classifier's own predictions.
"""
import argparse
from collections import Counter
import csv
import json
from pathlib import Path
import sys
import time
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix,precision_recall_fscore_support,accuracy_score
from perception.config import load_config
from perception.terrain import TerrainClassifier,CLASSES


def metrics(truth,predicted):
    precision,recall,_,support = precision_recall_fscore_support(truth,predicted,labels=CLASSES,zero_division=0)
    return {"confusion_matrix":confusion_matrix(truth,predicted,labels=CLASSES).tolist(),
        "per_class":{c:{"precision":float(precision[i]),"recall":float(recall[i]),"support":int(support[i])}
                     for i,c in enumerate(CLASSES)},"accuracy":float(accuracy_score(truth,predicted))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--labels",type=Path,required=True)
    parser.add_argument("--test-run",required=True)
    parser.add_argument("--out",type=Path,default=ROOT/"data")
    args = parser.parse_args()
    rows = list(csv.DictReader(args.labels.open()))
    required = {"image_name","run_id","rule_class","human_class","labelled_by"}
    if not rows or not required.issubset(rows[0]):
        parser.error("labels need image_name,run_id,rule_class,human_class,labelled_by")
    if any(r["human_class"] not in CLASSES or not r["labelled_by"].strip() for r in rows):
        parser.error("each row needs an independent label and annotator")
    train = [r for r in rows if r["run_id"] != args.test_run]
    test = [r for r in rows if r["run_id"] == args.test_run]
    if not train or not test or len({r["human_class"] for r in train}) < 2:
        parser.error("need at least two training classes and a separate held-out source/run")
    def path(row):
        source = Path(row["image_name"])
        return source if source.is_absolute() else args.labels.parent/source
    if {str(path(r).resolve()) for r in train} & {str(path(r).resolve()) for r in test}:
        parser.error("same image cannot be in train and held-out sets")
    classifier = TerrainClassifier(load_config())
    train_x = np.array([classifier.embed(path(row)) for row in train])
    model = LogisticRegression(max_iter=1000,random_state=7).fit(train_x,[r["human_class"] for r in train])
    predicted,baseline,timings = [],[],[]
    for row in test:
        start = time.monotonic()
        probabilities = model.predict_proba([classifier.embed(path(row))])[0]
        index = int(probabilities.argmax())
        predicted.append(str(model.classes_[index]) if probabilities[index] >= 0.5 else "unknown")
        timings.append(1000*(time.monotonic()-start))
        baseline.append(classifier.predict_baseline(path(row))[0])
    truth = [r["human_class"] for r in test]
    probe_metrics,baseline_metrics = metrics(truth,predicted),metrics(truth,baseline)
    train_counts = Counter(r["human_class"] for r in train)
    critical = ["gap","step","blocked"]
    enough = all(train_counts[c] >= 50 for c in CLASSES[:5]) and all(probe_metrics["per_class"][c]["support"] for c in critical)
    recalls_ok = all(probe_metrics["per_class"][c]["recall"] >= baseline_metrics["per_class"][c]["recall"] for c in critical)
    p95 = float(np.percentile(timings,95))
    report = {"class_order":CLASSES,"test_run":args.test_run,"train_count":len(train),"test_count":len(test),
        "train_class_counts":dict(train_counts),"probe":probe_metrics,"baseline":baseline_metrics,
        "latency_ms":{"p50":float(np.percentile(timings,50)),"p95":p95},
        "rule_agreement":float(np.mean([p==r["rule_class"] for p,r in zip(predicted,test)])),
        "probe_beats_baseline":bool(enough and recalls_ok and probe_metrics["accuracy"] > baseline_metrics["accuracy"] and p95<300),
        "limits":"Public-image performance does not establish mock-rubble or robot-camera performance."}
    args.out.mkdir(parents=True,exist_ok=True)
    joblib.dump(model,args.out/"terrain_model.joblib")
    (args.out/"terrain-evaluation.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))


if __name__ == "__main__":
    main()
