// Leg IK, servo limits and rate limit, the lifted-leg gate rule, and the Maestro driver
// (docs/specs/robot.md section 12.5; test names from docs/tasks/camille.md R8).

#include <fcntl.h>
#include <unistd.h>
#if defined(__APPLE__)
#include <util.h>
#else
#include <pty.h>
#endif

#include <atomic>
#include <chrono>
#include <cmath>
#include <map>
#include <mutex>
#include <thread>
#include <vector>

#include <gtest/gtest.h>

#include "hal/servo_bus.hpp"
#include "motion/leg_ik.hpp"
#include "motion/movement_thread.hpp"
#include "state/safety_gate.hpp"

namespace robot {
namespace {

using namespace std::chrono_literals;

constexpr double kL1 = 0.110, kL2 = 0.140;

// Every joint calibrated alike: 1500 us at 0, about 424 us/rad (2000 us over 270 degrees), wide limits.
LegIkConfig calibrated_legs() {
  LegIkConfig c;
  c.l1_m = kL1;
  c.l2_m = kL2;
  c.stance_height_m = 0.20;
  c.knee_bend = 1;
  int ch = 0;
  for (auto& leg : c.joints)
    for (auto& j : leg) j = JointCal{0, ch++, 1500, 424.4, 1, 600, 2400};
  return c;
}

LegRequest stance(double h = 0) {
  LegRequest r;
  r.move = LegRequest::Move::Stance;
  r.height_m = h;
  return r;
}

TEST(LegIK, TwoLinkKnownPoseMatchesLawOfCosines) {
  // Hub straight below the hip at d = sqrt(l1^2 + l2^2): the law of cosines gives a 90 degree knee.
  const double d = std::sqrt(kL1 * kL1 + kL2 * kL2);
  const auto a = two_link_angles(0, d, kL1, kL2, 1);
  ASSERT_TRUE(a);
  EXPECT_NEAR((*a)[1], M_PI / 2, 1e-9);
  // The femur leans back by atan(l2 / l1) so the tibia brings the hub back under the hip.
  EXPECT_NEAR((*a)[0], -std::atan2(kL2, kL1), 1e-9);
}

TEST(LegIK, TwoLinkRoundTripsThroughForwardKinematics) {
  for (double x = -0.08; x <= 0.08; x += 0.02) {
    for (double z = 0.08; z <= 0.24; z += 0.02) {
      for (int bend : {1, -1}) {
        const auto a = two_link_angles(x, z, kL1, kL2, bend);
        if (!a) continue;
        const auto p = two_link_position((*a)[0], (*a)[1], kL1, kL2);
        EXPECT_NEAR(p[0], x, 1e-9) << x << "," << z;
        EXPECT_NEAR(p[1], z, 1e-9) << x << "," << z;
        EXPECT_GE((*a)[1] * bend, 0) << "knee folds the configured way";
      }
    }
  }
}

TEST(LegIK, TwoLinkUnreachableReturnsFalse) {
  EXPECT_FALSE(two_link_angles(0, kL1 + kL2 + 0.01, kL1, kL2, 1));   // past full stretch
  EXPECT_FALSE(two_link_angles(0, kL1 + kL2, kL1, kL2, 1));          // locked straight
  EXPECT_FALSE(two_link_angles(0, 0.01, kL1, kL2, 1));               // closer than fully folded
  EXPECT_FALSE(two_link_angles(0, 0.2, 0, kL2, 1));                  // no geometry yet
  auto ik = make_leg_ik_2link(calibrated_legs());
  std::vector<ServoTarget> out{ServoTarget{}};
  EXPECT_FALSE(ik->solve(stance(0.30), out));                        // 0.30 m > l1 + l2
  EXPECT_TRUE(out.empty()) << "nothing is sent for a rejected goal";
}

TEST(LegIK, StanceGivesTwelveTargetsWithinLimits) {
  auto ik = make_leg_ik_2link(calibrated_legs());
  std::vector<ServoTarget> out;
  ASSERT_TRUE(ik->solve(stance(), out));
  ASSERT_EQ(out.size(), 12u);
  for (const auto& t : out) {
    EXPECT_GE(t.pulse_us, 600);
    EXPECT_LE(t.pulse_us, 2400);
  }
  EXPECT_DOUBLE_EQ(out[0].pulse_us, 1500) << "abduction holds 0";
}

TEST(LegIK, LiftBendsOnlyThatLeg) {
  auto ik = make_leg_ik_2link(calibrated_legs());
  std::vector<ServoTarget> base, lifted;
  ASSERT_TRUE(ik->solve(stance(), base));
  LegRequest lift;
  lift.move = LegRequest::Move::Lift;
  lift.leg = 2;  // BL
  lift.height_m = 0.04;
  ASSERT_TRUE(ik->solve(lift, lifted));
  for (std::size_t i = 0; i < 12; ++i) {
    if (i / 3 == 2) continue;
    EXPECT_DOUBLE_EQ(lifted[i].pulse_us, base[i].pulse_us) << "other legs hold stance";
  }
  EXPECT_GT(lifted[2 * 3 + Knee].pulse_us, base[2 * 3 + Knee].pulse_us) << "the lifted leg's knee folds more";
}

TEST(LegIK, TwoServoLegsWithoutAbductionGiveEightTargets) {
  // The abduction servos were removed (2026-11-08): channel -1 there means "not fitted".
  LegIkConfig c = calibrated_legs();
  for (auto& leg : c.joints) leg[Abduction] = JointCal{};
  std::vector<ServoTarget> out;
  ASSERT_TRUE(make_leg_ik_2link(c)->solve(stance(), out));
  ASSERT_EQ(out.size(), 8u);
  // A missing hip or knee is still an error, not an optional joint.
  c.joints[1][Hip].channel = -1;
  EXPECT_FALSE(make_leg_ik_2link(c)->solve(stance(), out));
}

TEST(LegIK, UncalibratedJointMeansNothingMoves) {
  LegIkConfig c = calibrated_legs();
  c.joints[3][Knee].us_per_rad = 0;
  std::vector<ServoTarget> out;
  EXPECT_FALSE(make_leg_ik_2link(c)->solve(stance(), out));
  EXPECT_TRUE(out.empty());
}

TEST(LegIK, PastAServoLimitIsRejectedNotClamped) {
  LegIkConfig c = calibrated_legs();
  c.joints[0][Knee].max_us = 1550;  // FL knee may barely bend
  std::vector<ServoTarget> out;
  EXPECT_FALSE(make_leg_ik_2link(c)->solve(stance(), out));
}

TEST(LegIK, JointCalRoundTrip) {
  const JointCal cal{0, 4, 1480, 424.4, -1, 600, 2400};
  EXPECT_DOUBLE_EQ(cal.pulse_for(0), 1480);
  EXPECT_NEAR(cal.pulse_for(0.5), 1480 - 212.2, 1e-9);
  EXPECT_NEAR(cal.angle_for(cal.pulse_for(0.3)), 0.3, 1e-12);
}

// --- Safety gate ---

WorldSnapshot healthy_world() {
  WorldSnapshot w;
  DeviceView pico;
  pico.name = "pico";
  pico.required = true;
  pico.initialized = true;
  pico.status = DeviceStatus::OK;
  w.devices.push_back(pico);
  w.init_complete = true;
  w.pico_heartbeat_age_ms = 10;
  w.pico_link_timeout_ms = 250;
  return w;
}

TEST(SafetyGate, ZeroTranslationWhileLegLifted) {
  GateMemory moving;
  moving.last_sent.vx_mps = 0.1;
  BehaviorOutput out;
  out.motion.vx_mps = 0.1;
  out.motion.wz_dps = 10;
  out.motion.legs.move = LegRequest::Move::Lift;
  out.motion.legs.leg = 0;
  out.motion.legs.height_m = 0.03;
  auto r = SafetyGate::filter(State::ACTIVE, false, healthy_world(), out, GateConfig{}, moving);
  EXPECT_EQ(r.motion.command().vx_mps, 0) << "translation drops at once, no ramp";
  EXPECT_NE(r.motion.command().wz_dps, 0) << "turning in place is still allowed";
  EXPECT_TRUE(r.memory.leg_lifted);

  // Later ticks carry no leg request, but the leg is still up.
  out.motion.legs = LegRequest{};
  r = SafetyGate::filter(State::ACTIVE, false, healthy_world(), out, GateConfig{}, r.memory);
  EXPECT_EQ(r.motion.command().vx_mps, 0);

  // Back to stance: translation may ramp up again.
  out.motion.legs.move = LegRequest::Move::Stance;
  r = SafetyGate::filter(State::ACTIVE, false, healthy_world(), out, GateConfig{}, r.memory);
  EXPECT_FALSE(r.memory.leg_lifted);
  EXPECT_GT(r.motion.command().vx_mps, 0);
}

// --- Movement thread rate limit ---

class RecordingBus : public IServoBus {
 public:
  std::string name() const override { return "maestro_a"; }
  InitResult init() override { return {DeviceStatus::OK, "test"}; }
  bool ready() const override { return true; }
  bool set_target_us(int channel, double us) override {
    std::lock_guard<std::mutex> lock(mutex);
    sent[channel].push_back(us);
    return true;
  }
  bool release_all() override { return true; }
  std::vector<double> history(int channel) {
    std::lock_guard<std::mutex> lock(mutex);
    return sent[channel];
  }
  std::mutex mutex;
  std::map<int, std::vector<double>> sent;
};

class OneServoIK : public ILegIK {
 public:
  std::atomic<double> target{1500};
  bool solve(const LegRequest&, std::vector<ServoTarget>& out) override {
    out = {ServoTarget{0, 0, target.load()}};
    return true;
  }
};

TEST(SafetyGate, ServoClampedAndRateLimited) {
  // Limits are enforced by the IK (rejected above); here the movement thread must never step a
  // servo by more than max_rate / rate_hz: 1000 us/s at 100 Hz is 10 us per step.
  auto bus = std::make_shared<RecordingBus>();
  auto ik = std::make_shared<OneServoIK>();
  MovementConfig mc;
  mc.rate_hz = 100;
  mc.command_timeout_ms = 1000;
  mc.servo_max_rate_us_per_s = 1000;
  Actuators act;
  act.maestro_a = bus;
  act.leg_ik = ik;
  MovementThread movement(act, mc);
  movement.start();

  MotionCommand cmd;
  cmd.legs.move = LegRequest::Move::Stance;
  auto send = [&]() {
    WorldSnapshot w = healthy_world();
    BehaviorOutput out;
    out.motion = cmd;
    const auto gated = SafetyGate::filter(State::ACTIVE, false, w, out, GateConfig{}, GateMemory{}).motion;
    movement.submit(MovementCommand{1, gated}, std::chrono::steady_clock::now());
  };
  send();
  std::this_thread::sleep_for(50ms);
  ik->target = 2000;  // a 500 us move
  for (int i = 0; i < 10; ++i) {
    send();
    std::this_thread::sleep_for(20ms);
  }
  movement.request_stop();
  movement.join();

  const auto h = bus->history(0);
  ASSERT_GE(h.size(), 3u);
  EXPECT_DOUBLE_EQ(h.front(), 1500) << "first target is sent as is";
  for (std::size_t i = 1; i < h.size(); ++i) EXPECT_LE(std::fabs(h[i] - h[i - 1]), 10.0 + 1e-9) << i;
  EXPECT_LT(h.back(), 2000) << "200 ms at 1000 us/s cannot finish a 500 us move";
  EXPECT_GT(h.back(), 1500);
}

// --- Maestro driver against a fake Maestro on a pty ---

TEST(Maestro, InitAsksForErrorsAndTargetsUseQuarterMicroseconds) {
  int master = -1, slave = -1;
  char name[128];
  ASSERT_EQ(openpty(&master, &slave, name, nullptr, nullptr), 0);
  std::atomic<bool> quit{false};
  std::vector<unsigned char> received;
  std::mutex mu;
  std::thread fake([&] {
    while (!quit) {
      unsigned char b[64];
      const ssize_t n = ::read(master, b, sizeof(b));
      if (n > 0) {
        std::lock_guard<std::mutex> lock(mu);
        for (ssize_t i = 0; i < n; ++i) {
          received.push_back(b[i]);
          if (b[i] == 0xA1) {
            const unsigned char reply[2] = {0x00, 0x00};
            (void)!::write(master, reply, 2);
          }
        }
      }
    }
  });
  ::fcntl(master, F_SETFL, O_NONBLOCK);

  auto bus = make_servo_maestro("maestro_a", name, 9600);
  const InitResult r = bus->init();
  EXPECT_EQ(r.status, DeviceStatus::OK) << r.detail;
  ASSERT_TRUE(bus->set_target_us(5, 1500));  // 6000 quarter-us = 0x1770
  std::this_thread::sleep_for(50ms);
  quit = true;
  fake.join();
  ::close(master);
  ::close(slave);

  std::lock_guard<std::mutex> lock(mu);
  ASSERT_GE(received.size(), 6u);
  EXPECT_EQ(received[0], 0xAA);
  EXPECT_EQ(received[1], 0xA1);
  const std::vector<unsigned char> tail(received.end() - 4, received.end());
  EXPECT_EQ(tail, (std::vector<unsigned char>{0x84, 5, 6000 & 0x7F, (6000 >> 7) & 0x7F}));
}

TEST(Maestro, BaudTbdFailsWithAReason) {
  const InitResult r = make_servo_maestro("maestro_b", "/dev/null", 0)->init();
  EXPECT_EQ(r.status, DeviceStatus::FAILED);
  EXPECT_NE(r.detail.find("baud TBD"), std::string::npos);
}

}  // namespace
}  // namespace robot
