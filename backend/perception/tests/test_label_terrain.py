"""Exercise the labeller's keyboard workflow without opening a window."""
import csv

import cv2
import numpy as np

from scripts import label_terrain


def run_labeller(tmp_path, monkeypatch, keys, count, extra=None):
    frames = tmp_path / "frames"
    frames.mkdir()
    for i in range(count):
        cv2.imwrite(str(frames / f"r7_dog1_terrain_{i}.png"), np.zeros((40, 40, 3), dtype=np.uint8))
    labels = tmp_path / "labels.csv"
    pending = iter(keys)
    monkeypatch.setattr(cv2, "imshow", lambda *_: None)
    monkeypatch.setattr(cv2, "destroyAllWindows", lambda: None)
    monkeypatch.setattr(cv2, "waitKey", lambda _: next(pending))
    label_terrain.main(["--frames", str(frames), "--labels", str(labels),
                        "--rules", str(tmp_path / "absent.csv"), "--labelled-by", "audit", *(extra or [])])
    return list(csv.DictReader(labels.open()))


def test_class_keys_and_default_rule(tmp_path, monkeypatch):
    rows = run_labeller(tmp_path, monkeypatch, [ord(k) for k in "123456"] + [13, ord("s")], 8)
    assert [r["human_class"] for r in rows] == ["flat", "debris", "step", "gap", "blocked", "unknown", "unknown"]
    assert all(r["run_id"] == "7" and r["labelled_by"] == "audit" for r in rows)


def test_back_relabels_without_duplicate_and_quit_saves(tmp_path, monkeypatch):
    rows = run_labeller(tmp_path, monkeypatch, [ord("1"), ord("b"), ord("4"), ord("q")], 2)
    assert len(rows) == 1
    assert rows[0]["image_name"] == "r7_dog1_terrain_0.png"
    assert rows[0]["human_class"] == "gap"
