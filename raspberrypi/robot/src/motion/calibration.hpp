#pragma once

// Math for `robot_diag calibrate` (task R8): turns what the robot measured into the
// motion.mecanum.* values. No hardware here, so every formula has a unit test.
//
// Model: DcGpioConfig.min_duty maps a command d in (0, 1] to PWM min + (1 - min) * d, which puts
// d = 0 at the duty where the wheel just stalls and d = 1 at full speed. So a wheel commanded d
// turns at about d * max_wheel_rad_s. Calibration measures max_wheel_rad_s once, on blocks.
//
// Only (lx + ly) appears in the mecanum inverse kinematics (eq. 20), so a spin in place with the
// IMU gyro measures the one number that matters, at the real stance, without a tape measure.

#include <array>
#include <cmath>
#include <optional>
#include <vector>

namespace robot {
namespace calibration {

constexpr double kPi = 3.14159265358979323846;

// Wheel on blocks at duty 1 for `seconds`, `turns` counted with a tape mark.
inline double wheel_rad_s_from_turns(double turns, double seconds) {
  return seconds > 0 ? turns * 2 * kPi / seconds : 0;
}

struct YawRate {
  int axis = -1;          // IMU gyro axis (0 x, 1 y, 2 z) that carried the spin
  double rate_dps = 0;    // signed, bias removed
};

// Mean gyro reading (deg/s) per axis.
inline std::array<double, 3> mean_gyro(const std::vector<std::array<double, 3>>& samples) {
  std::array<double, 3> m{0, 0, 0};
  if (samples.empty()) return m;
  for (const auto& s : samples)
    for (std::size_t i = 0; i < 3; ++i) m[i] += s[i];
  for (auto& v : m) v /= static_cast<double>(samples.size());
  return m;
}

// The axis with the biggest mean rate during the spin is the yaw axis, whatever way the IMU is
// mounted. Empty if the robot did not turn (less than min_dps on every axis).
inline std::optional<YawRate> yaw_from_spin(const std::vector<std::array<double, 3>>& during,
                                            const std::array<double, 3>& bias, double min_dps = 2.0) {
  if (during.empty()) return std::nullopt;
  const auto m = mean_gyro(during);
  YawRate best;
  for (int i = 0; i < 3; ++i) {
    const double v = m[static_cast<std::size_t>(i)] - bias[static_cast<std::size_t>(i)];
    if (std::fabs(v) > std::fabs(best.rate_dps)) best = YawRate{i, v};
  }
  if (std::fabs(best.rate_dps) < min_dps) return std::nullopt;
  return best;
}

// Spinning in place, every wheel at wheel_rad_s: eq. 20 gives (lx + ly) * wz = r * w.
inline double lx_plus_ly(double wheel_radius_m, double wheel_rad_s, double yaw_rate_dps) {
  const double wz = std::fabs(yaw_rate_dps) * kPi / 180.0;
  return wz > 0 ? wheel_radius_m * std::fabs(wheel_rad_s) / wz : 0;
}

// Driving straight at wheel_rad_s toward a wall, the TF-Luna range shrank by `distance_m` in
// `seconds`: v = r * w, so the effective radius is v / w (it includes roller slip).
inline double radius_from_drive(double distance_m, double seconds, double wheel_rad_s) {
  if (seconds <= 0 || wheel_rad_s == 0) return 0;
  return std::fabs(distance_m) / seconds / std::fabs(wheel_rad_s);
}

}  // namespace calibration
}  // namespace robot
