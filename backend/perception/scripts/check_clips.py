"""Check the recorded teammate clips listed in testdata/real/truth.csv (docs/tasks/eric.md E1).

truth.csv columns: file, condition, truth_bpm, chest_visible, who, lighting, coverage, camera, notes.

Prints one row per clip: file, fps, frame count, duration s, mean gray level, and warnings when
the duration is under 20 s, the fps is outside 25..60, the file is missing, or the row has no
truth_bpm. Exits non-zero if any clip fails.

Usage:
  python scripts/check_clips.py                     # testdata/real/truth.csv
  python scripts/check_clips.py --csv other/truth.csv
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MIN_DURATION_S = 20.0
FPS_RANGE = (25.0, 60.0)
MEAN_SAMPLE_FRAMES = 30  # mean gray level is measured on this many evenly spaced frames


def probe(path: Path):
    """(fps, frame count, duration s, mean gray) or None if the file cannot be opened."""
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    frames = []
    n = 0
    while True:
        ok, frame = cap.read()
        if not ok or frame is None:
            break
        n += 1
        frames.append(frame)
        if len(frames) > 2 * MEAN_SAMPLE_FRAMES:
            frames = frames[::2]  # thin as we go so memory stays small
    cap.release()
    if n == 0:
        return None
    means = [float(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).mean()) if f.ndim == 3 else float(f.mean()) for f in frames]
    duration = n / fps if fps > 0 else 0.0
    return fps, n, duration, float(np.mean(means))


def check_row(row: dict, base: Path):
    """Returns (printable fields, warnings)."""
    name = (row.get("file") or "").strip()
    warnings = []
    if not (row.get("truth_bpm") or "").strip():
        warnings.append("no truth_bpm")
    if not name:
        return [name or "(empty)", "", "", "", ""], warnings + ["no file name"]
    path = Path(name) if Path(name).is_absolute() else base / name
    if not path.exists():
        return [name, "", "", "", ""], warnings + ["file missing"]
    info = probe(path)
    if info is None:
        return [name, "", "", "", ""], warnings + ["cannot read"]
    fps, n, dur, mean = info
    if dur < MIN_DURATION_S:
        warnings.append(f"duration {dur:.1f} s < {MIN_DURATION_S:.0f} s")
    if not (FPS_RANGE[0] <= fps <= FPS_RANGE[1]):
        warnings.append(f"fps {fps:.1f} outside {FPS_RANGE[0]:.0f}..{FPS_RANGE[1]:.0f}")
    return [name, f"{fps:.2f}", str(n), f"{dur:.1f}", f"{mean:.1f}"], warnings


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", default=str(ROOT / "testdata" / "real" / "truth.csv"))
    args = ap.parse_args(argv)
    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"{csv_path} not found", file=sys.stderr)
        return 2
    with csv_path.open(newline="") as fh:
        rows = [{(k or "").strip(): (v or "") for k, v in r.items()} for r in csv.DictReader(fh)]
    if not rows:
        print(f"{csv_path} has no rows", file=sys.stderr)
        return 2

    header = ["file", "fps", "frames", "duration_s", "mean_gray", "warnings"]
    table = []
    failed = 0
    for row in rows:
        fields, warnings = check_row(row, csv_path.parent)
        if warnings:
            failed += 1
        table.append(fields + ["; ".join(warnings) or "ok"])
    widths = [max(len(header[i]), *(len(r[i]) for r in table)) for i in range(len(header))]
    print("  ".join(h.ljust(w) for h, w in zip(header, widths)))
    for r in table:
        print("  ".join(c.ljust(w) for c, w in zip(r, widths)))
    print(f"\n{len(rows)} clips, {failed} with warnings")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
