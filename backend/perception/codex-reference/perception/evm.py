"""Optional display-only Eulerian magnification, never a rate estimator."""

import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np


def render_magnified_clip(path, output, roi, *, fps=None, rate_bpm=None, config=None):
    cfg = config or {}
    alpha = float(cfg.get("evm_alpha",10))
    levels = int(cfg.get("evm_levels",3))
    capture = cv2.VideoCapture(str(path))
    rate = fps or capture.get(cv2.CAP_PROP_FPS)
    if not capture.isOpened() or not 5 <= rate <= 120:
        capture.release()
        raise ValueError("clip unreadable")
    frames = []
    try:
        for _ in range(round(30*rate)):
            ok,frame = capture.read()
            if not ok:
                break
            x,y,w,h = roi
            height,width = frame.shape[:2]
            x0,y0 = max(0,int(x-w*0.25)),max(0,int(y-h*0.25))
            x1,y1 = min(width,int(x+1.25*w)),min(height,int(y+1.25*h))
            crop = frame[y0:y1,x0:x1]
            factor = min(1,320/crop.shape[1],240/crop.shape[0])
            target = (max(8,round(crop.shape[1]*factor)//2*2),
                      max(8,round(crop.shape[0]*factor)//2*2))
            crop = cv2.resize(crop,target,interpolation=cv2.INTER_AREA)
            frames.append(crop)
    finally:
        capture.release()
    if not frames:
        raise ValueError("clip unreadable")
    values = np.stack(frames).astype(np.float32)
    small = []
    for frame in values:
        for _ in range(levels):
            frame = cv2.pyrDown(frame)
        small.append(frame)
    frequencies = np.fft.rfftfreq(len(values),1/rate)
    lower,upper = ((max(0.1,rate_bpm/60-0.15),rate_bpm/60+0.15)
                   if rate_bpm is not None else cfg.get("evm_band",[0.2,1.0]))
    transformed = np.fft.rfft(np.stack(small),axis=0)
    transformed[(frequencies<lower)|(frequencies>upper)] = 0
    band = np.fft.irfft(transformed,n=len(values),axis=0)
    output = Path(output)
    output.parent.mkdir(parents=True,exist_ok=True)
    temporary = output.with_name(output.stem+"_raw.mp4")
    height,width = frames[0].shape[:2]
    writer = cv2.VideoWriter(str(temporary),cv2.VideoWriter_fourcc(*"mp4v"),rate,(2*width,height+48))
    if not writer.isOpened():
        raise RuntimeError("display clip encoder unavailable")
    try:
        for original,change in zip(frames,band):
            amplified = np.clip(original+alpha*cv2.resize(change,(width,height)),0,255).astype(np.uint8)
            combined = np.zeros((height+48,2*width,3),np.uint8)
            combined[:height] = np.concatenate([original,amplified],axis=1)
            cv2.putText(combined,f"magnified x{alpha:g} for display",(4,height+17),
                        cv2.FONT_HERSHEY_SIMPLEX,0.4,(255,255,255),1)
            cv2.putText(combined,"rate measured from unmagnified motion",(4,height+36),
                        cv2.FONT_HERSHEY_SIMPLEX,0.4,(255,255,255),1)
            writer.write(combined)
    finally:
        writer.release()
    if shutil.which("ffmpeg"):
        subprocess.run(["ffmpeg","-y","-loglevel","error","-i",str(temporary),
                        "-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart",str(output)],check=True)
        temporary.unlink()
    else:
        temporary.replace(output)
    return str(output)
