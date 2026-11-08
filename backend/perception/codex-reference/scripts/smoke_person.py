"""Verify real YOLO person confirmation on the public torso clip and a blank."""

import argparse
from contextlib import redirect_stdout
import hashlib
import json
import sys
import time
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from perception.roi import draw_person, model_status, person_check, select_roi


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clip",type=Path,default=ROOT/"testdata/public/clips/s1_front_030s.mp4")
    parser.add_argument("--out",type=Path,default=ROOT/"data/yolo-smoke")
    args = parser.parse_args()
    cv2.setNumThreads(1)
    capture = cv2.VideoCapture(str(args.clip))
    capture.set(cv2.CAP_PROP_POS_MSEC,5000)
    ok,image = capture.read()
    capture.release()
    if not ok:
        raise SystemExit("Run prepare_public_clips.py first, or provide a readable --clip.")
    args.out.mkdir(parents=True,exist_ok=True)
    started = time.perf_counter()
    with redirect_stdout(sys.stderr):
        check = person_check(image)
        selection = select_roi([image])
        blank = person_check(image*0)
    draw_person(image,check,args.out/"person.jpg")
    weights = {}
    for path in (ROOT/"data/models").glob("*.pt"):
        with path.open("rb") as source:
            weights[path.name] = hashlib.file_digest(source,"sha256").hexdigest()
    report = dict(source=str(args.clip),frame_time_s=5,model_status=model_status(),
                  person_confirmed=check["person_confirmed"],person_conf=check["person_conf"],
                  person_box=check["box"],roi_source=selection["roi_source"],roi=selection["roi"],
                  visibility_pct=selection["visibility_pct"],
                  blank_person_confirmed=blank["person_confirmed"],
                  blank_person_conf=blank["person_conf"],weights_sha256=weights,
                  elapsed_s=round(time.perf_counter()-started,3))
    report["passed"] = bool(check["person_confirmed"] and check["person_conf"]>=0.5
                            and not blank["person_confirmed"] and blank["person_conf"]==0)
    (args.out/"result.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report,indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
