// Terrain tests (docs/specs/robot.md section 7b, docs/tasks/camille.md R7). No hardware.

#include <sys/stat.h>
#include <unistd.h>

#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <functional>
#include <memory>
#include <string>

#include <gtest/gtest.h>
#include <yaml-cpp/yaml.h>

#include "bridge/messages.hpp"
#include "core/clock.hpp"
#include "core/config.hpp"
#include "core/world.hpp"
#include "hal/device_mock.hpp"
#include "state/safety_gate.hpp"
#include "terrain/terrain.hpp"
#include "terrain/terrain_frame_writer.hpp"
#include "terrain/terrain_hint.hpp"
#include "terrain/terrain_pipeline.hpp"
#include "terrain/terrain_reporter.hpp"

namespace robot {
namespace {

using std::chrono::system_clock;

// robot.yaml's start values, with the single LiDAR pointing forward.
TerrainConfig forward_config() { return TerrainConfig{}; }

// The single LiDAR angled down at the ground, 0.30 m away on flat floor.
TerrainConfig down_config() {
  TerrainConfig c;
  c.lidar_single_mode = "down";
  c.ground_range_m = 0.30;
  return c;
}

// One LD19 point per degree; range_at(bearing) gives metres, or <= 0 for no return.
Ld19Scan scan(const std::function<double(double)>& range_at) {
  Ld19Scan s;
  for (int b = -180; b < 180; ++b) {
    const double m = range_at(b);
    if (m <= 0) continue;
    Ld19Scan::Point p;
    p.angle_cdeg = static_cast<std::uint16_t>(((b + 360) % 360) * 100);
    p.dist_mm = static_cast<std::uint16_t>(m * 1000);
    p.intensity = 200;
    s.points.push_back(p);
  }
  return s;
}

ImuSample level() { return ImuSample{0, 0, 9.81f, 0, 0, 0}; }

// A room 2 m away in every direction, single LiDAR 1.5 m ahead, IMU level.
WorldSnapshot open_floor(SteadyTime now = SteadyTime{}) {
  WorldSnapshot w;
  w.now = now;
  w.ld19 = scan([](double) { return 2.0; });
  w.range_m = 1.5;
  w.imu = level();
  w.imu_at = now;
  return w;
}

TerrainAssessment assess_once(const TerrainConfig& cfg, const WorldSnapshot& w) {
  return make_terrain_rules(cfg)->assess(w);
}

// ---- Rules, in robot.md 7b.3 order ----

TEST(Terrain, BlockedWithClearSideSteers) {
  // A box 0.20 m ahead (+-20 degrees), a wall 0.4 m on the left, open 2 m on the right.
  auto w = open_floor();
  w.ld19 = scan([](double b) { return std::fabs(b) <= 20 ? 0.20 : b < 0 ? 0.4 : 2.0; });
  const auto a = assess_once(forward_config(), w);
  EXPECT_EQ(a.cls, TerrainClass::blocked);
  EXPECT_EQ(a.action, TerrainAction::kSteer);
  EXPECT_GT(a.steer_bearing_deg, 20);  // to the right, past the box
  EXPECT_TRUE(a.safety_stop);
  EXPECT_TRUE(a.allow_rotation);
  EXPECT_DOUBLE_EQ(a.speed_scale, 0);
}

TEST(Terrain, BlockedWithNoClearSideStops) {
  auto w = open_floor();
  w.ld19 = scan([](double b) { return std::fabs(b) <= 20 ? 0.20 : 0.5; });  // a dead end, nothing over 0.6 m
  const auto a = assess_once(forward_config(), w);
  EXPECT_EQ(a.cls, TerrainClass::blocked);
  EXPECT_EQ(a.action, TerrainAction::kStop);
  EXPECT_TRUE(a.safety_stop);
  EXPECT_FALSE(a.allow_rotation);
}

TEST(Terrain, BlockedBySingleLidarAloneAndAgreementRaisesConfidence) {
  const TerrainConfig cfg = forward_config();
  auto only_single = open_floor();
  only_single.range_m = 0.15;
  const auto a = assess_once(cfg, only_single);
  EXPECT_EQ(a.cls, TerrainClass::blocked);
  EXPECT_NEAR(a.confidence, cfg.base(TerrainClass::blocked), 1e-9);

  auto both = only_single;
  both.ld19 = scan([](double b) { return std::fabs(b) <= 20 ? 0.18 : 2.0; });
  EXPECT_NEAR(assess_once(cfg, both).confidence, std::min(1.0, cfg.base(TerrainClass::blocked) + cfg.agree_bonus), 1e-9);
}

TEST(Terrain, GapIsSafetyStop) {
  auto w = open_floor();
  w.range_m = 0.40;  // the ground is 0.10 m further than flat floor (drop over 0.05 m)
  const auto a = assess_once(down_config(), w);
  EXPECT_EQ(a.cls, TerrainClass::gap);
  EXPECT_EQ(a.action, TerrainAction::kStop);
  EXPECT_TRUE(a.safety_stop);
}

TEST(Terrain, TiltOverLimitIsStepStop) {
  auto w = open_floor();
  // 30 degrees nose down: gravity shows up on x.
  w.imu = ImuSample{static_cast<float>(-9.81 * std::sin(0.5236)), 0, static_cast<float>(9.81 * std::cos(0.5236)), 0, 0, 0};
  const auto a = assess_once(forward_config(), w);
  EXPECT_EQ(a.cls, TerrainClass::step);
  EXPECT_EQ(a.action, TerrainAction::kStop);
  EXPECT_TRUE(a.safety_stop);
}

TEST(Terrain, SmallStepSlowsBigStepStops) {
  TerrainConfig cfg = down_config();
  cfg.max_step_m = 0.06;  // what Matthew says the robot can cross (placeholder)
  auto w = open_floor();
  w.range_m = 0.25;  // 0.05 m rise
  auto a = assess_once(cfg, w);
  EXPECT_EQ(a.cls, TerrainClass::step);
  EXPECT_EQ(a.action, TerrainAction::kSlow);
  EXPECT_FALSE(a.safety_stop);
  EXPECT_DOUBLE_EQ(a.speed_scale, cfg.slow_scale);

  w.range_m = 0.20;  // 0.10 m rise
  a = assess_once(cfg, w);
  EXPECT_EQ(a.cls, TerrainClass::step);
  EXPECT_EQ(a.action, TerrainAction::kStop);
}

TEST(Terrain, StepStopsWhileMaxStepIsTbd) {
  auto w = open_floor();
  w.range_m = 0.25;  // a 5 cm rise, but terrain.max_step_m is still 0 (TBD): never try to cross
  EXPECT_EQ(assess_once(down_config(), w).action, TerrainAction::kStop);
}

TEST(Terrain, DebrisSlows) {
  // Shaking in pitch and roll at 50 Hz for a second.
  auto rules = make_terrain_rules(forward_config());
  FakeClock clock;
  TerrainAssessment a;
  for (int i = 0; i < 50; ++i) {
    auto w = open_floor(clock.now());
    const float shake = (i % 2 ? 1.f : -1.f) * 45.f;
    w.imu = ImuSample{0, 0, 9.81f, shake, shake, 0};
    a = rules->assess(w);
    clock.advance(Millis(20));
  }
  EXPECT_EQ(a.cls, TerrainClass::debris);
  EXPECT_EQ(a.action, TerrainAction::kSlow);
}

TEST(Terrain, RaggedForwardScanIsDebris) {
  auto w = open_floor();
  w.ld19 = scan([](double b) { return std::fabs(b) <= 30 ? (static_cast<int>(b) % 2 ? 0.5 : 1.0) : 2.0; });
  EXPECT_EQ(assess_once(forward_config(), w).cls, TerrainClass::debris);
}

TEST(Terrain, TurningInPlaceIsNotDebris) {
  // A fast spin on the yaw axis (heading.gyro_axis z) is the robot's own motion, not rough ground.
  auto rules = make_terrain_rules(forward_config());
  FakeClock clock;
  TerrainAssessment a;
  for (int i = 0; i < 50; ++i) {
    auto w = open_floor(clock.now());
    w.imu = ImuSample{0, 0, 9.81f, 0, 0, 90.f};
    a = rules->assess(w);
    clock.advance(Millis(20));
  }
  EXPECT_EQ(a.cls, TerrainClass::flat);
}

TEST(Terrain, FlatContinues) {
  const auto a = assess_once(forward_config(), open_floor());
  EXPECT_EQ(a.cls, TerrainClass::flat);
  EXPECT_EQ(a.action, TerrainAction::kContinue);
  EXPECT_FALSE(a.safety_stop);
  EXPECT_DOUBLE_EQ(a.speed_scale, 1.0);
  EXPECT_EQ(a.source, "lidar_imu_rules");
}

TEST(Terrain, MissingInputsLowerConfidenceAndOneFreshIsUnknown) {
  const TerrainConfig cfg = forward_config();
  auto w = open_floor();
  w.ld19.reset();  // stale or missing: observe() leaves it empty
  auto a = assess_once(cfg, w);
  EXPECT_EQ(a.cls, TerrainClass::flat);  // two inputs still fresh
  EXPECT_NEAR(a.confidence, cfg.base(TerrainClass::flat) - cfg.missing_input_penalty, 1e-9);

  w.imu.reset();
  a = assess_once(cfg, w);
  EXPECT_EQ(a.cls, TerrainClass::unknown);
  EXPECT_EQ(a.action, TerrainAction::kSlow);
}

TEST(Terrain, AllInputsMissingIsUnknown) {
  WorldSnapshot w;
  const auto a = assess_once(forward_config(), w);
  EXPECT_EQ(a.cls, TerrainClass::unknown);
  EXPECT_EQ(a.action, TerrainAction::kSlow);
  EXPECT_EQ(a.reason, "every input missing");
}

TEST(Terrain, MissingInputsNeverHideABlock) {
  // Only the single LiDAR is left, and it sees something close: still blocked, still a stop.
  WorldSnapshot w;
  w.range_m = 0.1;
  const auto a = assess_once(forward_config(), w);
  EXPECT_EQ(a.cls, TerrainClass::blocked);
  EXPECT_EQ(a.action, TerrainAction::kStop);
}

TEST(Terrain, LidarMountingIsUsed) {
  // The LD19 is mounted with its 0 degrees pointing backward: a return at LD19 angle 180 is ahead.
  TerrainConfig cfg = forward_config();
  cfg.ld19 = Ld19Mount{180, true};
  auto w = open_floor();
  w.ld19 = scan([](double b) { return std::fabs(std::fabs(b) - 180) <= 10 ? 0.15 : 2.0; });
  EXPECT_EQ(assess_once(cfg, w).cls, TerrainClass::blocked);
  EXPECT_NE(assess_once(forward_config(), w).cls, TerrainClass::blocked);
}

// ---- Hysteresis ----

TerrainAssessment result(TerrainClass cls, TerrainAction action) {
  TerrainAssessment a;
  a.cls = cls;
  set_action(a, action, TerrainConfig{});
  return a;
}

TEST(Terrain, HysteresisDelaysClassChangeButNotStop) {
  TerrainHysteresis h(5);
  EXPECT_EQ(h.update(result(TerrainClass::flat, TerrainAction::kContinue)).cls, TerrainClass::flat);
  for (int i = 0; i < 4; ++i) {
    EXPECT_EQ(h.update(result(TerrainClass::debris, TerrainAction::kSlow)).cls, TerrainClass::flat) << i;
  }
  EXPECT_EQ(h.update(result(TerrainClass::debris, TerrainAction::kSlow)).cls, TerrainClass::debris);
  // A stop applies on its first tick.
  const auto& s = h.update(result(TerrainClass::gap, TerrainAction::kStop));
  EXPECT_EQ(s.cls, TerrainClass::gap);
  EXPECT_TRUE(s.safety_stop);
}

TEST(Terrain, HysteresisDelaysLeavingAStop) {
  TerrainHysteresis h(5);
  h.update(result(TerrainClass::blocked, TerrainAction::kStop));
  for (int i = 0; i < 4; ++i) EXPECT_TRUE(h.update(result(TerrainClass::flat, TerrainAction::kContinue)).safety_stop) << i;
  EXPECT_FALSE(h.update(result(TerrainClass::flat, TerrainAction::kContinue)).safety_stop);
}

TEST(Terrain, HysteresisFlickerNeverChangesClass) {
  TerrainHysteresis h(3);
  h.update(result(TerrainClass::flat, TerrainAction::kContinue));
  for (int i = 0; i < 20; ++i) {
    const auto cls = i % 2 ? TerrainClass::debris : TerrainClass::unknown;
    EXPECT_EQ(h.update(result(cls, TerrainAction::kSlow)).cls, TerrainClass::flat);
  }
}

// ---- Reporter ----

TEST(Terrain, ReporterSendsOnChangeAtMostOneHz) {
  TerrainReporter rep(TerrainConfig{});  // 1 Hz, keep-alive 5 s
  FakeClock clock;
  const auto flat = result(TerrainClass::flat, TerrainAction::kContinue);
  const auto debris = result(TerrainClass::debris, TerrainAction::kSlow);
  const auto blocked = result(TerrainClass::blocked, TerrainAction::kStop);
  int sent = 0;
  std::optional<TerrainAssessment> last;
  auto tick = [&](const TerrainAssessment& a, bool moving = false) {
    if (auto r = rep.update(a, moving, clock.now())) {
      ++sent;
      last = r;
    }
    clock.advance(Millis(20));
  };
  tick(flat);  // t = 0: sent
  for (int i = 0; i < 14; ++i) tick(debris);   // until 0.3 s: waits
  for (int i = 0; i < 36; ++i) tick(blocked);  // the window opens at 1.0 s with blocked, the newest
  EXPECT_EQ(sent, 2);
  EXPECT_EQ(last->cls, TerrainClass::blocked);
  for (int i = 0; i < 500; ++i) tick(blocked);  // 10 s still: no keep-alive
  EXPECT_EQ(sent, 2);
}

TEST(Terrain, ReporterKeepAliveWhileMovingAndResendOnReconnect) {
  TerrainReporter rep(TerrainConfig{});
  FakeClock clock;
  const auto flat = result(TerrainClass::flat, TerrainAction::kContinue);
  int sent = 0;
  for (int i = 0; i < 551; ++i) {  // 11 s moving at 50 Hz
    if (rep.update(flat, true, clock.now())) ++sent;
    clock.advance(Millis(20));
  }
  EXPECT_EQ(sent, 3);  // t = 0, 5 s, 10 s
  rep.resend();
  EXPECT_TRUE(rep.update(flat, false, clock.now()));
}

// ---- Camera hint (robot.md 7b.5) ----

constexpr double kMaxAge = 1500;

TerrainHintMsg hint_msg(const std::string& cls, double conf, system_clock::time_point observed) {
  return TerrainHintMsg{cls, conf, iso8601_utc(observed)};
}

TerrainConfig hint_config() {
  TerrainConfig c;
  c.camera_hint.enabled = true;
  return c;
}

TEST(Terrain, FreshHintAgreementRaisesAndDisagreementLowersConfidence) {
  const auto cfg = hint_config();
  auto debris = result(TerrainClass::debris, TerrainAction::kSlow);
  debris.confidence = 0.5;
  const TerrainHint agree{TerrainClass::debris, 0.8, {}, ""};
  const TerrainHint disagree{TerrainClass::flat, 0.8, {}, ""};
  EXPECT_NEAR(apply_hint(debris, agree, cfg).confidence, 0.5 + 0.3 * 0.8, 1e-9);
  EXPECT_NEAR(apply_hint(debris, disagree, cfg).confidence, 0.5 - 0.3 * 0.8, 1e-9);
  EXPECT_EQ(apply_hint(debris, agree, cfg).source, "lidar_imu_rules+camera_model");
  EXPECT_EQ(apply_hint(debris, disagree, cfg).cls, TerrainClass::debris);  // the rule class stays
}

TEST(Terrain, FreshHintOnlyMoreCautious) {
  const auto cfg = hint_config();
  const auto flat = result(TerrainClass::flat, TerrainAction::kContinue);
  for (const auto cls : {TerrainClass::debris, TerrainClass::step, TerrainClass::gap, TerrainClass::blocked}) {
    const auto out = apply_hint(flat, TerrainHint{cls, 0.9, {}, ""}, cfg);
    EXPECT_EQ(out.action, TerrainAction::kSlow) << to_string(cls);  // slow, never stop or steer
    EXPECT_EQ(out.cls, TerrainClass::flat);
    EXPECT_FALSE(out.safety_stop);
  }
  // A camera "flat" never speeds up a slow.
  const auto slow = result(TerrainClass::debris, TerrainAction::kSlow);
  const auto out = apply_hint(slow, TerrainHint{TerrainClass::flat, 1.0, {}, ""}, cfg);
  EXPECT_EQ(out.action, TerrainAction::kSlow);
  EXPECT_DOUBLE_EQ(out.speed_scale, slow.speed_scale);
}

TEST(Terrain, HintNeverClearsSafetyStop) {
  const auto cfg = hint_config();
  for (const auto action : {TerrainAction::kStop, TerrainAction::kSteer}) {
    auto blocked = result(TerrainClass::blocked, action);
    blocked.confidence = 0.8;
    const auto out = apply_hint(blocked, TerrainHint{TerrainClass::flat, 1.0, {}, ""}, cfg);
    EXPECT_EQ(out.cls, TerrainClass::blocked);
    EXPECT_EQ(out.action, action);
    EXPECT_TRUE(out.safety_stop);
    EXPECT_DOUBLE_EQ(out.speed_scale, 0);
    EXPECT_NEAR(out.confidence, 0.5, 1e-9);  // only the confidence moves
  }
}

TEST(Terrain, NoAdviceHintChangesNothing) {
  const auto cfg = hint_config();
  const auto flat = result(TerrainClass::flat, TerrainAction::kContinue);
  // What the service answers while terrain_hint_enabled is false.
  const auto out = apply_hint(flat, TerrainHint{TerrainClass::unknown, 0.0, {}, ""}, cfg);
  EXPECT_EQ(out.action, TerrainAction::kContinue);
  EXPECT_EQ(out.source, "lidar_imu_rules");
}

TEST(Terrain, StaleCameraHintIgnored) {
  TerrainHintSlot slot;
  FakeClock clock;
  const auto wall = system_clock::now();
  EXPECT_EQ(slot.offer(hint_msg("debris", 0.9, wall), wall, clock.now(), kMaxAge), "");
  EXPECT_TRUE(slot.fresh(clock.now(), kMaxAge));
  clock.advance(Millis(1501));
  EXPECT_FALSE(slot.fresh(clock.now(), kMaxAge));
}

TEST(Terrain, DelayedHintIsAgedFromCaptureNotArrival) {
  // The frame was captured 1.2 s before the answer arrived, so it has 0.3 s of life left.
  TerrainHintSlot slot;
  FakeClock clock;
  clock.advance(Millis(10000));
  const auto wall = system_clock::now();
  EXPECT_EQ(slot.offer(hint_msg("step", 0.7, wall - Millis(1200)), wall, clock.now(), kMaxAge), "");
  clock.advance(Millis(250));
  EXPECT_TRUE(slot.fresh(clock.now(), kMaxAge));
  clock.advance(Millis(100));
  EXPECT_FALSE(slot.fresh(clock.now(), kMaxAge));
  EXPECT_EQ(slot.fresh(clock.now() - Millis(100), kMaxAge)->observed_at, iso8601_utc(wall - Millis(1200)));
}

TEST(Terrain, OlderHintCannotReplaceNewer) {
  TerrainHintSlot slot;
  FakeClock clock;
  clock.advance(Millis(10000));
  const auto wall = system_clock::now();
  EXPECT_EQ(slot.offer(hint_msg("blocked", 0.9, wall - Millis(100)), wall, clock.now(), kMaxAge), "");
  // A slow answer for an earlier frame arrives after it.
  EXPECT_NE(slot.offer(hint_msg("flat", 0.9, wall - Millis(900)), wall, clock.now(), kMaxAge), "");
  EXPECT_EQ(slot.fresh(clock.now(), kMaxAge)->cls, TerrainClass::blocked);
}

TEST(Terrain, InvalidHintsAreDropped) {
  TerrainHintSlot slot;
  const auto wall = system_clock::now();
  const SteadyTime now{};
  EXPECT_NE(slot.offer(hint_msg("rubble", 0.5, wall), wall, now, kMaxAge), "");
  EXPECT_NE(slot.offer(hint_msg("flat", 1.5, wall), wall, now, kMaxAge), "");
  EXPECT_NE(slot.offer(hint_msg("flat", -0.1, wall), wall, now, kMaxAge), "");
  EXPECT_NE(slot.offer(TerrainHintMsg{"flat", 0.5, "yesterday"}, wall, now, kMaxAge), "");
  EXPECT_NE(slot.offer(hint_msg("flat", 0.5, wall + Millis(5000)), wall, now, kMaxAge), "");  // from the future
  EXPECT_FALSE(slot.fresh(now, kMaxAge));
}

TEST(Terrain, DisabledHintIsIgnored) {
  TerrainConfig cfg;  // camera_hint.enabled false, as in robot.yaml
  TerrainPipeline p(cfg, make_terrain_rules(cfg));
  const auto wall = system_clock::now();
  EXPECT_NE(p.offer_hint(hint_msg("gap", 1.0, wall), wall, SteadyTime{}), "");
  const auto a = p.tick(open_floor());
  EXPECT_EQ(a.action, TerrainAction::kContinue);
  EXPECT_EQ(a.source, "lidar_imu_rules");
}

TEST(Terrain, Iso8601RoundTrip) {
  const auto t = parse_iso8601_utc("2026-11-08T14:03:12.345Z");
  ASSERT_TRUE(t);
  EXPECT_EQ(iso8601_utc(*t), "2026-11-08T14:03:12.345Z");
  EXPECT_TRUE(parse_iso8601_utc("2026-11-08T14:03:12+00:00"));
  EXPECT_TRUE(parse_iso8601_utc("2026-11-08T14:03:12.345678Z"));  // Python isoformat
  EXPECT_FALSE(parse_iso8601_utc("2026-11-08T14:03:12"));           // no zone
  EXPECT_FALSE(parse_iso8601_utc("2026-11-08T14:03:12-05:00"));
  EXPECT_FALSE(parse_iso8601_utc(""));
}

// ---- The gate, with the whole pipeline ----

DeviceView ok_device(const std::string& name) {
  DeviceView d;
  d.name = name;
  d.required = true;
  d.initialized = true;
  d.status = DeviceStatus::OK;
  return d;
}

WorldSnapshot healthy(WorldSnapshot w) {
  w.devices.push_back(ok_device("pico"));
  w.init_complete = true;
  w.pico_heartbeat_age_ms = 10;
  return w;
}

BehaviorOutput drive(double vx, double wz = 0) {
  BehaviorOutput out;
  out.motion.vx_mps = vx;
  out.motion.wz_dps = wz;
  return out;
}

GateMemory moving(double vx, double wz = 0) {
  GateMemory m;
  m.last_sent.vx_mps = vx;
  m.last_sent.wz_dps = wz;
  return m;
}

TEST(Terrain, GateZeroesTranslationOnStopEvenIfBehaviorDrives) {
  // A buggy behavior drives full speed at a box with no clear side.
  auto w = healthy(open_floor());
  w.ld19 = scan([](double b) { return std::fabs(b) <= 20 ? 0.20 : 0.5; });
  TerrainPipeline p(forward_config(), make_terrain_rules(forward_config()));
  w.terrain = p.tick(w);
  const auto r = SafetyGate::filter(State::ACTIVE, false, w, drive(0.2, 30), GateConfig{}, moving(0.2, 30));
  EXPECT_TRUE(r.motion.command().is_zero());
}

TEST(Terrain, GateCapsSpeedOnSlowEvenIfBehaviorIgnoresIt) {
  auto w = healthy(open_floor());
  w.ld19 = scan([](double b) { return std::fabs(b) <= 30 ? (static_cast<int>(b) % 2 ? 0.5 : 1.0) : 2.0; });
  TerrainPipeline p(forward_config(), make_terrain_rules(forward_config()));
  w.terrain = p.tick(w);
  ASSERT_EQ(w.terrain->action, TerrainAction::kSlow);
  GateConfig g;
  // Already at the slow speed, so the acceleration limit does not hide the cap.
  const auto r = SafetyGate::filter(State::ACTIVE, false, w, drive(0.2), g, moving(0.1));
  EXPECT_DOUBLE_EQ(r.motion.command().vx_mps, g.max_lin_mps * g.terrain_slow_scale);
}

TEST(Terrain, FlatHintCannotReleaseStopAndDeadNetworkGivesTheSameResult) {
  // The example in the handoff: LiDAR blocked with no clear side, camera says flat.
  const auto cfg = hint_config();
  auto w = healthy(open_floor(SteadyTime{} + Millis(10000)));
  w.ld19 = scan([](double b) { return std::fabs(b) <= 20 ? 0.20 : 0.5; });

  TerrainPipeline with_hint(cfg, make_terrain_rules(cfg));
  const auto wall = system_clock::now();
  ASSERT_EQ(with_hint.offer_hint(hint_msg("flat", 1.0, wall), wall, w.now), "");
  TerrainPipeline dead_network(cfg, make_terrain_rules(cfg));  // no hint ever arrives

  auto a = w, b = w;
  a.terrain = with_hint.tick(a);
  b.terrain = dead_network.tick(b);
  EXPECT_EQ(a.terrain->cls, TerrainClass::blocked);
  EXPECT_EQ(a.terrain->action, TerrainAction::kStop);
  EXPECT_LT(a.terrain->confidence, b.terrain->confidence);  // the hint only moved the confidence
  for (const auto* world : {&a, &b}) {
    const auto r = SafetyGate::filter(State::ACTIVE, false, *world, drive(0.2), GateConfig{}, moving(0.2));
    EXPECT_TRUE(r.motion.command().is_zero());
  }
}

// ---- Mock and config ----

TEST(Terrain, MockReportsTheForcedClassThenItsScript) {
  TerrainConfig cfg;
  cfg.mock_sequence = {TerrainClass::flat, TerrainClass::debris};
  cfg.mock_step_s = 1;
  auto controls = std::make_shared<MockControls>();
  auto mock = make_terrain_mock(cfg, controls);
  FakeClock clock;
  WorldSnapshot w;  // the mock needs no sensors
  w.now = clock.now();
  EXPECT_EQ(mock->assess(w).cls, TerrainClass::flat);
  clock.advance(Millis(1000));
  w.now = clock.now();
  EXPECT_EQ(mock->assess(w).cls, TerrainClass::debris);

  for (const auto cls : kTerrainClasses) {
    controls->set_terrain(to_string(cls));
    const auto a = mock->assess(w);
    EXPECT_EQ(a.cls, cls);
    EXPECT_EQ(a.safety_stop, cls == TerrainClass::step || cls == TerrainClass::gap || cls == TerrainClass::blocked);
  }
  controls->set_terrain("");
  EXPECT_EQ(mock->assess(w).cls, TerrainClass::debris);
}

TEST(Terrain, ForceSensorsCannotBeTurnedOn) {
  // The FSRs are not foot pads and their meaning is TBD: the config refuses terrain.use_force true.
  YAML::Node root = YAML::LoadFile(std::string(ROBOT_CONFIG_DIR) + "/robot.yaml");
  ASSERT_TRUE(load_config_node(root).ok);
  EXPECT_FALSE(load_config_node(root).config.terrain.use_force);
  root["terrain"]["use_force"] = true;
  const auto r = load_config_node(root);
  EXPECT_FALSE(r.ok);
  EXPECT_NE(r.error.find("terrain.use_force"), std::string::npos);
}

TEST(Terrain, ConfigKeepsCameraHintOffAndSharesTheLidarMounting) {
  for (const char* file : {"/robot.yaml", "/robot.laptop.yaml"}) {
    const auto r = load_config_file(std::string(ROBOT_CONFIG_DIR) + file);
    ASSERT_TRUE(r.ok) << r.error;
    EXPECT_FALSE(r.config.terrain.camera_hint.enabled) << file;
    EXPECT_DOUBLE_EQ(r.config.terrain.ld19.front_deg, r.config.seek.ld19_front_deg);
    EXPECT_EQ(r.config.terrain.gyro_yaw_axis, r.config.location.heading_gyro_axis);
  }
  YAML::Node root = YAML::LoadFile(std::string(ROBOT_CONFIG_DIR) + "/robot.yaml");
  root["terrain"]["lidar_single_mode"] = "down";  // ground_range_m is still 0 (TBD)
  EXPECT_FALSE(load_config_node(root).ok);
}

TEST(Terrain, StopIsImportantOtherTerrainIsTelemetry) {
  MessageBuilder b("dog1");
  TerrainFields t;
  t.terrain_class = "blocked";
  t.action = "stop";
  EXPECT_TRUE(is_important_message(b.terrain(t)));
  t.terrain_class = "debris";
  t.action = "slow";
  EXPECT_FALSE(is_important_message(b.terrain(t)));
}

// ---- Frame for the camera model ----

TEST(Terrain, FrameWriterWritesAJpegAtomicallyWithTheCaptureTime) {
  char dir[] = "/tmp/terrain_test_XXXXXX";
  ASSERT_NE(mkdtemp(dir), nullptr);
  TerrainFrameConfig cfg{std::string(dir) + "/terrain_hint.jpg"};
  Frame f;
  f.width = 640;
  f.height = 480;
  f.stride = 640;
  f.format = Frame::Format::Gray8;
  f.pixels = std::make_shared<const std::vector<std::uint8_t>>(640 * 480, 128);
  const auto captured = system_clock::time_point(std::chrono::seconds(1800000000)) + std::chrono::milliseconds(250);
  ASSERT_EQ(write_terrain_frame(f, cfg, captured), "");

  std::ifstream in(cfg.path, std::ios::binary);
  unsigned char magic[2] = {0, 0};
  in.read(reinterpret_cast<char*>(magic), 2);
  EXPECT_EQ(magic[0], 0xFF);  // JPEG start of image
  EXPECT_EQ(magic[1], 0xD8);
  struct stat st {};
  ASSERT_EQ(stat(cfg.path.c_str(), &st), 0);
#if defined(__APPLE__)
  const long long mtime_ms = st.st_mtimespec.tv_sec * 1000LL + st.st_mtimespec.tv_nsec / 1000000;
#else
  const long long mtime_ms = st.st_mtim.tv_sec * 1000LL + st.st_mtim.tv_nsec / 1000000;
#endif
  EXPECT_EQ(mtime_ms, 1800000000250LL);
  EXPECT_NE(access((cfg.path + ".tmp").c_str(), F_OK), 0);  // renamed, no half file left

  int w = 0, h = 0, ch = 0;
  downscale_frame(f, 320, &w, &h, &ch);
  EXPECT_EQ(w, 320);
  EXPECT_EQ(h, 240);
  EXPECT_EQ(ch, 1);
  std::remove(cfg.path.c_str());
  rmdir(dir);
}

}  // namespace
}  // namespace robot
