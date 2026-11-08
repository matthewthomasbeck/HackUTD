"""Export every leg part to ../step and ../stl.

Run from this folder:  python build.py
"""
import pathlib

import cadquery as cq

import parts

HERE = pathlib.Path(__file__).resolve().parent
PARTS = {
    "rubble_hip-left_1.0": lambda: parts.hip("L"),
    "rubble_hip-right_1.0": lambda: parts.hip("R"),
    "rubble_femur_1.0": parts.femur,
    "rubble_tibia_1.0": parts.tibia,
}

if __name__ == "__main__":
    for name, make in PARTS.items():
        shape = make()
        cq.exporters.export(shape, str(HERE.parent / "step" / f"{name}.step"))
        cq.exporters.export(shape, str(HERE.parent / "stl" / f"{name}.stl"), tolerance=0.02, angularTolerance=0.1)
        bb = shape.val().BoundingBox()
        print(f"{name:24s} {bb.xlen:6.1f} x {bb.ylen:6.1f} x {bb.zlen:5.1f} mm  {shape.val().Volume() / 1000:5.1f} cm3")
