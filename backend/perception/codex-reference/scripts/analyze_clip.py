"""Analyze a saved video without connecting to the database."""

import argparse
from contextlib import redirect_stdout
import json
import sys
import tomllib
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from perception.breathing import analyze_clip


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("clip",type=Path)
    parser.add_argument("--roi",help="x,y,w,h in original video pixels")
    parser.add_argument("--fps",type=float)
    parser.add_argument("--config",type=Path)
    parser.add_argument("--debug",action="store_true")
    parser.add_argument("--debug-dir",type=Path)
    parser.add_argument("--no-yolo",action="store_true")
    parser.add_argument("--score",action="store_true")
    args = parser.parse_args()
    config = {}
    if args.config:
        with args.config.open("rb") as source:
            config = tomllib.load(source)
    if args.no_yolo:
        config.setdefault("breathing",{})["use_yolo"] = False
    debug = args.debug_dir or (Path("data/derived")/args.clip.stem if args.debug else None)
    with redirect_stdout(sys.stderr):
        result = analyze_clip(args.clip,roi=args.roi,fps=args.fps,config=config,debug_dir=debug)
    if args.score:
        from perception.score import compute_score
        result["score"] = compute_score(
            breathing=result["breathing"],rate_bpm=result["rate_bpm"],
            breathing_confidence=result["breathing_confidence"],
            visibility_pct=result["visibility_pct"],clip_analyzed=True,
            gate_reasons=result["reasons"],config=config.get("score"))
    print(json.dumps(result,indent=2,allow_nan=False))


if __name__ == "__main__":
    main()
