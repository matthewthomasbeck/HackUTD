// robot_diag calibrate math (motion/calibration.hpp). Each test checks a formula against numbers
// worked out by hand, then against the mixer, so a calibrated robot drives what it is told.

#include <cmath>

#include <gtest/gtest.h>

#include "motion/calibration.hpp"
#include "motion/mecanum.hpp"

namespace robot {
namespace {

using namespace calibration;

TEST(Calibration, TurnsToRadiansPerSecond) {
  // 20 turns in 10 s = 2 rev/s = 4 pi rad/s.
  EXPECT_NEAR(wheel_rad_s_from_turns(20, 10), 4 * kPi, 1e-9);
  EXPECT_EQ(wheel_rad_s_from_turns(5, 0), 0);
}

TEST(Calibration, YawAxisFoundWhateverTheMounting) {
  // IMU mounted so the spin shows on y, with a +1.8 deg/s bias on x like the real one.
  const std::array<double, 3> bias{1.8, -0.2, 0.3};
  std::vector<std::array<double, 3>> during;
  for (int i = 0; i < 100; ++i) during.push_back({1.8 + 0.1 * std::sin(i), -60.2, 0.3});
  const auto yaw = yaw_from_spin(during, bias);
  ASSERT_TRUE(yaw);
  EXPECT_EQ(yaw->axis, 1);
  EXPECT_NEAR(yaw->rate_dps, -60.0, 0.05);
}

TEST(Calibration, NoTurnMeansNoYaw) {
  const std::array<double, 3> bias{1.8, -1.4, 0.3};
  std::vector<std::array<double, 3>> still(50, {1.9, -1.3, 0.2});  // bias plus noise only
  EXPECT_FALSE(yaw_from_spin(still, bias));
  EXPECT_FALSE(yaw_from_spin({}, bias));
}

TEST(Calibration, LxPlusLyFromSpin) {
  // r = 0.07775 m, wheels at 8 rad/s, robot turned 90 deg/s (pi/2 rad/s):
  // lx + ly = 0.07775 * 8 / (pi / 2) = 0.396 m.
  EXPECT_NEAR(lx_plus_ly(0.07775, 8, 90), 0.07775 * 8 / (kPi / 2), 1e-9);
  EXPECT_NEAR(lx_plus_ly(0.07775, 8, -90), lx_plus_ly(0.07775, 8, 90), 1e-12);  // sign of the gyro does not matter
  EXPECT_EQ(lx_plus_ly(0.07775, 8, 0), 0);
}

TEST(Calibration, RadiusFromDrive) {
  // Range shrank 0.5 m in 2 s with wheels at 3.2 rad/s: v = 0.25 m/s, r = 0.25 / 3.2.
  EXPECT_NEAR(radius_from_drive(0.5, 2, 3.2), 0.078125, 1e-9);
}

TEST(Calibration, CalibratedMixerReproducesTheMeasuredSpin) {
  // Round trip: with lx + ly from a measured spin, asking the mixer for that same turn rate
  // must command the wheel speed that produced it.
  const double r = 0.07775, w = 8, measured_dps = 90;
  const double sum = lx_plus_ly(r, w, measured_dps);
  MecanumConfig c;
  c.wheel_radius_m = r;
  c.half_track_lx_m = sum / 2;
  c.half_base_ly_m = sum / 2;
  c.max_wheel_rad_s = 16;
  MotionCommand spin;
  spin.wz_dps = measured_dps;
  const WheelDuties d = mix_mecanum(spin, c);
  EXPECT_NEAR(std::fabs(d[1]) * c.max_wheel_rad_s, w, 1e-9);
}

}  // namespace
}  // namespace robot
