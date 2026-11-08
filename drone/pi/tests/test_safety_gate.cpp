// Safety gate tests (the drone's copy of the dog's tests/test_safety_gate.cpp, minus the clip,
// terrain, and leg rules the drone does not have).

#include <cmath>
#include <limits>

#include <gtest/gtest.h>

#include "core/clock.hpp"
#include "state/safety_gate.hpp"

namespace drone {
namespace {

const GateConfig kGate{};  // 0.2 m/s, 45 deg/s, 0.5 m/s^2, 90 deg/s^2, reject x5, 50 Hz

DeviceView device(const std::string& name, bool required) {
  DeviceView d;
  d.name = name;
  d.required = required;
  d.initialized = true;
  d.status = DeviceStatus::OK;
  return d;
}

WorldSnapshot healthy_world() {
  WorldSnapshot w;
  w.devices.push_back(device("mcu", true));
  DeviceView imu = device("imu", true);
  imu.age_ms = 100;
  imu.stale_ms = 2000;
  w.devices.push_back(imu);
  w.init_complete = true;
  w.mcu_heartbeat_age_ms = 10;
  w.mcu_link_timeout_ms = 250;
  return w;
}

MotionCommand mc(double vx, double vy, double wz) {
  MotionCommand c;
  c.vx_mps = vx;
  c.vy_mps = vy;
  c.wz_dps = wz;
  return c;
}

BehaviorOutput drive(double vx, double vy = 0, double wz = 0) {
  BehaviorOutput out;
  out.motion = mc(vx, vy, wz);
  return out;
}

// Memory that already sends `cmd`, so the acceleration limit does not hide the rule under test.
GateMemory already_moving(const MotionCommand& cmd) {
  GateMemory m;
  m.last_sent = cmd;
  return m;
}

bool raised(const GateResult& r, EventType type) {
  for (const auto& e : r.raised) {
    if (e.type == type) return true;
  }
  return false;
}

TEST(SafetyGate, PassesASafeCommandInActive) {
  const auto r = SafetyGate::filter(State::ACTIVE, false, healthy_world(), drive(0.1, 0, 10), kGate,
                                    already_moving(mc(0.1, 0, 10)));
  EXPECT_DOUBLE_EQ(r.motion.command().vx_mps, 0.1);
  EXPECT_DOUBLE_EQ(r.motion.command().wz_dps, 10);
  EXPECT_TRUE(r.raised.empty());
}

TEST(SafetyGate, ZeroOutsideActive) {
  for (State s : {State::BOOT, State::INIT, State::READY, State::SAFE_STOP, State::FAULT, State::SHUTDOWN}) {
    const auto r = SafetyGate::filter(s, false, healthy_world(), drive(0.1), kGate, already_moving(mc(0.1, 0, 0)));
    EXPECT_TRUE(r.motion.command().is_zero()) << to_string(s);
  }
}

TEST(SafetyGate, ZeroOnEstop) {
  // Latched in the state machine.
  auto r = SafetyGate::filter(State::ACTIVE, true, healthy_world(), drive(0.1), kGate, already_moving(mc(0.1, 0, 0)));
  EXPECT_TRUE(r.motion.command().is_zero());
  // Or the physical sense line, before the state machine has even seen it.
  auto w = healthy_world();
  w.estop_sense_asserted = true;
  r = SafetyGate::filter(State::ACTIVE, false, w, drive(0.1), kGate, already_moving(mc(0.1, 0, 0)));
  EXPECT_TRUE(r.motion.command().is_zero());
}

TEST(SafetyGate, ZeroOnStaleRequiredSensor) {
  auto w = healthy_world();
  w.devices[1].age_ms = 2500;  // imu, limit 2000
  const auto r = SafetyGate::filter(State::ACTIVE, false, w, drive(0.1), kGate, already_moving(mc(0.1, 0, 0)));
  EXPECT_TRUE(r.motion.command().is_zero());
  EXPECT_TRUE(raised(r, EventType::stale_sensor));
}

TEST(SafetyGate, StaleOptionalSensorIsIgnored) {
  auto w = healthy_world();
  w.devices[1].required = false;
  w.devices[1].age_ms = 9999;
  const auto r = SafetyGate::filter(State::ACTIVE, false, w, drive(0.1), kGate, already_moving(mc(0.1, 0, 0)));
  EXPECT_DOUBLE_EQ(r.motion.command().vx_mps, 0.1);
}

TEST(SafetyGate, ZeroOnMcuLinkLost) {
  auto w = healthy_world();
  w.mcu_heartbeat_age_ms = 300;  // limit 250
  const auto r = SafetyGate::filter(State::ACTIVE, false, w, drive(0.1), kGate, already_moving(mc(0.1, 0, 0)));
  EXPECT_TRUE(r.motion.command().is_zero());
  EXPECT_TRUE(raised(r, EventType::mcu_link_lost));
}

TEST(SafetyGate, McuLinkLostRaisedEvenWhenStandingStill) {
  auto w = healthy_world();
  w.mcu_heartbeat_age_ms = std::nullopt;
  const auto r = SafetyGate::filter(State::ACTIVE, false, w, drive(0), kGate, GateMemory{});
  EXPECT_TRUE(raised(r, EventType::mcu_link_lost));
}

TEST(SafetyGate, ClampsSpeedAndAcceleration) {
  // From rest, ask for 0.5 m/s (over the 0.2 limit, under the 1.0 reject line).
  // Clamped to 0.2, then ramped: 0.5 m/s^2 x 0.02 s = 0.01 m/s per tick.
  GateMemory mem;
  auto r = SafetyGate::filter(State::ACTIVE, false, healthy_world(), drive(0.5), kGate, mem);
  EXPECT_NEAR(r.motion.command().vx_mps, 0.01, 1e-12);

  // Twenty ticks later it reaches the 0.2 limit and stays there.
  for (int i = 0; i < 30; ++i) {
    r = SafetyGate::filter(State::ACTIVE, false, healthy_world(), drive(0.5), kGate, r.memory);
  }
  EXPECT_NEAR(r.motion.command().vx_mps, 0.2, 1e-12);

  // Turn rate: clamped to 45 deg/s, ramped by 90 x 0.02 = 1.8 deg/s per tick.
  r = SafetyGate::filter(State::ACTIVE, false, healthy_world(), drive(0, 0, -100), kGate, GateMemory{});
  EXPECT_NEAR(r.motion.command().wz_dps, -1.8, 1e-12);
}

TEST(SafetyGate, StopIsImmediateNotRamped) {
  auto w = healthy_world();
  w.estop_sense_asserted = true;
  const auto r = SafetyGate::filter(State::ACTIVE, false, w, drive(0.2), kGate, already_moving(mc(0.2, 0.2, 45)));
  EXPECT_TRUE(r.motion.command().is_zero());
  EXPECT_TRUE(r.memory.last_sent.is_zero());
}

TEST(SafetyGate, NanOrHugeCommandRaisesOutOfLimits) {
  const double nan = std::numeric_limits<double>::quiet_NaN();
  for (const auto& out : {drive(nan), drive(0, nan), drive(0, 0, nan), drive(1.5), drive(0, -1.5), drive(0, 0, 300)}) {
    const auto r = SafetyGate::filter(State::ACTIVE, false, healthy_world(), out, kGate, GateMemory{});
    EXPECT_TRUE(r.motion.command().is_zero());
    EXPECT_TRUE(raised(r, EventType::command_out_of_limits));
  }
  // Just under the reject line (5 x 0.2 = 1.0) is clamped, not rejected.
  const auto r = SafetyGate::filter(State::ACTIVE, false, healthy_world(), drive(0.99), kGate, GateMemory{});
  EXPECT_FALSE(raised(r, EventType::command_out_of_limits));
}

TEST(SafetyGate, InterventionsLoggedOncePerSecond) {
  // 2.5 s of e-stopped ticks at 50 Hz: one line at t = 0, 1.0 s, and 2.0 s, not 125 lines.
  FakeClock clock;
  auto w = healthy_world();
  w.estop_sense_asserted = true;
  GateMemory mem;
  int lines = 0;
  for (int tick = 0; tick < 125; ++tick) {
    w.now = clock.now();
    const auto r = SafetyGate::filter(State::ACTIVE, false, w, drive(0.1), kGate, mem);
    lines += static_cast<int>(r.log_lines.size());
    mem = r.memory;
    clock.advance(Millis(20));
  }
  EXPECT_EQ(lines, 3);
}

}  // namespace
}  // namespace drone
