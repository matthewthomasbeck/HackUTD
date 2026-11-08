#pragma once

// Commands that flow from behaviors, through the safety gate, to the movement thread.

namespace robot {

// A leg goal for the IK layer (task R8, stretch). The geometry and channel map are TBD
// (docs/ROBOT.md "Legs"), so only the request shape exists; ask Matthew before adding IK math.
struct LegRequest {
  enum class Move { None, Stance, Lift };
  Move move = Move::None;  // None: no new goal, hold the current pose
  int leg = -1;            // for Lift: 0..3, order TBD
  double height_m = 0;     // for Stance: body height; for Lift: foot lift
};

// Body velocity for the mecanum drive, plus an optional leg goal. Units match docs/specs/robot.md:
// vx forward and vy left in m/s, wz in degrees per second counterclockwise.
struct MotionCommand {
  double vx_mps = 0;
  double vy_mps = 0;
  double wz_dps = 0;
  LegRequest legs;

  static MotionCommand stop() { return {}; }
  bool is_zero() const { return vx_mps == 0 && vy_mps == 0 && wz_dps == 0 && legs.move == LegRequest::Move::None; }
};

// What a behavior proposes for one tick. Behaviors never touch hardware; the safety gate
// decides what reaches the movement thread.
struct BehaviorOutput {
  MotionCommand motion;
  bool done = false;    // the mission finished; the state machine goes back to READY
  bool failed = false;  // the mission failed; also back to READY
};

}  // namespace robot
