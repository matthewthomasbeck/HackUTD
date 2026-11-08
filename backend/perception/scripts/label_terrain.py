"""Keyboard labelling of terrain frames (perception.md section 9, "Training data").

Shows each image with its rule class (the robot's weak label). Keys:
    1 flat   2 debris   3 step   4 gap   5 blocked   6 unknown
    Enter    accept the rule class
    s        skip this frame
    b        back one frame (re-label it)
    q / Esc  save and quit

Labels are appended to data/terrain_labels.csv
(image_name, run_id, rule_class, human_class, labelled_by); frames already
labelled are skipped, so a session can be resumed.

Rule classes come from, in order of precedence:
  --rules CSV        any CSV with image_name and rule_class (and optional run_id),
                     for example data/terrain_frames.csv written by POST /terrain
  --messages JSONL   a robot sensor log messages.jsonl: each {"type":"terrain"} line
                     with an image_path gives that image's terrain_class
Frames with no known rule class show "unknown".

--disagreements-first runs the camera model on every frame and shows the
frames where it disagrees with the rule class first (label these first).

    python scripts/label_terrain.py --frames data/media/run_0/dog1 --labelled-by eric
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from perception import terrain  # noqa: E402

FIELDS = ("image_name", "run_id", "rule_class", "human_class", "labelled_by")
KEY_CLASS = {ord(str(i + 1)): c for i, c in enumerate(terrain.TERRAIN_CLASSES)}
IMAGE_EXTS = (".jpg", ".jpeg", ".png")


def load_rules(rules_csv: Path | None, messages: Path | None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if messages and messages.exists():
        for line in messages.read_text().splitlines():
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "terrain" and msg.get("image_path"):
                out[Path(msg["image_path"]).name] = {"rule_class": msg.get("terrain_class", "unknown")}
    if rules_csv and rules_csv.exists():
        with open(rules_csv, newline="") as fh:
            for row in csv.DictReader(fh):
                if row.get("image_name"):
                    out[row["image_name"]] = {
                        "rule_class": row.get("rule_class") or "unknown",
                        "run_id": row.get("run_id") or None,
                    }
    return out


def already_labelled(path: Path) -> set[str]:
    if not path.exists():
        return set()
    with open(path, newline="") as fh:
        return {row["image_name"] for row in csv.DictReader(fh)}


def append_label(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    with open(path, "a", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        if new:
            w.writeheader()
        w.writerow(row)


def remove_label(path: Path, image_name: str) -> None:
    if not path.exists():
        return
    with open(path, newline="") as fh:
        rows = [r for r in csv.DictReader(fh) if r["image_name"] != image_name]
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--frames", type=Path, nargs="+", required=True, help="image files or folders")
    ap.add_argument("--labels", type=Path, default=ROOT / "data" / "terrain_labels.csv")
    ap.add_argument("--rules", type=Path, default=ROOT / "data" / "terrain_frames.csv")
    ap.add_argument("--messages", type=Path, help="robot sensor log messages.jsonl")
    ap.add_argument("--run-id", help="run id for frames whose name does not start with r<run_id>_")
    ap.add_argument("--labelled-by", default="unknown")
    ap.add_argument("--disagreements-first", action="store_true")
    args = ap.parse_args(argv)

    import cv2

    files: list[Path] = []
    for f in args.frames:
        if f.is_dir():
            files.extend(sorted(p for p in f.rglob("*") if p.suffix.lower() in IMAGE_EXTS))
        elif f.suffix.lower() in IMAGE_EXTS:
            files.append(f)
    rules = load_rules(args.rules, args.messages)
    done = already_labelled(args.labels)
    files = [f for f in files if f.name not in done]

    if args.disagreements_first:
        scored = []
        for f in files:
            cam, _ = terrain.classify(f)
            rule = rules.get(f.name, {}).get("rule_class", "unknown")
            scored.append((cam == rule, f))
        files = [f for _, f in sorted(scored, key=lambda x: x[0])]

    print(f"{len(files)} frames to label ({len(done)} already labelled)")
    i = 0
    history: list[int] = []
    while i < len(files):
        f = files[i]
        info = rules.get(f.name, {})
        rule = info.get("rule_class", "unknown")
        run_id = info.get("run_id") or args.run_id or terrain.run_id_from_name(f.name)
        img = cv2.imread(str(f))
        if img is None:
            print(f"cannot read {f}, skipped")
            i += 1
            continue
        scale = 720.0 / max(img.shape[:2])
        if scale < 1.0:
            img = cv2.resize(img, None, fx=scale, fy=scale)
        caption = f"{i + 1}/{len(files)}  rule: {rule}   1 flat 2 debris 3 step 4 gap 5 blocked 6 unknown  Enter=rule s=skip b=back q=quit"
        cv2.putText(img, caption, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
        cv2.putText(img, caption, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        cv2.imshow("label_terrain", img)
        key = cv2.waitKey(0) & 0xFF

        if key in (ord("q"), 27):
            break
        if key == ord("s"):
            history.append(i)
            i += 1
            continue
        if key == ord("b"):
            if history:
                i = history.pop()
                remove_label(args.labels, files[i].name)
            continue
        if key in (13, 10):
            human = rule
        elif key in KEY_CLASS:
            human = KEY_CLASS[key]
        else:
            continue
        append_label(
            args.labels,
            {"image_name": f.name, "run_id": run_id, "rule_class": rule, "human_class": human, "labelled_by": args.labelled_by},
        )
        history.append(i)
        i += 1

    cv2.destroyAllWindows()
    print(f"labels saved to {args.labels}")


if __name__ == "__main__":
    main()
