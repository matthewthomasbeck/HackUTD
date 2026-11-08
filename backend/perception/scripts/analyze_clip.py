"""Run the breathing pipeline on one clip and print the result JSON. No database.

Usage:
  python scripts/analyze_clip.py path/to/clip.mp4
  python scripts/analyze_clip.py clip.mp4 --roi 220,140,180,120     # operator chest box x,y,w,h
  python scripts/analyze_clip.py clip.mp4 --debug                   # keep debug fields, write roi.jpg etc.
  python scripts/analyze_clip.py clip.mp4 --score                   # also run perception.score if present

Options:
  --fps F        frame rate to use instead of the container's
  --out DIR      write result.json, roi.jpg, spectrum.png into DIR
  --no-yolo      skip YOLO (pose and box ROIs), so the ROI is operator or center
  --set k=v      override one breathing config value (repeatable), for example --set c_detect=0.4
"""

from __future__ import annotations

import argparse
import inspect
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from perception import breathing  # noqa: E402


def parse_roi(text: str):
    parts = [p.strip() for p in text.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("--roi needs x,y,w,h")
    try:
        return tuple(int(float(p)) for p in parts)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"--roi: {exc}") from exc


def parse_value(text: str):
    for cast in (int, float):
        try:
            return cast(text)
        except ValueError:
            pass
    if text.lower() in ("true", "false"):
        return text.lower() == "true"
    return text


def try_score(result: dict):
    """Call perception.score.compute_score if it exists. Returns (score dict or None, note or None)."""
    try:
        from perception.score import compute_score
    except Exception as exc:
        return None, f"perception.score not available ({type(exc).__name__}); score skipped"
    # Map the result to the score inputs of perception.md section 7. t (waiting minutes) is 0 and
    # d (thermal confidence) is unknown offline, so the score's own default for a missing d applies.
    names = {
        "b": result["breathing"], "breathing": result["breathing"],
        "rr": result["rate_bpm"], "rate_bpm": result["rate_bpm"],
        "q": result["breathing_confidence"], "breathing_confidence": result["breathing_confidence"],
        "visibility_pct": result["visibility_pct"],
        "v": None if result["visibility_pct"] is None else result["visibility_pct"] / 100.0,
        "t": 0.0, "wait_min": 0.0, "waiting_min": 0.0,
        "result": result, "breathing_result": result,
    }
    try:
        params = inspect.signature(compute_score).parameters
        kwargs = {k: names[k] for k in params if k in names}
        missing = [k for k, p in params.items()
                   if k not in kwargs and p.default is inspect.Parameter.empty
                   and p.kind in (p.POSITIONAL_OR_KEYWORD, p.KEYWORD_ONLY)]
        if missing:
            return None, f"compute_score needs {missing}; score skipped"
        return compute_score(**kwargs), None
    except Exception as exc:
        return None, f"compute_score failed ({type(exc).__name__}: {exc}); score skipped"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clip")
    ap.add_argument("--roi", type=parse_roi, default=None, help="operator chest ROI x,y,w,h (full-res pixels)")
    ap.add_argument("--fps", type=float, default=None)
    ap.add_argument("--out", default=None, help="folder for result.json, roi.jpg, spectrum.png")
    ap.add_argument("--debug", action="store_true", help="keep debug fields and write outputs (default folder data/derived/debug/<clip>)")
    ap.add_argument("--no-yolo", action="store_true")
    ap.add_argument("--score", action="store_true", help="also compute the critical score if perception.score exists")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE")
    args = ap.parse_args(argv)

    cfg = {}
    for item in args.set:
        if "=" not in item:
            ap.error(f"--set needs KEY=VALUE, got {item}")
        k, v = item.split("=", 1)
        cfg[k.strip()] = parse_value(v.strip())
    if args.no_yolo:
        cfg["yolo_enabled"] = False

    out_dir = args.out
    if args.debug and not out_dir:
        out_dir = str(ROOT / "data" / "derived" / "debug" / Path(args.clip).stem)

    result = breathing.analyze(args.clip, fps=args.fps, roi=args.roi, cfg=cfg, out_dir=out_dir)
    if not args.debug:
        result.pop("debug", None)
        result.pop("params", None)

    if args.score:
        score, note = try_score(result)
        if score is not None:
            result["score"] = score
        if note:
            print(note, file=sys.stderr)

    print(json.dumps(result, indent=2, default=str))
    if out_dir:
        print(f"outputs in {out_dir}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
