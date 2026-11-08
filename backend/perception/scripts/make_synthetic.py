"""Write synthetic breathing test clips with known rates (docs/specs/perception.md section 10).

Each clip is 640 by 480 gray video (written as 3-channel), 30 fps, 20 s by default: a blurred
random texture with a brighter textured "torso" rectangle in the middle. The torso moves up
and down by A * sin(2 pi f t) with sub-pixel shifts (cv2.warpAffine), and Gaussian noise
(sigma 2 gray levels) is added to every frame.

Clips are written lossless (FFV1 in .avi) by default so the tests do not depend on codec
artifacts; --codec mp4v writes .mp4 like a phone or robot clip.

Usage:
  python scripts/make_synthetic.py --out testdata/synthetic            # every case in CASES
  python scripts/make_synthetic.py --out testdata/synthetic --case f0.25
  python scripts/make_synthetic.py --list

The torso ROI to pass as --roi to analyze_clip.py is TORSO_ROI (printed by --list).
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import cv2
import numpy as np

SIZE = (640, 480)  # width, height
FPS = 30.0
TORSO = (200, 130, 240, 220)  # x, y, w, h of the torso rectangle
# The chest ROI used by the tests: the torso, inset by 10 px so the torso outline is not in it.
TORSO_ROI = (TORSO[0] + 10, TORSO[1] + 10, TORSO[2] - 20, TORSO[3] - 20)
BG_MEAN, BG_STD = 90.0, 40.0
TORSO_MEAN, TORSO_STD = 180.0, 20.0
TEXTURE_BLUR = 3.0
FAN = (30, 200, 60, 60)  # x, y, w, h of the fan-like patch (outside the torso ROI)


def texture(rng, size, mean, std, blur=TEXTURE_BLUR):
    w, h = size
    t = rng.normal(0.0, 1.0, (h, w)).astype(np.float32)
    t = cv2.GaussianBlur(t, (0, 0), blur)
    t = (t - t.mean()) / (t.std() + 1e-9)
    return mean + std * t


def shift(img, dx, dy, border=cv2.BORDER_REFLECT):
    m = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(img, m, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR, borderMode=border)


def make_clip(path, *, f=0.25, amp=1.0, duration=20.0, fps=FPS, noise=2.0, motion="torso",
              flat_torso=False, mean_gray=None, fan=False, fan_f=0.8, sway_f=0.3, flicker_f=0.3,
              flicker_depth=0.03, chirp=(0.2, 0.4), seed=0, codec="FFV1"):
    """Write one clip. motion is one of torso, none, sway, flicker, chirp."""
    rng = np.random.default_rng(seed)
    W, H = SIZE
    bg = texture(rng, SIZE, BG_MEAN, BG_STD)
    torso_img = np.full((H, W), TORSO_MEAN, np.float32) if flat_torso else texture(rng, SIZE, TORSO_MEAN, TORSO_STD)
    mask = np.zeros((H, W), np.float32)
    x, y, w, h = TORSO
    mask[y:y + h, x:x + w] = 1.0
    fan_tex = texture(rng, SIZE, BG_MEAN, BG_STD * 1.5, blur=2.0)
    n = int(round(duration * fps))

    # Scale for the dark case: computed on the still frame so the clip mean lands on mean_gray.
    base_mean = float((bg * (1 - mask) + torso_img * mask).mean())
    gain = 1.0 if mean_gray is None else mean_gray / base_mean

    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(p), cv2.VideoWriter_fourcc(*codec), fps, SIZE, True)
    if not writer.isOpened():
        raise RuntimeError(f"cannot open a {codec} writer for {p}")
    for i in range(n):
        t = i / fps
        if motion == "torso":
            dy = amp * math.sin(2 * math.pi * f * t)
        elif motion == "chirp":
            f0, f1 = chirp
            dy = amp * math.sin(2 * math.pi * (f0 * t + 0.5 * (f1 - f0) * t * t / duration))
        else:
            dy = 0.0
        if dy:
            ti, mi = shift(torso_img, 0, dy), shift(mask, 0, dy, border=cv2.BORDER_CONSTANT)
        else:
            ti, mi = torso_img, mask
        frame = bg * (1 - mi) + ti * mi
        if fan:
            fx, fy, fw, fh = FAN
            moved = shift(fan_tex, 3.0 * math.sin(2 * math.pi * fan_f * t), 0)
            frame[fy:fy + fh, fx:fx + fw] = moved[fy:fy + fh, fx:fx + fw]
        if motion == "sway":
            frame = shift(frame, 0, amp * math.sin(2 * math.pi * sway_f * t))
        elif motion == "flicker":
            frame = frame * (1 + flicker_depth * math.sin(2 * math.pi * flicker_f * t))
        frame = frame * gain + rng.normal(0.0, noise, (H, W)).astype(np.float32)
        g = np.clip(np.round(frame), 0, 255).astype(np.uint8)
        writer.write(cv2.cvtColor(g, cv2.COLOR_GRAY2BGR))
    writer.release()
    return str(p)


# The synthetic table of perception.md section 10. "expect" is checked by tests/test_breathing_synthetic.py.
CASES = {
    "f0.15": {"params": {"f": 0.15}, "expect": "detected"},
    "f0.25": {"params": {"f": 0.25}, "expect": "detected"},
    "f0.4": {"params": {"f": 0.4}, "expect": "detected"},
    "f0.6": {"params": {"f": 0.6}, "expect": "detected"},
    "f0.9": {"params": {"f": 0.9}, "expect": "detected"},
    "small_amp": {"params": {"f": 0.25, "amp": 0.3}, "expect": "detected_or_unknown"},
    "short": {"params": {"f": 0.25, "duration": 12.0}, "expect": "clip too short"},
    "still": {"params": {"motion": "none"}, "expect": "not_detected"},
    "sway": {"params": {"motion": "sway"}, "expect": "camera or scene moved"},
    "flicker": {"params": {"motion": "flicker"}, "expect": "lighting or exposure changed"},
    "flat_torso": {"params": {"f": 0.25, "flat_torso": True}, "expect": "no texture on chest region"},
    "dark": {"params": {"f": 0.25, "mean_gray": 20.0}, "expect": "clip too dark, needs light"},
    "noisy": {"params": {"f": 0.25, "noise": 12.0}, "expect": "clip too noisy (low light)"},
    "fan": {"params": {"f": 0.25, "fan": True}, "expect": "detected"},
    "irregular": {"params": {"motion": "chirp"}, "expect": "not_confidently_wrong"},
}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="testdata/synthetic", help="output folder")
    ap.add_argument("--case", action="append", help="case name (repeatable); default every case")
    ap.add_argument("--codec", default="FFV1", choices=["FFV1", "mp4v", "MJPG"])
    ap.add_argument("--list", action="store_true", help="list the cases and the torso ROI")
    args = ap.parse_args(argv)
    if args.list:
        print("torso ROI (--roi):", ",".join(str(v) for v in TORSO_ROI))
        for name, c in CASES.items():
            print(f"{name:12s} {c['params']}  expect {c['expect']}")
        return 0
    names = args.case or list(CASES)
    ext = ".mp4" if args.codec == "mp4v" else ".avi"
    for name in names:
        if name not in CASES:
            print(f"unknown case {name}", file=sys.stderr)
            return 2
        path = Path(args.out) / f"{name}{ext}"
        make_clip(path, codec=args.codec, **CASES[name]["params"])
        print(path)
    print("torso ROI (--roi):", ",".join(str(v) for v in TORSO_ROI))
    return 0


if __name__ == "__main__":
    sys.exit(main())
