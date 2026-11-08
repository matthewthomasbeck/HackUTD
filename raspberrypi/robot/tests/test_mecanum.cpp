// Mecanum mixer (docs/specs/robot.md section 12.4, eq. 20; test names from docs/tasks/camille.md R8).

#include <cmath>

#include <gtest/gtest.h>

#include "core/config.hpp"
#include "motion/mecanum.hpp"

namespace robot {
namespace {

// Round numbers so the expected values are easy to check by hand:
// r = 0.05 m, lx + ly = 0.2 m, duty 1 = 20 rad/s.
MecanumConfig measured() {
  MecanumConfig c;
  c.wheel_radius_m = 0.05;
  c.half_track_lx_m = 0.12;
  c.half_base_ly_m = 0.08;
  c.max_wheel_rad_s = 20;
  return c;  // identity order, no invert: outputs are paper wheels 1..4
}

MotionCommand cmd(double vx, double vy, double wz_dps) {
  MotionCommand m;
  m.vx_mps = vx;
  m.vy_mps = vy;
  m.wz_dps = wz_dps;
  return m;
}

TEST(Mecanum, PureVxAllWheelsSameSign) {
  const WheelDuties d = mix_mecanum(cmd(0.5, 0, 0), measured());  // 0.5 / 0.05 = 10 rad/s = duty 0.5
  for (double v : d) EXPECT_NEAR(v, 0.5, 1e-9);
}

TEST(Mecanum, PureVyAlternatesSigns) {
  const WheelDuties d = mix_mecanum(cmd(0, 0.5, 0), measured());  // strafe left
  EXPECT_NEAR(d[0], -0.5, 1e-9);  // front left back
  EXPECT_NEAR(d[1], 0.5, 1e-9);   // front right forward
  EXPECT_NEAR(d[2], 0.5, 1e-9);   // back left forward
  EXPECT_NEAR(d[3], -0.5, 1e-9);  // back right back
}

TEST(Mecanum, PureWzOpposesSides) {
  const double wz_dps = 2.5 * 180.0 / M_PI;  // 2.5 rad/s: 0.2 * 2.5 / 0.05 = 10 rad/s per wheel
  const WheelDuties d = mix_mecanum(cmd(0, 0, wz_dps), measured());  // spin left
  EXPECT_NEAR(d[0], -0.5, 1e-9);
  EXPECT_NEAR(d[1], 0.5, 1e-9);
  EXPECT_NEAR(d[2], -0.5, 1e-9);
  EXPECT_NEAR(d[3], 0.5, 1e-9);
}

TEST(Mecanum, WzDegreesConvertedToRadians) {
  // 20 deg/s = 0.349 rad/s: each wheel 0.2 * 0.349 / 0.05 = 1.396 rad/s = duty 0.0698.
  const WheelDuties d = mix_mecanum(cmd(0, 0, 20), measured());
  EXPECT_NEAR(d[1], 0.2 * (20 * M_PI / 180) / 0.05 / 20, 1e-9);
}

TEST(Mecanum, SaturationKeepsDirection) {
  // vx 2 m/s + vy 1 m/s: w1 = 20, w2 = 60, w3 = 60, w4 = 20 rad/s; the peak 60 > 20 scales by 1/3.
  const WheelDuties d = mix_mecanum(cmd(2, 1, 0), measured());
  EXPECT_NEAR(d[1], 1.0, 1e-9);
  EXPECT_NEAR(d[0], 1.0 / 3.0, 1e-9);
  EXPECT_NEAR(d[0] / d[1], 20.0 / 60.0, 1e-9);  // the ratio, so the direction, is unchanged
  for (double v : d) EXPECT_LE(std::fabs(v), 1.0 + 1e-12);
}

TEST(Mecanum, WheelOrderAndInvertApplied) {
  // The robot's wiring: [A ch0, A ch1, B ch0, B ch1] = [FL, BL, BR, FR], left side inverted.
  MecanumConfig c = measured();
  c.wheel_order = {1, 3, 4, 2};
  c.invert = {true, true, false, false};
  const WheelDuties d = mix_mecanum(cmd(0, 0.5, 0), c);  // strafe left: FL -, FR +, BL +, BR -
  EXPECT_NEAR(d[0], 0.5, 1e-9);    // FL -0.5, inverted
  EXPECT_NEAR(d[1], -0.5, 1e-9);   // BL +0.5, inverted
  EXPECT_NEAR(d[2], -0.5, 1e-9);   // BR -0.5
  EXPECT_NEAR(d[3], 0.5, 1e-9);    // FR +0.5
}

TEST(Mecanum, ZeroDimensionsReportFailed) {
  // Dimensions still TBD: no division by zero, every wheel held at 0.
  MecanumConfig c = measured();
  c.wheel_radius_m = 0;
  EXPECT_FALSE(mecanum_dimensions_known(c));
  for (double v : mix_mecanum(cmd(0.5, 0.5, 30), c)) EXPECT_EQ(v, 0.0);
}

TEST(Mecanum, PiConfigUsesTheWiredOrder) {
  const auto r = load_config_file(std::string(ROBOT_CONFIG_DIR) + "/robot.yaml");
  ASSERT_TRUE(r.ok) << r.error;
  EXPECT_EQ(r.config.mecanum.wheel_order, (std::array<int, 4>{1, 3, 4, 2}));
  EXPECT_EQ(r.config.dc_driver.at("dc_driver_b").pins[0], (std::array<int, 2>{5, 6}));
}

}  // namespace
}  // namespace robot
