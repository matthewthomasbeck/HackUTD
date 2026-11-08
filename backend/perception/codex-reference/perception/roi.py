"""Chest ROI selection with optional, lazy YOLO person/pose confirmation."""

from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

_MODEL_AVAILABLE = False


def model_status():
    """Report initialization state without starting a download from a health check."""
    return "loaded" if _MODEL_AVAILABLE else "missing"


def clamp_box(box, width, height):
    x, y, w, h = map(float, box)
    if not all(np.isfinite([x, y, w, h])) or w <= 0 or h <= 0:
        raise ValueError("invalid chest region")
    x0, y0 = max(0, int(x)), max(0, int(y))
    x1, y1 = min(width, int(x + w)), min(height, int(y + h))
    if x1 <= x0 or y1 <= y0:
        raise ValueError("invalid chest region")
    return (x0, y0, x1 - x0, y1 - y0)


@lru_cache(maxsize=2)
def load_pose(model_name="yolo26n-pose.pt"):
    global _MODEL_AVAILABLE
    try:
        from ultralytics import YOLO
    except ImportError:
        return None
    for name in dict.fromkeys([model_name, "yolo11n-pose.pt"]):
        try:
            weight = Path(name)
            if weight.name == name:
                folder = Path(__file__).resolve().parents[1]/"data"/"models"
                folder.mkdir(parents=True,exist_ok=True)
                weight = folder/name
            model = YOLO(str(weight))
            _MODEL_AVAILABLE = True
            return model
        except Exception:
            continue
    return None


def person_check(image, config=None, model=None):
    cfg = config or {}
    model = model if model is not None else load_pose(cfg.get("yolo_model", "yolo26n-pose.pt"))
    if model is None:
        return {"person_conf": 0.0, "person_confirmed": False, "box": None,
                "keypoints": None, "keypoint_conf": None, "model_available": False}
    results = model(image, conf=cfg.get("yolo_conf", 0.25), verbose=False)
    result = results[0]
    if result.boxes is None or len(result.boxes) == 0:
        return {"person_conf": 0.0, "person_confirmed": False, "box": None,
                "keypoints": None, "keypoint_conf": None, "model_available": True}
    scores = result.boxes.conf.cpu().numpy()
    index = int(np.argmax(scores))
    x0, y0, x1, y1 = result.boxes.xyxy[index].cpu().numpy().tolist()
    points = result.keypoints.xy[index].cpu().numpy() if result.keypoints is not None else None
    confidence = result.keypoints.conf[index].cpu().numpy() if result.keypoints is not None else None
    return {"person_conf": float(scores[index]),
            "person_confirmed": bool(scores[index] >= cfg.get("person_confirm_conf", 0.5)),
            "box": (x0, y0, x1 - x0, y1 - y0), "keypoints": points,
            "keypoint_conf": confidence, "model_available": True}


