"""Generate deterministic breathing and failure-mode videos with known inputs."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def write_clip(path, *, frequency=0.25, amplitude=1.0, duration=20, fps=30,
               case="breathing", size=(640,480), seed=7, noise_sigma=2.0):
    path = Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    width,height = size
    rng = np.random.default_rng(seed)
    background = cv2.GaussianBlur(rng.uniform(35,170,(height,width)).astype(np.float32),(5,5),0)
    # Separate torso texture prevents periodic changes outside the selected ROI.
    x,y,w,h = width//3,height//3,width//3,height//3
    torso = cv2.GaussianBlur(rng.uniform(65,225,(h,w)).astype(np.float32),(3,3),0)
    if case == "flat":
        torso[:] = 130
    writer = cv2.VideoWriter(str(path),cv2.VideoWriter_fourcc(*"FFV1"),fps,(width,height),True)
    if not writer.isOpened():
        raise RuntimeError("FFV1 video encoder unavailable")
    try:
        for index in range(round(duration*fps)):
            t = index/fps
            phase = 2*np.pi*frequency*t
            if case == "irregular":
                phase = 2*np.pi*(0.2*t+0.5*(0.2/duration)*t*t)
            displacement = amplitude*np.sin(phase)
            if case == "still":
                displacement = 0
            frame = background.copy()
            frame[y:y+h,x:x+w] = cv2.warpAffine(torso,np.float32([[1,0,0],[0,1,displacement]]),
                                               (w,h),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT)
            if case == "sway":
                frame = cv2.warpAffine(frame,np.float32([[1,0,0],[0,1,2*np.sin(2*np.pi*0.3*t)]]),
                                       (width,height),borderMode=cv2.BORDER_REFLECT)
            if case == "flicker":
                frame += 15*np.sin(2*np.pi*0.3*t)
            if case == "fan":
                frame[10:height//5,10:width//5] += 20*np.sin(2*np.pi*0.8*t)
            if case == "dark":
                frame *= 20/float(frame.mean())
            noise = 0 if case in ("still","flat") else noise_sigma
            if case == "noisy":
                noise = 12
            frame = np.clip(frame+rng.normal(0,noise,frame.shape),0,255).astype(np.uint8)
            writer.write(cv2.cvtColor(frame,cv2.COLOR_GRAY2BGR))
    finally:
        writer.release()
    truth = 0 if case == "still" else (18 if case == "irregular" else frequency*60)
    return {"file":str(path),"case":case,"truth_bpm":truth,"roi":[x,y,w,h],
            "fps":fps,"duration_s":duration,"amplitude_px":amplitude,
            "ground_truth_source":"synthetic_motion_frequency",
            "chest_visible_k":1.0}


def generate_suite(output):
    output = Path(output)
    rows = []
    for frequency in (0.15,0.25,0.4,0.6,0.9):
        rows.append(write_clip(output/f"rate_{frequency:.2f}.avi",frequency=frequency))
    for case in ("still","sway","flicker","flat","dark","noisy","fan","irregular"):
        rows.append(write_clip(output/f"{case}.avi",case=case))
    rows.append(write_clip(output/"low_amplitude.avi",amplitude=0.3))
    rows.append(write_clip(output/"short.avi",duration=12))
    (output/"manifest.json").write_text(json.dumps(rows,indent=2)+"\n")
    return rows


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out",type=Path,default=Path("data/synthetic"))
    args = parser.parse_args()
    print(json.dumps(generate_suite(args.out),indent=2))
