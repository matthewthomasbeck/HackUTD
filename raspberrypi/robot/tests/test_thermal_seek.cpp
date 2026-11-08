// Thermal warm-blob detector (docs/specs/robot.md section 7) and the seek_thermal behavior.
// Scenes are built from fake thermal frames and fake LD19 scans, stepped 125 ms (8 Hz) at a time.

#include <cmath>
#include <vector>

#include <gtest/gtest.h>

#include "mission/behaviors/thermal_seek.hpp"
#include "perception/ld19_range.hpp"
#include "perception/thermal_detector.hpp"

namespace robot {
namespace {

using namespace std::chrono_literals;

struct Patch { int col0, row0, col1, row1; double c; };

ThermalFrame frame(std::vector<Patch> patches, double room_c = 22.0) {
  ThermalFrame f;
  f.width = 32;
  f.height = 24;
  f.centi_deg_c.assign(32 * 24, static_cast<std::int16_t>(room_c * 100));
  for (const auto& p : patches)
    for (int y = p.row0; y <= p.row1; ++y)
      for (int x = p.col0; x <= p.col1; ++x) f.centi_deg_c[static_cast<std::size_t>(y * 32 + x)] = static_cast<std::int16_t>(p.c * 100);
  return f;
}

// A person-sized 34 C patch centered on `col` (4 wide, 8 tall).
Patch person(int col) { return Patch{col - 2, 8, col + 1, 15, 34.0}; }

// LD19 scan with returns at given bearings (deg, right positive) and distances; mount: 0 ahead, clockwise.
Ld19Scan scan(std::vector<std::pair<double, double>> hits) {
  Ld19Scan s;
  for (const auto& [bearing, m] : hits) {
    for (double d = -2; d <= 2; d += 1) {
      Ld19Scan::Point p;
      p.angle_cdeg = static_cast<std::uint16_t>(std::lround(std::fmod(bearing + d + 360.0, 360.0) * 100));
      p.dist_mm = static_cast<std::uint16_t>(m * 1000);
      p.intensity = 200;
      s.points.push_back(p);
    }
  }
  return s;
}

ThermalConfig thermal_cfg() { return ThermalConfig{}; }  // spec starting values: 4 C over median, 3 of 5 frames

// --- Detector (7.1 - 7.3) ---

TEST(ThermalDetector, FindsAWarmPersonSizedBlob) {
  double bg = 0;
  const auto blobs = find_blobs(frame({person(16)}), thermal_cfg(), &bg);
  ASSERT_EQ(blobs.size(), 1u);
  EXPECT_DOUBLE_EQ(bg, 22.0);
  EXPECT_EQ(blobs[0].area, 32);
  EXPECT_NEAR(blobs[0].col, 15.5, 1e-9);
  EXPECT_NEAR(blobs[0].contrast_c, 12.0, 1e-9);
}

TEST(ThermalDetector, SpeckTooHotAndMaskedAreIgnored) {
  ThermalConfig cfg = thermal_cfg();
  cfg.mask.push_back({28, 0, 31, 3});                        // the Pi's own corner
  const auto blobs = find_blobs(frame({{5, 5, 6, 5, 34.0},   // 2 px speck < min_blob_px 3
                                       {10, 10, 13, 13, 60.0},  // heater, over max_c 45
                                       {28, 0, 31, 3, 40.0}}),  // masked electronics
                                cfg);
  EXPECT_TRUE(blobs.empty());
}

TEST(ThermalDetector, BearingSignAndFlip) {
  ThermalConfig cfg = thermal_cfg();  // 55 deg over 32 columns
  EXPECT_NEAR(blob_bearing_deg(15.5, 32, cfg), 0.0, 1e-9);
  EXPECT_NEAR(blob_bearing_deg(31, 32, cfg), (31.5 - 16) * 55.0 / 32, 1e-9);  // right edge: +26.6
  cfg.flip_x = true;
  EXPECT_LT(blob_bearing_deg(31, 32, cfg), 0) << "a mirrored sensor flips left and right";
}

TEST(ThermalDetector, NeedsThreeOfFiveFrames) {
  ThermalTracker t(thermal_cfg());
  const ThermalFrame f = frame({person(24)});
  EXPECT_TRUE(t.update(f).empty());
  EXPECT_TRUE(t.update(f).empty());
  const auto c = t.update(f);
  ASSERT_EQ(c.size(), 1u);
  EXPECT_GT(c[0].bearing_deg, 0);
  EXPECT_GT(c[0].confidence, 0.3);
}

TEST(Ld19Range, ReadsTheBearingAndHonoursTheMount) {
  const Ld19Scan s = scan({{20, 1.5}, {-30, 0.8}});
  EXPECT_NEAR(*ld19_range_at(s, 20, 3, Ld19Mount{}), 1.5, 1e-9);
  EXPECT_NEAR(*ld19_range_at(s, -30, 3, Ld19Mount{}), 0.8, 1e-9);
  EXPECT_FALSE(ld19_range_at(s, 90, 3, Ld19Mount{}));
  // Mounted backwards (its 0 points behind) and counterclockwise: the same hit is elsewhere.
  EXPECT_NEAR(*ld19_range_at(s, 160, 3, Ld19Mount{180, false}), 1.5, 1e-9);
}

// --- Behavior ---

class Scene {
 public:
  explicit Scene(SeekConfig cfg = SeekConfig{}) : b_(thermal_cfg(), cfg) { b_.start(); }
  BehaviorOutput step(const std::vector<Patch>& heat, std::optional<Ld19Scan> lidar = std::nullopt,
                      std::optional<double> tfluna = std::nullopt) {
    now_ += 125ms;
    WorldSnapshot w;
    w.now = now_;
    w.thermal = frame(heat);
    w.thermal_at = now_;
    w.ld19 = std::move(lidar);
    w.range_m = tfluna;
    return b_.tick(w);
  }
  ThermalSeekBehavior& behavior() { return b_; }

