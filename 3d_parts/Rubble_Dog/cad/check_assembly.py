"""Sweep the hip and knee joints and report where parts collide.

Builds one leg in the hip frame: hip, hip servo, femur, knee servo, tibia.
Needs trimesh and manifold3d:  pip install trimesh manifold3d
Run from this folder:  python check_assembly.py
"""
import math

import numpy as np
import trimesh

import parts
from params import *

STEP_DEG = 5
MIN_OVERLAP_MM3 = 1.0  # ignore tessellation noise on faces that only touch


def mesh(shape):
    verts, faces = shape.val().tessellate(0.05, 0.2)
    return trimesh.Trimesh([(v.x, v.y, v.z) for v in verts], faces)


def rot_z(deg, about=(0, 0, 0)):
    m = trimesh.transformations.rotation_matrix(math.radians(deg), (0, 0, 1), about)
    return m


def move(m, *mats):
    out = m.copy()
    for t in mats:
        out.apply_transform(t)
    return out


def overlap(a, b):
    inter = a.intersection(b, engine="manifold")
    return 0.0 if inter.is_empty else inter.volume


def intervals(angles, ok):
    """Group the collision-free angles into ranges."""
    runs, start = [], None
    for a, good in zip(angles, ok):
        if good and start is None:
            start = a
        if not good and start is not None:
            runs.append((start, prev))
            start = None
        prev = a
    if start is not None:
        runs.append((start, prev))
    return runs


def main():
    hip = mesh(parts.hip("L"))
    servo_body = mesh(parts.servo_dummy(with_horn=False))
    femur = mesh(parts.femur())
    tibia = mesh(parts.tibia())

    hx, hy, hz = parts.hip_servo_location()
    hip_servo = move(servo_body, trimesh.transformations.translation_matrix((hx, hy, hz)))
    fixed = {"hip": hip, "hip servo": hip_servo}

    femur_base = trimesh.transformations.translation_matrix((hx, hy, hz + HORN_FACE_ABOVE_TOP))
    knee_servo_local = move(servo_body, trimesh.transformations.translation_matrix((0, -FEMUR_LEN, 0)))
    tibia_z = FEMUR_T + TIBIA_GAP
    tibia_local = move(tibia, trimesh.transformations.translation_matrix((0, -FEMUR_LEN, tibia_z)))

    # The servo must sit inside the femur cradle without overlap.
    fit = overlap(femur, knee_servo_local)
    print(f"knee servo in femur cradle: overlap {fit:.2f} mm3 ({'OK' if fit < MIN_OVERLAP_MM3 else 'CLASH'})")

    # Hip sweep: femur and knee servo against the hip and hip servo.
    angles = list(range(-180, 180, STEP_DEG))
    ok_hip = []
    for a in angles:
        t = femur_base @ rot_z(a)
        moving = {"femur": move(femur, t), "knee servo": move(knee_servo_local, t)}
        hits = [(m, f, v) for m, mm in moving.items() for f, fm in fixed.items() if (v := overlap(mm, fm)) > MIN_OVERLAP_MM3]
        ok_hip.append(not hits)
    print("hip angle (deg, 0 = femur along -Y of the hip frame) collision-free ranges:", intervals(angles, ok_hip))

    # Knee sweep: tibia against the femur and knee servo (independent of hip angle).
    ok_knee = []
    for a in angles:
        t_tib = move(tibia_local, rot_z(a, (0, -FEMUR_LEN, 0)))
        hits = [n for n, m in (("femur", femur), ("knee servo", knee_servo_local)) if overlap(t_tib, m) > MIN_OVERLAP_MM3]
        ok_knee.append(not hits)
    print("knee angle (deg, 0 = tibia straight in line with femur) collision-free ranges:", intervals(angles, ok_knee))


if __name__ == "__main__":
    main()
