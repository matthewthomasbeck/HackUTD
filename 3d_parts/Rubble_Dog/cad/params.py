"""Shared dimensions for the Rubble Dog leg parts. All values are in mm.

Values marked MEASURE come from the DS3218 model in Robot_Parts_Athena.
The legs use DSServo 45kg servos (listed as 40 x 20 x 38.5 mm), so check
each MEASURE value with calipers on a real servo and horn before printing.
Change a value here, then run build.py to regenerate every STL and STEP file.
"""

# --- Servo (DSServo 45kg, standard size) ---
SERVO_L = 40.0            # body length (MEASURE)
SERVO_W = 20.0            # body width (MEASURE)
SERVO_H = 40.7            # body height, bottom to top face (MEASURE, DS3218 value)
SERVO_SPLINE_FROM_END = 10.0  # spline axis to the near short end (MEASURE)
SERVO_TOP_TO_TAB = 9.6    # top face to the top of the mounting tabs (MEASURE)
SERVO_TAB_T = 3.1         # tab thickness (MEASURE)
SERVO_TAB_SPAN = 54.4     # tab tip to tab tip (MEASURE)
SERVO_TAB_HOLE_L = 49.5   # tab hole spacing along the body (MEASURE)
SERVO_TAB_HOLE_W = 10.0   # tab hole spacing across the body (MEASURE)
SERVO_BOSS_D = 12.9       # raised boss around the spline

# --- 25T disc horn (aluminum, 4 tapped M3 holes) ---
HORN_D = 20.0             # (MEASURE)
HORN_BOLT_R = 7.0         # bolt circle radius (MEASURE)
HORN_FACE_ABOVE_TOP = 6.0  # servo top face to horn outer face, horn seated (MEASURE)

# --- Fasteners and print fit (PLA on the FlashForge) ---
M3_CLEAR = 3.4
M3_CSK_D = 6.6            # countersink head diameter for M3 flat head (DIN 7991)
TAB_PILOT_D = 2.8         # M3 self-tapping pilot for the knee servo tabs
FEMUR_SKIN = 1.2          # closed skin left on the femur outer face above each pilot
FIT = 0.3                 # clearance per side around a servo body

# --- Leg geometry (kept equal to Athena so the IK numbers stay the same) ---
FEMUR_LEN = 110.0         # hip axis to knee axis
TIBIA_LEN = 140.0         # knee axis to the foot bolt holes

# --- Femur ---
FEMUR_T = 5.0             # plate thickness
FEMUR_W = 30.0            # plate width
FEMUR_HUB_R = 15.0
FEMUR_CENTER_HOLE = 7.0   # clears the horn center screw head
FEMUR_HORN_HOLE = HORN_D + 2.0  # knee horn sits inside this hole
CRADLE_SIDE = 3.5         # cradle wall beside the servo body
CRADLE_END = 8.5          # cradle wall at each end, under the tabs
FEMUR_SLOT = (22.0, 62.0, 14.0)  # lightening slot: from y, to y, width

# --- Tibia ---
TIBIA_T = 6.0             # matches the 6.3 mm slot in the Athena foot
TIBIA_HUB_R = 14.0
TIBIA_TIP_R = 12.0
TIBIA_PAD_D = 19.0        # sits on the knee horn face only
TIBIA_GAP = 2.0           # tibia inner face to femur outer face
FOOT_HOLE_D = 4.4
FOOT_HOLE_SPACING = 15.0  # across the tibia, same as the Athena foot
TIBIA_SLOT = (28.0, 112.0, 8.0)

# --- Hip (Athena pelvis cut down to one servo slot) ---
HIP_H = 20.0              # part thickness
HIP_ARM_T = 10.0          # arm thickness along the abduction axis
HIP_ARM_GAP = 40.6        # space between the arms, holds the servo length
HIP_WALL_T = 3.2          # back wall
ABD_PIVOT_D = 6.35        # abduction pivot hole (horn center or leg pin)
ABD_HORN_HOLE_D = 4.4
ABD_HORN_HOLE_OFFSET = 7.0
HIP_TAB_HOLE_D = 4.4

# Derived
# The pad spans from the knee horn face to the tibia inner face.
TIBIA_PAD_H = max(0.0, FEMUR_T + TIBIA_GAP - HORN_FACE_ABOVE_TOP)