def select_roi(samples, operator=None, config=None):
    cfg = config or {}
    height, width = samples[0].shape[:2]
    observations = []
    if cfg.get("use_yolo", cfg.get("enable_yolo", True)):
        observations = [person_check(image, cfg) for image in samples]
    detected = [row for row in observations if row["box"] is not None]
    person = person_check(samples[len(samples) // 2], cfg) if observations else {
        "person_conf": 0.0, "person_confirmed": False, "box": None,
        "keypoints": None, "keypoint_conf": None, "model_available": False}
    box = tuple(np.median([row["box"] for row in detected], axis=0)) if detected else None
    keypoints = np.zeros((17, 2), dtype=float)
    keyconf = np.zeros(17, dtype=float)
    for index in range(17):
        valid = [row for row in detected if row["keypoints"] is not None
                 and row["keypoint_conf"][index] >= cfg.get("kp_conf", 0.5)]
        if valid:
            keypoints[index] = np.median([row["keypoints"][index] for row in valid], axis=0)
            keyconf[index] = np.median([row["keypoint_conf"][index] for row in valid])
    visible = keyconf >= cfg.get("kp_conf", 0.5)
    axis = np.array([0.0, 1.0])
    if operator is not None:
        region = tuple(map(float, operator.split(","))) if isinstance(operator, str) else operator
        source, k = "operator", 0.8
    elif box is not None:
        shoulders = [i for i in (5, 6) if visible[i]]
        hips = [i for i in (11, 12) if visible[i]]
        if len(shoulders) == 2 or (shoulders and hips):
            shoulder = np.mean(keypoints[shoulders], axis=0)
            shoulder_width = (np.linalg.norm(keypoints[5] - keypoints[6])
                              if len(shoulders) == 2 else box[2] * 0.6)
            if hips:
                hip = np.mean(keypoints[hips], axis=0)
            else:
                direction = np.array([box[0] + box[2] / 2, box[1] + box[3] / 2]) - shoulder
                direction /= max(np.linalg.norm(direction), 1e-6)
                hip = shoulder + 1.2 * shoulder_width * direction
            axis = (hip - shoulder) / max(np.linalg.norm(hip - shoulder), 1e-6)
            perpendicular = np.array([-axis[1], axis[0]])
            end = shoulder + 0.6 * (hip - shoulder)
            half = perpendicular * shoulder_width * cfg.get("chest_width_factor", 1.1) / 2
            corners = np.stack([shoulder - half, shoulder + half, end - half, end + half])
            lower, upper = corners.min(axis=0), corners.max(axis=0)
            region = (*lower, *(upper - lower))
            source, k = "pose", float(visible[[5, 6, 11, 12]].mean())
        else:
            x, y, w, h = box
            if h > w:
                region = (x + 0.25*w, y + 0.2*h, 0.5*w, 0.35*h)
            elif w > 1.3*h:
                region = (x + 0.3*w, y + 0.25*h, 0.4*w, 0.5*h)
            else:
                region = (x + 0.25*w, y + 0.25*h, 0.5*w, 0.5*h)
            source, k = "box", 0.5
    else:
        fraction = cfg.get("center_roi_frac", 0.4)
        region = (width * (1-fraction)/2, height * (1-fraction)/2,
                  width*fraction, height*fraction)
        source, k = "center", 0.4
    region = clamp_box(region, width, height)
    return {"roi": region, "roi_source": source, "chest_visible_k": k,
            "visibility_pct": float(100*visible.mean()) if visible.any() else None,
            "visibility_source": "pose" if visible.any() else "none", "axis": axis,
            "person": person, "person_box": box, "keypoints": keypoints,
            "keypoint_conf": keyconf}


def background_roi(frame, person_box=None, chest_roi=None, config=None):
    height, width = frame.shape
    depth_x, depth_y = max(1, int(width*0.15)), max(1, int(height*0.15))
    candidates = [(0, 0, width, depth_y), (0, height-depth_y, width, depth_y),
                  (0, 0, depth_x, height), (width-depth_x, 0, depth_x, height)]
    def overlap(a, b):
        return b is not None and (max(a[0], b[0]) < min(a[0]+a[2], b[0]+b[2])
                                  and max(a[1], b[1]) < min(a[1]+a[3], b[1]+b[3]))
    candidates = [r for r in candidates if not overlap(r, person_box) and not overlap(r, chest_roi)]
    if not candidates:
        return None
    chosen = max(candidates, key=lambda r: float(frame[r[1]:r[1]+r[3], r[0]:r[0]+r[2]].std()))
    x, y, w, h = chosen
    return chosen if frame[y:y+h, x:x+w].std() >= (config or {}).get("tex_min", 4) else None


def draw_regions(image, selection, background=None, output=None):
    drawn = image.copy()
    for region, color in [(selection.get("person_box"), (255,255,255)),
                          (selection["roi"], (0,255,0)), (background, (255,0,0))]:
        if region is not None:
            x, y, w, h = map(int, region)
            cv2.rectangle(drawn, (x,y), (x+w,y+h), color, 2)
    for point, confidence in zip(selection["keypoints"], selection["keypoint_conf"]):
        if confidence >= 0.5:
            cv2.circle(drawn, tuple(map(int, point)), 3, (255,255,255), -1)
    cv2.putText(drawn, selection["roi_source"], (10,25), cv2.FONT_HERSHEY_SIMPLEX,
                0.6, (0,255,0), 2)
    if output:
        cv2.imwrite(str(Path(output)), drawn)
    return drawn


def draw_person(image, person, output=None, config=None):
    drawn = image.copy()
    if person["box"] is not None:
        x,y,w,h = map(int,person["box"])
        cv2.rectangle(drawn,(x,y),(x+w,y+h),(255,255,255),2)
    if person["keypoints"] is not None:
        for point,confidence in zip(person["keypoints"],person["keypoint_conf"]):
            if confidence >= (config or {}).get("kp_conf",0.5):
                cv2.circle(drawn,tuple(map(int,point)),3,(255,255,255),-1)
    cv2.putText(drawn,f"person {person['person_conf']:.2f}",(10,25),
                cv2.FONT_HERSHEY_SIMPLEX,0.6,(255,255,255),2)
    if output:
        cv2.imwrite(str(Path(output)),drawn)
    return drawn
