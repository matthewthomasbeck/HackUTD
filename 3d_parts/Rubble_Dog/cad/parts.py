"""Rubble Dog leg parts: hip, femur, tibia, plus a servo stand-in for fit checks.

Each leg has 3 DSServo 45kg servos:
  abduction servo in the body (unchanged Athena body) -> turns the hip
  hip servo, held in the hip                          -> turns the femur
  knee servo, held at the bottom of the femur         -> turns the tibia directly
Athena put both leg servos in the pelvis and drove the knee with a tie rod.
Here the knee servo sits at the knee, so the tie rod is gone.

Frames (each part is modeled in its print orientation):
  servo: spline axis is +Z through the origin, top face at Z=0, body below,
         body runs from Y=-10 to Y=+30 (spline near one end).
  hip:   servo slot centered at X=0, Y=0. Abduction axis along Y at X=0, Z=HIP_H/2.
  femur: hip axis at the origin, knee axis at (0, -FEMUR_LEN). Z=0 is the inner
         face that sits on the hip horn; the knee servo hangs below Z=0.
  tibia: knee axis at the origin, foot holes at (0, -TIBIA_LEN). Z=0 is the
         inner face; the pad below it sits on the knee horn.
"""
import math

import cadquery as cq

from params import *


def servo_dummy(with_horn=True):
    """Envelope of a standard servo with a disc horn, for clearance checks only."""
    spline_to_center = SERVO_L / 2 - SERVO_SPLINE_FROM_END
    body = (cq.Workplane("XY").box(SERVO_W, SERVO_L, SERVO_H, centered=(True, True, False))
            .translate((0, spline_to_center, -SERVO_H)))
    tab_z = -SERVO_TOP_TO_TAB - SERVO_TAB_T
    tabs = (cq.Workplane("XY").box(SERVO_W, SERVO_TAB_SPAN, SERVO_TAB_T, centered=(True, True, False))
            .translate((0, spline_to_center, tab_z)))
    boss = cq.Workplane("XY").circle(SERVO_BOSS_D / 2).extrude(1.5)
    out = body.union(tabs).union(boss)
    if with_horn:
        horn = (cq.Workplane("XY").workplane(offset=HORN_FACE_ABOVE_TOP - 4.5)
                .circle(HORN_D / 2).extrude(4.5))
        out = out.union(horn)
    return out


def hip(side="L"):
    """Athena pelvis cut down to one servo slot (the slot on the abduction axis).

    The arms, the abduction pivot holes, and the horn bolt holes match Athena,
    so the hip bolts to the Athena body unchanged. "L" is for fore-left and
    hind-right legs (horn holes on the -Y arm). "R" is the mirror image.
    """
    arm_in = HIP_ARM_GAP / 2
    arm_out = arm_in + HIP_ARM_T
    x_open = SERVO_W / 2 + FIT
    x_back = -(SERVO_W / 2 + FIT) - HIP_WALL_T
    width = x_open - x_back
    xc = (x_open + x_back) / 2

    body = cq.Workplane("XY").box(width, 2 * arm_out, HIP_H, centered=(True, True, False)).translate((xc, 0, 0))
    pocket = (cq.Workplane("XY").box(x_open - (x_back + HIP_WALL_T) + 1, 2 * arm_in, HIP_H + 2, centered=(False, True, False))
              .translate((x_back + HIP_WALL_T, 0, -1)))
    body = body.cut(pocket)
    body = body.edges("|Z").edges(f"<X").fillet(3.0)

    # Servo tab holes, vertical through both arms.
    tab_pts = [(sx * SERVO_TAB_HOLE_W / 2, sy * SERVO_TAB_HOLE_L / 2) for sx in (-1, 1) for sy in (-1, 1)]
    body = body.cut(cq.Workplane("XY").pushPoints(tab_pts).circle(HIP_TAB_HOLE_D / 2).extrude(HIP_H + 2).translate((0, 0, -1)))

    # Abduction pivot through both arms, along Y.
    zc = HIP_H / 2
    pivot = cq.Workplane("XZ").center(0, zc).circle(ABD_PIVOT_D / 2).extrude(arm_out + 1, both=True)
    body = body.cut(pivot)

    # Horn bolt holes through the horn arm only.
    horn_holes = (cq.Workplane("XZ").pushPoints([(-ABD_HORN_HOLE_OFFSET, zc), (ABD_HORN_HOLE_OFFSET, zc)])
                  .circle(ABD_HORN_HOLE_D / 2).extrude(arm_out + 1, both=True))
    horn_arm = (cq.Workplane("XY").box(2 * width, HIP_ARM_T + 2, HIP_H + 2, centered=(True, False, False))
                .translate((xc, -arm_out - 1, -1)))
    body = body.cut(horn_holes.intersect(horn_arm))

    if side == "R":
        body = body.mirror("XZ")
    return body


def hip_servo_location():
    """Where the hip servo sits in the hip frame: spline toward the horn arm."""
    z_top = HIP_H + SERVO_TAB_T + SERVO_TOP_TO_TAB
    y_spline = -(SERVO_L / 2 - SERVO_SPLINE_FROM_END)
    return (0.0, y_spline, z_top)


