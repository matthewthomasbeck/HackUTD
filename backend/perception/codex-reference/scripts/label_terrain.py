"""Label existing public images or stored robot images without recording a dataset.

1-6 selects flat/debris/step/gap/blocked/unknown, Enter accepts a rule label,
s skips, q quits. Public images need source/license attribution separately.
"""
import argparse
import csv
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import cv2
from perception.terrain import CLASSES


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--frames",type=Path,required=True)
    parser.add_argument("--out",type=Path,default=ROOT/"data/terrain_labels.csv")
    parser.add_argument("--run-id",required=True,help="Source session or source group, preserved for held-out splits")
    parser.add_argument("--labelled-by",required=True)
    parser.add_argument("--rule-class",choices=CLASSES,default="unknown")
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True,exist_ok=True)
    existed = args.out.exists()
    old = list(csv.DictReader(args.out.open())) if existed else []
    labelled = {r["image_name"] for r in old}
    with args.out.open("a",newline="") as output:
        writer = csv.DictWriter(output,fieldnames=["image_name","run_id","rule_class","human_class","labelled_by"])
        if not existed:
            writer.writeheader()
        for path in sorted(args.frames.rglob("*")):
            if path.suffix.lower() not in {".png",".jpg",".jpeg"} or str(path.resolve()) in labelled:
                continue
            image = cv2.imread(str(path))
            if image is None:
                continue
            cv2.imshow(f"Terrain: {args.rule_class}; keys 1-6 / Enter / s / q",image)
            key = cv2.waitKey(0)&255
            if key == ord("q"):
                break
            if key in (10,13):
                label = args.rule_class
            elif ord("1") <= key <= ord("6"):
                label = CLASSES[key-ord("1")]
            else:
                continue
            writer.writerow(dict(image_name=str(path.resolve()),run_id=args.run_id,
                rule_class=args.rule_class,human_class=label,labelled_by=args.labelled_by))
            output.flush()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
