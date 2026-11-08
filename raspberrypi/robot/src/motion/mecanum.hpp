#pragma once

// Mecanum mixing: body velocity -> four wheel duties (docs/specs/robot.md section 12.4, task R8).
// Wheel radius, spacing, wheel order, and inversion are TBD (config motion.mecanum.*), so the
// mixer is a stub that returns zero until Matthew measures the robot.

#include <array>

#include "core/commands.hpp"

namespace robot {

struct MecanumConfig {
  double wheel_radius_m = 0;   // motion.mecanum.wheel_radius_m, TBD
  double half_track_lx_m = 0;  // TBD
  double half_base_ly_m = 0;   // TBD
  double max_wheel_rad_s = 0;  // TBD
  std::array<int, 4> wheel_order{1, 2, 3, 4};
  std::array<bool, 4> invert{false, false, false, false};
};

// Duties from -1 to 1, in the order [driver A ch0, driver A ch1, driver B ch0, driver B ch1].
using WheelDuties = std::array<double, 4>;

// TODO(R8): inverse kinematics of the mecanum base (eq. 20 in the spec), then scale all four
// wheels together if one saturates so the direction is kept. Returns zeros while dimensions are 0.
inline WheelDuties mix_mecanum(const MotionCommand& command, const MecanumConfig& config) {
  (void)command;
  (void)config;
  return {0, 0, 0, 0};
}

}  // namespace robot