def femur():
    """Plate from the hip horn down to a cradle that holds the knee servo.

    The knee servo goes in from the inner side, top face against the plate,
    spline at the knee. Four M3 x 12 screws go through the servo tabs and
    self-tap into the cradle. The same part fits all four legs.
    """
    knee_y = -FEMUR_LEN
    servo_cy = knee_y + (SERVO_L / 2 - SERVO_SPLINE_FROM_END)
    cradle_in_l = SERVO_L + 2 * FIT
    cradle_in_w = SERVO_W + 2 * FIT
    cradle_out_l = cradle_in_l + 2 * CRADLE_END
    cradle_out_w = cradle_in_w + 2 * CRADLE_SIDE
    y_bottom = servo_cy - cradle_out_l / 2

    plate = (cq.Workplane("XY").box(FEMUR_W, -y_bottom, FEMUR_T, centered=(True, False, False))
             .translate((0, y_bottom, 0)))
    plate = plate.edges("|Z").edges("<Y").fillet(5.0)
    plate = plate.union(cq.Workplane("XY").circle(FEMUR_HUB_R).extrude(FEMUR_T))

    s0, s1, sw = FEMUR_SLOT
    plate = plate.cut(cq.Workplane("XY").center(0, -(s0 + s1) / 2).slot2D(s1 - s0, sw, angle=90)
                      .extrude(FEMUR_T + 2).translate((0, 0, -1)))

    cradle = (cq.Workplane("XY").box(cradle_out_w, cradle_out_l, SERVO_TOP_TO_TAB, centered=(True, True, False))
              .translate((0, servo_cy, -SERVO_TOP_TO_TAB)))
    cradle = cradle.cut(cq.Workplane("XY").box(cradle_in_w, cradle_in_l, SERVO_TOP_TO_TAB + 2, centered=(True, True, False))
                        .translate((0, servo_cy, -SERVO_TOP_TO_TAB - 1)))
    part = plate.union(cradle)

    # Knee horn clearance and hip center-screw access.
    part = part.cut(cq.Workplane("XY").center(0, knee_y).circle(FEMUR_HORN_HOLE / 2).extrude(FEMUR_T + 2).translate((0, 0, -1)))
    part = part.cut(cq.Workplane("XY").circle(FEMUR_CENTER_HOLE / 2).extrude(FEMUR_T + 2).translate((0, 0, -1)))

    # Hip horn screws: countersunk from the outer face so the tibia can sweep past.
    horn_pts = [(HORN_BOLT_R * math.cos(a), HORN_BOLT_R * math.sin(a)) for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2)]
    part = (part.faces(">Z").workplane(origin=(0, 0, FEMUR_T))
            .pushPoints(horn_pts).cskHole(M3_CLEAR, M3_CSK_D, 90))

    # Servo tab screws: blind pilot holes from the cradle rim, so the outer face
    # stays closed (a countersink here would nearly meet the knee horn hole).
    tab_pts = [(sx * SERVO_TAB_HOLE_W / 2, servo_cy + sy * SERVO_TAB_HOLE_L / 2) for sx in (-1, 1) for sy in (-1, 1)]
    depth = SERVO_TOP_TO_TAB + FEMUR_T - FEMUR_SKIN
    part = part.cut(cq.Workplane("XY").pushPoints(tab_pts).circle(TAB_PILOT_D / 2).extrude(depth + 1)
                    .translate((0, 0, -SERVO_TOP_TO_TAB - 1)))
    return part


def tibia():
    """Link from the knee horn to a tip that fits the Athena foot (or a wheel module later)."""
    r1, r2, L = TIBIA_HUB_R, TIBIA_TIP_R, TIBIA_LEN
    # External tangent between the hub circle and the tip circle.
    a = math.asin((r1 - r2) / L)
    p1 = (r1 * math.cos(a), r1 * math.sin(a))
    p2 = (r2 * math.cos(a), -L + r2 * math.sin(a))
    outline = (cq.Workplane("XY").moveTo(*p1)
               .threePointArc((0, r1), (-p1[0], p1[1]))
               .lineTo(-p2[0], p2[1])
               .threePointArc((0, -L - r2), p2)
               .close())
    part = outline.extrude(TIBIA_T)

    s0, s1, sw = TIBIA_SLOT
    part = part.cut(cq.Workplane("XY").center(0, -(s0 + s1) / 2).slot2D(s1 - s0, sw, angle=90)
                    .extrude(TIBIA_T + 2).translate((0, 0, -1)))
    if TIBIA_PAD_H > 0:
        part = part.union(cq.Workplane("XY").circle(TIBIA_PAD_D / 2).extrude(-TIBIA_PAD_H))

    horn_pts = [(HORN_BOLT_R * math.cos(a), HORN_BOLT_R * math.sin(a)) for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2)]
    through = TIBIA_T + TIBIA_PAD_H + 2
    part = part.cut(cq.Workplane("XY").pushPoints(horn_pts).circle(M3_CLEAR / 2).extrude(through).translate((0, 0, -TIBIA_PAD_H - 1)))
    part = part.cut(cq.Workplane("XY").circle(FEMUR_CENTER_HOLE / 2).extrude(through).translate((0, 0, -TIBIA_PAD_H - 1)))
    foot_pts = [(sx * FOOT_HOLE_SPACING / 2, -L) for sx in (-1, 1)]
    part = part.cut(cq.Workplane("XY").pushPoints(foot_pts).circle(FOOT_HOLE_D / 2).extrude(TIBIA_T + 2).translate((0, 0, -1)))
    return part
