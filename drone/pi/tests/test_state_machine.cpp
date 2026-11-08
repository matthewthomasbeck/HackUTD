// One test per row of the transition table in docs/specs/robot.md section 5, plus the latch,
// reset, retry, SIGTERM, and mission rejection tests from docs/tasks/camille.md R1 (the dog's,
// unchanged for the drone except the device names).

#include <gtest/gtest.h>

#include "core/clock.hpp"
#include "state/state_machine.hpp"

namespace drone {
namespace {

const StateMachineConfig kConfig{3, 2000};

DeviceView device(const std::string& name, bool required, DeviceStatus status = DeviceStatus::OK) {
  DeviceView d;
  d.name = name;
  d.required = required;
  d.initialized = true;
  d.status = status;
  return d;
}

// Required MCU, IMU (with fresh data), and flight output; optional camera. Everything healthy.
WorldSnapshot healthy_world() {
  WorldSnapshot w;
  w.devices.push_back(device("mcu", true));
  DeviceView imu = device("imu", true);
  imu.age_ms = 100;
  imu.stale_ms = 2000;
  w.devices.push_back(imu);
  w.devices.push_back(device("flight_output", true));
  w.devices.push_back(device("camera", false));
  w.init_complete = true;
  w.mcu_heartbeat_age_ms = 10;
  w.mcu_link_timeout_ms = 250;
  w.motion_stopped = true;
  return w;
}

Machine in(State s) {
  Machine m;
  m.state = s;
  return m;
}

Event ev(EventType t) { return Event{t}; }

// Names parameterized tests after the event, for example ActiveSafetyEvents.GoToSafeStop/estop.
std::string event_name(const ::testing::TestParamInfo<EventType>& info) { return to_string(info.param); }

Event start_event(std::uint64_t id = 7, const std::string& kind = "hold") {
  Event e{EventType::start};
  e.mission_id = id;
  e.mission_kind = kind;
  return e;
}

StepResult step1(const Machine& m, const WorldSnapshot& w, std::vector<Event> events = {}) {
  return step(m, w, events, kConfig);
}

// BOOT

TEST(StateMachine, BootConfigValidGoesToInit) {
  const auto r = step1(in(State::BOOT), healthy_world(), {ev(EventType::config_valid)});
  EXPECT_EQ(r.next.state, State::INIT);
  EXPECT_TRUE(r.begin_init);
}

TEST(StateMachine, BootConfigInvalidGoesToShutdown) {
  const auto r = step1(in(State::BOOT), healthy_world(), {ev(EventType::config_invalid)});
  EXPECT_EQ(r.next.state, State::SHUTDOWN);
}

// INIT

TEST(StateMachine, InitWaitsUntilEveryDeviceFinished) {
  auto w = healthy_world();
  w.init_complete = false;
  EXPECT_EQ(step1(in(State::INIT), w).next.state, State::INIT);
}

TEST(StateMachine, InitAllRequiredOkGoesToReady) {
  EXPECT_EQ(step1(in(State::INIT), healthy_world()).next.state, State::READY);
}

TEST(StateMachine, InitOptionalDegradedStillReady) {
  auto w = healthy_world();
  w.devices.push_back(device("gps", false, DeviceStatus::DEGRADED));
  w.devices.push_back(device("detector", false, DeviceStatus::FAILED));
  EXPECT_EQ(step1(in(State::INIT), w).next.state, State::READY);
}

TEST(StateMachine, InitRequiredFailedGoesToFault) {
  auto w = healthy_world();
  w.devices[2].status = DeviceStatus::FAILED;  // flight_output
  const auto r = step1(in(State::INIT), w);
  EXPECT_EQ(r.next.state, State::FAULT);
  EXPECT_NE(r.reason.find("flight_output"), std::string::npos);
}

TEST(StateMachine, InitRequiredDegradedGoesToFault) {
  auto w = healthy_world();
  w.devices[0].status = DeviceStatus::DEGRADED;  // mcu
  EXPECT_EQ(step1(in(State::INIT), w).next.state, State::FAULT);
}

TEST(StateMachine, ReachingReadyClearsFaultRetries) {
  Machine m = in(State::INIT);
  m.fault_retries = 2;
  EXPECT_EQ(step1(m, healthy_world()).next.fault_retries, 0);
}

// READY

TEST(StateMachine, ReadyStartWithHealthOkGoesToActive) {
  const auto r = step1(in(State::READY), healthy_world(), {start_event(7, "hold")});
  EXPECT_EQ(r.next.state, State::ACTIVE);
  EXPECT_TRUE(r.start_mission);
  EXPECT_EQ(r.mission.mission_id, 7u);
  EXPECT_EQ(r.mission.mission_kind, "hold");
  EXPECT_TRUE(r.rejected.empty());
}

TEST(StateMachine, ReadyStartWithStaleSensorStaysReady) {
  auto w = healthy_world();
  w.devices[1].age_ms = 5000;  // imu, limit 2000
  const auto r = step1(in(State::READY), w, {start_event(7)});
  EXPECT_EQ(r.next.state, State::READY);
  EXPECT_FALSE(r.start_mission);
  ASSERT_EQ(r.rejected.size(), 1u);
  EXPECT_EQ(r.rejected[0].mission_id, 7u);
  EXPECT_NE(r.rejected[0].note.find("imu"), std::string::npos);
}

TEST(StateMachine, ReadyStartWithMcuLinkLostStaysReady) {
  auto w = healthy_world();
  w.mcu_heartbeat_age_ms = 400;
  EXPECT_EQ(step1(in(State::READY), w, {start_event()}).next.state, State::READY);
}

TEST(StateMachine, ReadySecondStartInSameTickRejected) {
  const auto r = step1(in(State::READY), healthy_world(), {start_event(1), start_event(2)});
  EXPECT_EQ(r.next.state, State::ACTIVE);
  EXPECT_EQ(r.mission.mission_id, 1u);
  ASSERT_EQ(r.rejected.size(), 1u);
  EXPECT_EQ(r.rejected[0].mission_id, 2u);
}

// ACTIVE

class ActiveEndsNormally : public ::testing::TestWithParam<EventType> {};

TEST_P(ActiveEndsNormally, GoesToReady) {
  const auto r = step1(in(State::ACTIVE), healthy_world(), {ev(GetParam())});
  EXPECT_EQ(r.next.state, State::READY);
  EXPECT_FALSE(r.abort_mission);
  // Only an operator stop needs a "failed" from the main loop; the others report their own end.
  EXPECT_EQ(r.operator_stop, GetParam() == EventType::stop);
}

TEST(StateMachine, StopOutsideActiveIsNotAnOperatorStop) {
  const auto r = step1(in(State::READY), healthy_world(), {ev(EventType::stop)});
  EXPECT_EQ(r.next.state, State::READY);
  EXPECT_FALSE(r.operator_stop);
}

INSTANTIATE_TEST_SUITE_P(StateMachine, ActiveEndsNormally,
                         ::testing::Values(EventType::mission_done, EventType::mission_failed,
                                           EventType::mission_cancelled, EventType::stop),
                         event_name);

class ActiveSafetyEvents : public ::testing::TestWithParam<EventType> {};

TEST_P(ActiveSafetyEvents, GoToSafeStop) {
  const auto r = step1(in(State::ACTIVE), healthy_world(), {ev(GetParam())});
  EXPECT_EQ(r.next.state, State::SAFE_STOP);
  EXPECT_TRUE(r.abort_mission);
  EXPECT_EQ(r.abort_note.rfind("safe stop: ", 0), 0u);
  // Only the e-stop latches.
  EXPECT_EQ(r.next.latched, GetParam() == EventType::estop);
}

INSTANTIATE_TEST_SUITE_P(StateMachine, ActiveSafetyEvents,
                         ::testing::Values(EventType::estop, EventType::stale_sensor, EventType::mcu_link_lost,
                                           EventType::loop_overrun, EventType::command_out_of_limits,
                                           EventType::worker_stalled),
                         event_name);

TEST(StateMachine, ActiveSecondMissionRejected) {
  const auto r = step1(in(State::ACTIVE), healthy_world(), {start_event(9)});
  EXPECT_EQ(r.next.state, State::ACTIVE);
  ASSERT_EQ(r.rejected.size(), 1u);
  EXPECT_EQ(r.rejected[0].note.rfind("drone not ready: ACTIVE", 0), 0u);
}

TEST(StateMachine, SafetyEventsOutsideActiveAreIgnored) {
  const auto r = step1(in(State::READY), healthy_world(), {ev(EventType::stale_sensor)});
  EXPECT_EQ(r.next.state, State::READY);
}

// E-stop and reset

TEST(StateMachine, EstopFromAnyStateLatchesSafeStop) {
  for (State s : {State::BOOT, State::INIT, State::READY, State::ACTIVE, State::FAULT}) {
    const auto r = step1(in(s), healthy_world(), {ev(EventType::estop)});
    EXPECT_EQ(r.next.state, State::SAFE_STOP) << to_string(s);
    EXPECT_TRUE(r.next.latched) << to_string(s);
  }
}

TEST(StateMachine, EstopLatchSurvivesEveryEventExceptReset) {
  Machine m = in(State::SAFE_STOP);
  m.latched = true;
  m.safe_stop_cause = "estop";
  // sigterm is left out: it ends in SHUTDOWN (still latched), tested below.
  for (EventType t : {EventType::config_valid, EventType::config_invalid, EventType::start, EventType::stop,
                      EventType::mission_done, EventType::mission_failed, EventType::mission_cancelled,
                      EventType::estop, EventType::stale_sensor, EventType::mcu_link_lost,
                      EventType::loop_overrun, EventType::command_out_of_limits, EventType::worker_stalled}) {
    const auto r = step1(m, healthy_world(), {ev(t)});
    EXPECT_EQ(r.next.state, State::SAFE_STOP) << to_string(t);
    EXPECT_TRUE(r.next.latched) << to_string(t);
  }
  // Motion stopped and many ticks pass: still latched.
  Machine still = m;
  for (int i = 0; i < 100; ++i) still = step1(still, healthy_world()).next;
  EXPECT_EQ(still.state, State::SAFE_STOP);
  EXPECT_TRUE(still.latched);
}

TEST(StateMachine, ResetClearsLatchAndGoesToFault) {
  Machine m = in(State::SAFE_STOP);
  m.latched = true;
  m.fault_retries = 3;
  const auto r = step1(m, healthy_world(), {ev(EventType::reset)});
  EXPECT_EQ(r.next.state, State::FAULT);
  EXPECT_FALSE(r.next.latched);
  EXPECT_EQ(r.next.fault_retries, 0);  // a human reset gives fresh retries
}

TEST(StateMachine, ResetWhileSenseAssertedDoesNothing) {
  Machine m = in(State::SAFE_STOP);
  m.latched = true;
  auto w = healthy_world();
  w.estop_sense_asserted = true;
  const auto r = step1(m, w, {ev(EventType::reset)});
  EXPECT_EQ(r.next.state, State::SAFE_STOP);
  EXPECT_TRUE(r.next.latched);
}

TEST(StateMachine, EstopAndResetInSameTickStaysLatched) {
  Machine m = in(State::SAFE_STOP);
  m.latched = true;
  const auto r = step1(m, healthy_world(), {ev(EventType::reset), ev(EventType::estop)});
  EXPECT_EQ(r.next.state, State::SAFE_STOP);
  EXPECT_TRUE(r.next.latched);
}

// SAFE_STOP (not latched)

TEST(StateMachine, SafeStopRecoverableWaitsForMotionToStop) {
  Machine m = in(State::SAFE_STOP);
  m.safe_stop_cause = "stale_sensor";
  auto w = healthy_world();
  w.motion_stopped = false;
  EXPECT_EQ(step1(m, w).next.state, State::SAFE_STOP);
  w.motion_stopped = true;
  EXPECT_EQ(step1(m, w).next.state, State::FAULT);
}

// FAULT

TEST(StateMachine, FaultRetriesGoToInit) {
  const auto r = step1(in(State::FAULT), healthy_world());
  EXPECT_EQ(r.next.state, State::INIT);
  EXPECT_EQ(r.next.fault_retries, 1);
  EXPECT_TRUE(r.begin_init);
}

TEST(StateMachine, FaultRetriesThenLatchedSafeStop) {
  auto w = healthy_world();
  w.devices[0].status = DeviceStatus::FAILED;  // mcu never comes up
  Machine m = in(State::INIT);
  int inits = 0;
  // Loop until latched: INIT -> FAULT -> INIT ... -> SAFE_STOP latched.
  for (int tick = 0; tick < 20 && !m.latched; ++tick) {
    const auto r = step1(m, w);
    if (r.next.state == State::INIT && m.state == State::FAULT) ++inits;
    if (r.next.latched) {
      EXPECT_TRUE(r.alert);
    }
    m = r.next;
  }
  EXPECT_EQ(inits, kConfig.max_retries);
  EXPECT_EQ(m.state, State::SAFE_STOP);
  EXPECT_TRUE(m.latched);
}

// SIGTERM

TEST(StateMachine, SigtermFromEveryStateEndsInShutdown) {
  for (State s : {State::BOOT, State::INIT, State::READY, State::ACTIVE, State::SAFE_STOP, State::FAULT}) {
    for (bool latched : {false, true}) {
      Machine m = in(s);
      m.latched = latched;
      auto r = step1(m, healthy_world(), {ev(EventType::sigterm)});
      EXPECT_EQ(r.next.state, State::SAFE_STOP) << to_string(s);
      EXPECT_TRUE(r.next.shutting_down);
      r = step1(r.next, healthy_world());  // motion is stopped
      EXPECT_EQ(r.next.state, State::SHUTDOWN) << to_string(s);
    }
  }
}

TEST(StateMachine, SigtermWaitsForMotionStopUntilTimeout) {
  FakeClock clock;
  auto w = healthy_world();
  w.now = clock.now();
  w.motion_stopped = false;
  auto r = step1(in(State::ACTIVE), w, {ev(EventType::sigterm)});
  EXPECT_TRUE(r.abort_mission);
  clock.advance(Millis(1000));
  w.now = clock.now();
  r = step1(r.next, w);
  EXPECT_EQ(r.next.state, State::SAFE_STOP);
  clock.advance(Millis(1000));  // 2000 ms, the timeout
  w.now = clock.now();
  r = step1(r.next, w);
  EXPECT_EQ(r.next.state, State::SHUTDOWN);
}

TEST(StateMachine, ShutdownIsFinal) {
  const auto r = step1(in(State::SHUTDOWN), healthy_world(),
                       {ev(EventType::reset), ev(EventType::config_valid), ev(EventType::estop)});
  EXPECT_EQ(r.next.state, State::SHUTDOWN);
}

// Missions in the wrong state

TEST(StateMachine, MissionInNonReadyStateRejected) {
  for (State s : {State::BOOT, State::INIT, State::SAFE_STOP, State::FAULT, State::SHUTDOWN}) {
    const auto r = step1(in(s), healthy_world(), {start_event(42)});
    EXPECT_FALSE(r.start_mission) << to_string(s);
    ASSERT_EQ(r.rejected.size(), 1u) << to_string(s);
    EXPECT_EQ(r.rejected[0].mission_id, 42u);
    EXPECT_EQ(r.rejected[0].note, std::string("drone not ready: ") + to_string(s));
  }
}

}  // namespace
}  // namespace drone
