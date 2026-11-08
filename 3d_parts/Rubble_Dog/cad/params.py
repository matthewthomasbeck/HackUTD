"""Shared dimensions for the Rubble Dog leg parts. All values are in mm.

Servo values use the DSServo DS3225 (25kg) as the reference. It shares the standard
DSServo housing with the DS3218 in Robot_Parts_Athena, whose model these were measured from.
The legs use DSServo 45kg servos (listed as 40 x 20 x 38.5 mm), so check
each MEASURE value with calipers on a real servo and horn before printing.
Change a value here, then run build.py to regenerate every STL and STEP file.
"""

# --- Servo (DSServo 45kg, standard size) ---
SERVO_L = 40.0            # body length (MEASURE)
SERVO_W = 20.0            # body width (MEASURE)
SERVO_H = 40.5            # body height, bottom to top face (DS3225 listing; MEASURE)
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
TAB_PILOT_D = 2.8         # M3 self-tapping pilot for servo tab screws
M3_CBORE_D = 6.2          # counterbore for an M3 socket or button head
M3_CBORE_DEPTH = 3.2
HORN_SCREW_BITE = 3.0     # thread length into a tapped horn
TIBIA_HUB_SCREW_L = 16.0  # tibia to knee horn screw length; sets the counterbore depth
FEMUR_SKIN = 1.2          # closed skin left on the femur outer face above each pilot
FIT = 0.3                 # clearance per side around a servo body

# --- Leg geometry (kept equal to Athena so the IK numbers stay the same) ---
FEMUR_LEN = 110.0         # hip axis to knee axis
TIBIA_LEN = 140.0         # knee axis to the foot bolt holes

# --- Femur ---
FEMUR_T = 12.0             # plate thickness
FEMUR_W = 40.0            # plate width
FEMUR_HUB_R = 20.0
FEMUR_CENTER_HOLE = 7.0   # clears the horn center screw head
FEMUR_HORN_HOLE = HORN_D + 2.0  # knee horn sits inside this hole
CRADLE_SIDE = 5.0         # cradle wall beside the servo body
CRADLE_END = 10.0         # cradle wall at each end, under the tabs
FEMUR_SLOT = (30.0, 58.0, 12.0)  # lightening slot: from y, to y, width

# --- Tibia ---
TIBIA_T = 14.0             # main body thickness
TIBIA_TIP_T = 6.0         # tip thickness, fits the 6.3 mm slot in the Athena foot
TIBIA_TIP_LEN = 30.0      # foot holes to the step from TIBIA_TIP_T up to TIBIA_T
TIBIA_HUB_R = 20.0
TIBIA_TIP_R = 12.0
TIBIA_PAD_D = 20.0        # sits on the knee horn face, inside the femur's knee hole
TIBIA_GAP = 2.0           # tibia inner face to femur outer face
FOOT_HOLE_D = 4.4
FOOT_HOLE_SPACING = 15.0  # across the tibia, same as the Athena foot
TIBIA_SLOT = (34.0, 100.0, 8.0)

# --- Hip (Athena pelvis cut down to one servo slot) ---
HIP_H = 20.0              # part thickness
HIP_ARM_T = 10.0          # arm thickness along the abduction axis
HIP_ARM_GAP = 40.6        # space between the arms, holds the servo length
HIP_WALL_T = 3.2          # back wall
HIP_OPEN_EXTRA = 2.0      # arms run this far past the servo on the open side, for the horn counterbore
ABD_PIVOT_D = 6.35        # abduction pivot hole (horn center or leg pin)
ABD_HORN_HOLE_OFFSET = HORN_BOLT_R  # abduction horn screws, on the horn bolt circle
HIP_TAB_PILOT_DEPTH = 7.0  # blind, so the tab screws stop above the horn screws

# Derived
# The pad spans from the knee horn face to the tibia inner face.
TIBIA_PAD_H = max(0.0, FEMUR_T + TIBIA_GAP - HORN_FACE_ABOVE_TOP)
TIBIA_CBORE_DEPTH = TIBIA_T + TIBIA_PAD_H - (TIBIA_HUB_SCREW_L - HORN_SCREW_BITE)