 private:
  ThermalSeekBehavior b_;
  SteadyTime now_{};
};

using Phase = ThermalSeekBehavior::Phase;

TEST(ThermalSeek, ScansInStepsWhenNothingIsWarm) {
  Scene s;
  bool turned = false, held = false;
  for (int i = 0; i < 16; ++i) {  // 2 s: one turn step and one dwell
    const auto out = s.step({});
    turned = turned || out.motion.wz_dps > 0;
    held = held || out.motion.wz_dps == 0;
    EXPECT_EQ(out.motion.vx_mps, 0);
  }
  EXPECT_TRUE(turned && held);
  EXPECT_EQ(s.behavior().phase(), Phase::Scan);
}

TEST(ThermalSeek, TurnsRightTowardABlobOnTheRight) {
  Scene s;
  BehaviorOutput out;
  for (int i = 0; i < 4; ++i) out = s.step({person(28)});
  EXPECT_EQ(s.behavior().phase(), Phase::Turn);
  EXPECT_LT(out.motion.wz_dps, 0) << "right of center: turn clockwise";
  EXPECT_EQ(out.motion.vx_mps, 0) << "turn first, then drive";
}

TEST(ThermalSeek, ApproachesAndStopsAtTheStandoffByLd19) {
  Scene s;
  BehaviorOutput out;
  for (int i = 0; i < 4; ++i) out = s.step({person(16)}, scan({{0, 2.0}}));
  ASSERT_EQ(s.behavior().phase(), Phase::Approach);
  out = s.step({person(16)}, scan({{0, 2.0}}));
  EXPECT_GT(out.motion.vx_mps, 0);
  EXPECT_NEAR(*s.behavior().target_distance_m(), 2.0, 1e-9);
  out = s.step({person(16)}, scan({{0, 0.95}}));
  EXPECT_EQ(s.behavior().phase(), Phase::Arrived);
  EXPECT_TRUE(out.done);
  EXPECT_EQ(out.motion.vx_mps, 0);
}

TEST(ThermalSeek, FallsBackToTfLunaWhenCentered) {
  Scene s;
  for (int i = 0; i < 4; ++i) s.step({person(16)}, std::nullopt, 2.0);
  EXPECT_EQ(s.behavior().phase(), Phase::Approach);
  const auto out = s.step({person(16)}, std::nullopt, 0.9);
  EXPECT_TRUE(out.done);
}

TEST(ThermalSeek, PicksTheClosestOfTwoBlobs) {
  Scene s;
  const double left = blob_bearing_deg(3.5, 32, thermal_cfg());
  const double right = blob_bearing_deg(25.5, 32, thermal_cfg());
  for (int i = 0; i < 4; ++i) s.step({person(4), person(26)}, scan({{left, 3.0}, {right, 1.5}}));
  ASSERT_TRUE(s.behavior().target());
  EXPECT_GT(s.behavior().target()->bearing_deg, 0) << "the right one is closer";
  EXPECT_NEAR(*s.behavior().target_distance_m(), 1.5, 1e-9);
}

TEST(ThermalSeek, StaysLockedWhenACloserBlobAppears) {
  Scene s;
  const double right = blob_bearing_deg(25.5, 32, thermal_cfg());
  const double left = blob_bearing_deg(3.5, 32, thermal_cfg());
  for (int i = 0; i < 4; ++i) s.step({person(26)}, scan({{right, 2.0}}));
  ASSERT_GT(s.behavior().target()->bearing_deg, 0);
  for (int i = 0; i < 4; ++i) s.step({person(4), person(26)}, scan({{left, 1.0}, {right, 2.0}}));
  EXPECT_GT(s.behavior().target()->bearing_deg, 0) << "no flipping between people";
}

TEST(ThermalSeek, StopsDrivingForAnObstacleThatIsNotTheTarget) {
  Scene s;
  for (int i = 0; i < 4; ++i) s.step({person(16)}, scan({{0, 2.0}}));
  ASSERT_EQ(s.behavior().phase(), Phase::Approach);
  const auto out = s.step({person(16)}, scan({{0, 2.0}, {12, 0.2}}));  // a box 0.2 m ahead, off to the side
  EXPECT_EQ(out.motion.vx_mps, 0);
  EXPECT_EQ(s.behavior().phase(), Phase::Approach) << "waits rather than giving up";
}

TEST(ThermalSeek, ScansAgainWhenTheTargetIsLost) {
  Scene s;
  for (int i = 0; i < 4; ++i) s.step({person(28)});
  ASSERT_EQ(s.behavior().phase(), Phase::Turn);
  for (int i = 0; i < 14; ++i) s.step({});  // 1.75 s > lost_s 1.5
  EXPECT_EQ(s.behavior().phase(), Phase::Scan);
}

TEST(ThermalSeek, GivesUpWhenNothingIsFound) {
  SeekConfig cfg;
  cfg.scan_max_s = 2;
  Scene s(cfg);
  BehaviorOutput out;
  for (int i = 0; i < 20; ++i) out = s.step({});
  EXPECT_EQ(s.behavior().phase(), Phase::GaveUp);
  EXPECT_TRUE(out.failed);
  EXPECT_EQ(out.motion.wz_dps, 0);
}

}  // namespace
}  // namespace robot
