"""Step 2 (roi.py): chest ROI sources, k, background ROI, ROI checks, visibility, person check."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from perception import roi

from _synth_helpers import NO_YOLO, textured_frames

SIZE = (640, 480)


def textured_bgr(seed=0):
    g = textured_frames(1, size=SIZE, mean=120, std=30, seed=seed)[0]
    return cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)


def fake_pose(kps: dict, box=(200, 100, 440, 460), conf=0.5):
    xy = np.full((17, 2), np.nan)
    kc = np.zeros(17)
    for j, (x, y) in kps.items():
        xy[j] = (x, y)
        kc[j] = 0.9
    return {"box": list(box), "box_conf": 0.8, "kp_xy": xy, "kp_conf": kc, "n_frames": 5}


# ---------------------------------------------------------------------------
# No person: operator and center ROIs, visibility none.


def test_center_roi_without_person():
    sel = roi.select_roi([textured_bgr()] * 5, cfg=NO_YOLO)
    assert sel["roi_source"] == "center"
    assert sel["chest"] == (192, 144, 256, 192)
    assert sel["k"] == 0.4
    assert sel["visibility_pct"] is None and sel["visibility_source"] == "none"
    assert sel["person_box"] is None and sel["person_conf"] == 0.0


def test_operator_roi_and_k_override():
    sel = roi.select_roi([textured_bgr()] * 5, roi=(100, 100, 120, 90), cfg=NO_YOLO)
    assert sel["roi_source"] == "operator" and sel["chest"] == (100, 100, 120, 90) and sel["k"] == 0.8
    sel = roi.select_roi([textured_bgr()] * 5, roi=(100, 100, 120, 90), cfg={**NO_YOLO, "chest_visible_k": 1.0})
    assert sel["k"] == 1.0


def test_operator_roi_clamped():
    sel = roi.select_roi([textured_bgr()] * 5, roi=(600, 400, 100, 100), cfg=NO_YOLO)
    assert sel["chest"] == (600, 400, 40, 80)


def test_no_person_with_yolo_gives_visibility_none():
    """A synthetic image with no person: YOLO (when installed and loaded) finds nobody."""
    pytest.importorskip("ultralytics")
    cfg = roi.merge_cfg(None)
    if not Path(roi._weights_path(cfg["yolo_model"], cfg)).exists() and not roi.yolo_loaded():
        pytest.skip("pose weights not downloaded")
    sel = roi.select_roi([textured_bgr(s) for s in range(5)])
    assert roi.yolo_loaded()
    assert sel["visibility_source"] == "none" and sel["visibility_pct"] is None
    assert sel["roi_source"] == "center"


# ---------------------------------------------------------------------------
# Pose and box ROIs from fake detections.


def test_chest_from_pose_upright():
    cfg = roi.merge_cfg(None)
    pose = fake_pose({5: (280, 150), 6: (360, 150), 11: (290, 350), 12: (350, 350)})
    rect, axis = roi.chest_from_pose(pose, SIZE, cfg)
    # S = (320, 150), H = (320, 350), shoulder width 80, half width 44, segment to y = 270.
    assert rect == (276, 150, 88, 120)
    assert axis == pytest.approx((0.0, 1.0))


def test_chest_from_pose_lying_no_hips():
    cfg = roi.merge_cfg(None)
    # Lying person, shoulders stacked vertically, box wider than tall and to the right.
    pose = fake_pose({5: (100, 200), 6: (100, 260)}, box=(80, 180, 500, 290))
    rect, axis = roi.chest_from_pose(pose, SIZE, cfg)
    # S = (100, 230), sw = 60, H = S + 72 along +x; segment to x = 143.2; half width 33.
    assert axis == pytest.approx((1.0, 0.0))
    assert rect == (100, 197, 44, 66)


def test_chest_from_pose_needs_two_points():
    cfg = roi.merge_cfg(None)
    assert roi.chest_from_pose(fake_pose({5: (280, 150)}), SIZE, cfg) is None
    assert roi.chest_from_pose(fake_pose({11: (290, 350), 12: (350, 350)}), SIZE, cfg) is None
    assert roi.chest_from_pose(fake_pose({5: (280, 150), 11: (290, 350)}), SIZE, cfg) is not None


def test_chest_from_box_shapes():
    assert roi.chest_from_box([100, 100, 200, 300], SIZE) == (125, 140, 50, 70)  # upright
    assert roi.chest_from_box([100, 100, 400, 200], SIZE) == (190, 125, 120, 50)  # lying
    assert roi.chest_from_box([100, 100, 220, 200], SIZE) == (130, 125, 60, 50)  # other


def test_select_uses_pose_then_box(monkeypatch):
    frames = [textured_bgr()] * 5
    full = fake_pose({5: (280, 150), 6: (360, 150), 11: (290, 350), 12: (350, 350), 0: (320, 100)})
    monkeypatch.setattr(roi, "run_pose", lambda f, c=None: full)
    sel = roi.select_roi(frames)
    assert sel["roi_source"] == "pose" and sel["k"] == 1.0
    assert sel["visibility_source"] == "pose" and sel["visibility_pct"] == round(100 * 5 / 17, 1)

    three = fake_pose({5: (280, 150), 6: (360, 150), 11: (290, 350)})
    monkeypatch.setattr(roi, "run_pose", lambda f, c=None: three)
    assert roi.select_roi(frames)["k"] == 0.75

    box_only = fake_pose({0: (320, 100)})
    monkeypatch.setattr(roi, "run_pose", lambda f, c=None: box_only)
    sel = roi.select_roi(frames)
    assert sel["roi_source"] == "box" and sel["k"] == 0.5
    assert sel["visibility_pct"] == round(100 / 17, 1)

    no_kps = fake_pose({})
    monkeypatch.setattr(roi, "run_pose", lambda f, c=None: no_kps)
    sel = roi.select_roi(frames)
    assert sel["roi_source"] == "box"
    assert sel["visibility_pct"] is None and sel["visibility_source"] == "none"  # never 0

    monkeypatch.setattr(roi, "run_pose", lambda f, c=None: full)
    sel = roi.select_roi(frames, roi=(10, 10, 100, 100))
    assert sel["roi_source"] == "operator" and sel["visibility_source"] == "pose"


# ---------------------------------------------------------------------------
# Background ROI and ROI checks.


def test_background_roi_avoids_person_and_needs_texture():
    cfg = roi.merge_cfg(None)
    gray = textured_frames(1, size=SIZE, mean=120, std=30)[0]
    person = (0, 0, 640, 100)  # covers the whole top strip
    rect, sd = roi.background_roi(gray, [person], cfg)
    assert rect is not None and sd >= cfg["tex_min"]
    x, y, w, h = rect
    assert y >= 100 or y + h <= 0 or x >= 640  # outside the person
    flat = np.full((480, 640), 120, np.uint8)
    rect, _ = roi.background_roi(flat, [], cfg)
    assert rect is None
    sel = roi.select_roi([cv2.cvtColor(flat, cv2.COLOR_GRAY2BGR)] * 5, cfg=NO_YOLO)
    assert sel["background"] is None and "background gate unavailable" in sel["warnings"]


def test_subtract_rect():
    assert roi.subtract_rect((0, 0, 100, 20), (40, 0, 20, 20)) == (0, 0, 40, 20)
    assert roi.subtract_rect((0, 0, 100, 20), (200, 0, 20, 20)) == (0, 0, 100, 20)


def test_roi_checks():
    img = textured_bgr()
    assert roi.check_roi(img, (100, 100, 120, 100)) is None
    assert roi.check_roi(img, (100, 100, 30, 100)) == "chest region too small"
    glare = img.copy()
    glare[100:200, 100:220] = 255
    assert roi.check_roi(glare, (100, 100, 120, 100)) == "chest region overexposed (glare from the robot light)"
    dark = np.full_like(img, 3)
    assert roi.check_roi(dark, (100, 100, 120, 100)) == "chest region too dark"
    flat = np.full_like(img, 128)
    assert roi.check_roi(flat, (100, 100, 120, 100)) == "no texture on chest region"


def test_draw_roi(tmp_path):
    sel = roi.select_roi([textured_bgr()] * 5, roi=(100, 100, 120, 90), cfg=NO_YOLO)
    out = tmp_path / "roi.jpg"
    roi.draw_roi(textured_bgr(), sel, str(out))
    img = cv2.imread(str(out))
    assert img is not None and img.shape == (480, 640, 3)


# ---------------------------------------------------------------------------
# Person check on a still.


def _need_model():
    pytest.importorskip("ultralytics")
    cfg = roi.merge_cfg(None)
    if not Path(roi._weights_path(cfg["yolo_model"], cfg)).exists() and not roi.yolo_loaded():
        pytest.skip("pose weights not downloaded")


def test_confirm_person_no_person(tmp_path):
    _need_model()
    still = tmp_path / "still.jpg"
    cv2.imwrite(str(still), textured_bgr())
    out = tmp_path / "person.jpg"
    r = roi.confirm_person(str(still), str(out))
    assert r["person_confirmed"] is False and r["person_conf"] == 0.0 and r["box"] is None
    assert cv2.imread(str(out)) is not None


def test_confirm_person_with_person(tmp_path):
    _need_model()
    import ultralytics
    sample = Path(ultralytics.__file__).parent / "assets" / "zidane.jpg"
    if not sample.exists():
        pytest.skip("ultralytics sample image missing")
    out = tmp_path / "person.jpg"
    r = roi.confirm_person(str(sample), str(out))
    assert r["person_confirmed"] is True
    assert r["person_conf"] >= roi.DEFAULTS["person_confirm_conf"]
    assert len(r["box"]) == 4
    assert cv2.imread(str(out)) is not None


def test_confirm_person_unreadable(tmp_path):
    r = roi.confirm_person(str(tmp_path / "missing.jpg"), str(tmp_path / "out.jpg"), cfg=NO_YOLO)
    assert r["person_confirmed"] is False and r["person_conf"] == 0.0 and r["box"] is None
