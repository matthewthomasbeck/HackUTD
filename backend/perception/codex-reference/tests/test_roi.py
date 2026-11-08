"""ROI bounds, optional model behavior, and visibility semantics."""

import cv2
import numpy as np
import pytest

from perception.roi import clamp_box, person_check, select_roi


def test_operator_box_clamped_and_unknown_visibility():
    image = np.zeros((240,320,3),np.uint8)
    selected = select_roi([image],operator="-10,20,100,90",config={"use_yolo":False})
    assert selected["roi"]==(0,20,90,90)
    assert selected["roi_source"]=="operator"
    assert selected["visibility_pct"] is None
    assert selected["chest_visible_k"]==0.8


@pytest.mark.parametrize("box",[(400,0,50,50),(0,0,-1,10),(float("nan"),0,40,40)])
def test_invalid_operator_region(box):
    with pytest.raises(ValueError):
        clamp_box(box,320,240)


class Tensor:
    def __init__(self,value):
        self.value=np.asarray(value)
    def cpu(self):
        return self
    def numpy(self):
        return self.value
    def __getitem__(self,index):
        return Tensor(self.value[index])


class Boxes:
    conf=Tensor([0.3,0.85])
    xyxy=Tensor([[0,0,50,60],[30,20,200,220]])
    def __len__(self):
        return 2


def test_person_check_uses_highest_confidence_box():
    class Result:
        boxes=Boxes()
        keypoints=None
    result=person_check(np.zeros((240,320,3),np.uint8),model=lambda *args,**kwargs:[Result()])
    assert result["person_confirmed"] is True
    assert result["person_conf"]==0.85
    assert result["box"]==(30,20,170,200)


def test_no_person_is_not_zero_visibility():
    class Result:
        boxes=None
        keypoints=None
    result=person_check(np.zeros((240,320,3),np.uint8),model=lambda *args,**kwargs:[Result()])
    assert result["person_confirmed"] is False
    assert result["person_conf"]==0


def test_pose_torso_axis_follows_lying_person(monkeypatch):
    points=np.zeros((17,2))
    points[5],points[6],points[11],points[12]=(60,60),(60,100),(180,60),(180,100)
    confidence=np.ones(17)
    record=dict(person_conf=.9,person_confirmed=True,box=(20,20,220,130),
                keypoints=points,keypoint_conf=confidence,model_available=True)
    monkeypatch.setattr("perception.roi.person_check",lambda *args,**kwargs:record)
    selected=select_roi([np.zeros((240,320,3),np.uint8)])
    assert selected["roi_source"]=="pose"
    assert selected["axis"][0]>.99
    assert selected["visibility_pct"]==100
