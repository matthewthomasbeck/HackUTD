#pragma once

// Mecanum mixing: body velocity -> four wheel duties (docs/specs/robot.md section 12.4, task R8).
//
// Inverse kinematics, Taheri, Qiao, Ghaeminezhad 2015 eq. 20, with the paper's wheel numbering
// 1 front left, 2 front right, 3 back left, 4 back right (positive = rolls the robot forward):
//   w1 = (vx - vy - (lx + ly) * wz) / r
//   w2 = (vx + vy + (lx + ly) * wz) / r
//   w3 = (vx + vy - (lx + ly) * wz) / r
//   w4 = (vx - vy + (lx + ly) * wz) / r
// vx forward and vy left in m/s, wz counterclockwise in rad/s (MotionCommand carries deg/s).
//
// Then: if any |w| exceeds max_wheel_rad_s, all four are scaled down together so the direction
// is kept; duty = w / max_wheel_rad_s; output k takes paper wheel wheel_order[k], negated if
// invert[k]. Outputs are [driver A ch0, A ch1, B ch0, B ch1].
// While any dimension is 0 (TBD until Matthew measures the robot) every duty is 0.

#include <array>
#include <cmath>

#include "core/commands.hpp"

namespace robot {

struct MecanumConfig {
  double wheel_radius_m = 0;   // motion.mecanum.wheel_radius_m, TBD
  double half_track_lx_m = 0;  // TBD, half the left-right wheel spacing
  double half_base_ly_m = 0;   // TBD, half the front-back wheel spacing
  double max_wheel_rad_s = 0;  // TBD, wheel speed at duty 1
  std::array<int, 4> wheel_order{1, 2, 3, 4};  // paper wheel (1..4) on each output
  std::array<bool, 4> invert{false, false, false, false};
};

// Duties from -1 to 1, in the order [driver A ch0, driver A ch1, driver B ch0, driver B ch1].
using WheelDuties = std::array<double, 4>;

inline bool mecanum_dimensions_known(const MecanumConfig& c) {
  return c.wheel_radius_m > 0 && c.half_track_lx_m > 0 && c.half_base_ly_m > 0 && c.max_wheel_rad_s > 0;
}

inline WheelDuties mix_mecanum(const MotionCommand& command, const MecanumConfig& c) {
  WheelDuties out{0, 0, 0, 0};
  if (!mecanum_dimensions_known(c)) return out;

  constexpr double kPi = 3.14159265358979323846;
  const double vx = command.vx_mps;
  const double vy = command.vy_mps;
  const double wz = command.wz_dps * kPi / 180.0;
  const double k = c.half_track_lx_m + c.half_base_ly_m;
  const double r = c.wheel_radius_m;
  std::array<double, 4> w{
      (vx - vy - k * wz) / r,  // 1 front left
      (vx + vy + k * wz) / r,  // 2 front right
      (vx + vy - k * wz) / r,  // 3 back left
      (vx - vy + k * wz) / r,  // 4 back right
  };

  double peak = 0;
  for (const double v : w) peak = std::fmax(peak, std::fabs(v));
  const double scale = peak > c.max_wheel_rad_s ? c.max_wheel_rad_s / peak : 1.0;

  for (std::size_t slot = 0; slot < 4; ++slot) {
    const int paper = c.wheel_order[slot];
    if (paper < 1 || paper > 4) return WheelDuties{0, 0, 0, 0};  // config rejects this; stay safe anyway
    const double duty = w[static_cast<std::size_t>(paper - 1)] * scale / c.max_wheel_rad_s;
    out[slot] = c.invert[slot] ? -duty : duty;
  }
  return out;
}

}  // namespace robot
