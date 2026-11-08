#pragma once

// Commands that flow from behaviors, through the safety gate, to the flight thread.

namespace drone {

// A high-level velocity request, the same shape as the dog's MotionCommand without the leg goal:
// vx forward and vy left in m/s, wz in degrees per second counterclockwise (seen from above).
// It is a request only. Turning it into rotor output (mixing, PID, attitude control) is flight
// control, which is not written and needs a team decision first (drone/README.md, open questions).
// There is no vertical axis yet, because the teleop contract (CONTRACTS.md 8.3) has none.
struct MotionCommand {
  double vx_mps = 0;
  double vy_mps = 0;
  double wz_dps = 0;

  static MotionCommand stop() { return {}; }
  bool is_zero() const { return vx_mps == 0 && vy_mps == 0 && wz_dps == 0; }
};

// What a behavior proposes for one tick. Behaviors never touch hardware; the safety gate
// decides what reaches the flight thread.
struct BehaviorOutput {
  MotionCommand motion;
  bool done = false;    // the mission finished; the state machine goes back to READY
  bool failed = false;  // the mission failed; also back to READY
};

}  // namespace drone
