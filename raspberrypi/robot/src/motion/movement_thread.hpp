#pragma once

// The movement thread: the only code that writes to the actuators (both Maestros and both DC
// drivers), so the main thread never waits on a UART and each port has exactly one writer.
//
// Main thread -> movement thread: submit() a MovementCommand. It holds a GatedCommand, which only
// the safety gate can create, so nothing reaches the motors without passing the gate.
// Movement thread -> main thread: status(), read every tick.
//
// Dead-man rule: if the newest command is older than command_timeout_ms (the main loop hung or
// died), the thread stops the wheels on its own and applies safe_stop.servo_action.

#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>

#include "core/latest_slot.hpp"
#include "core/worker.hpp"
#include "hal/dc_driver.hpp"
#include "hal/servo_bus.hpp"
#include "motion/leg_ik.hpp"
#include "motion/mecanum.hpp"
#include "state/safety_gate.hpp"

namespace robot {

struct MovementCommand {
  std::uint64_t seq = 0;  // increases every main tick
  GatedCommand motion;
};

struct MovementStatus {
  std::uint64_t applied_seq = 0;  // last command applied
  bool stopped = true;            // the last applied command was zero (or the dead-man stopped us)
  bool deadman = false;           // no fresh command: wheels stopped by the dead-man rule
};

struct MovementConfig {
  double rate_hz = 100;             // movement.rate_hz, TBD
  double command_timeout_ms = 100;  // movement.command_timeout_ms, TBD: several main ticks
  bool release_servos_on_stop = false;  // safe_stop.servo_action == release
  MecanumConfig mecanum;
  double servo_max_rate_us_per_s = 0;   // servos.max_rate_us_per_s; 0 = jump straight to the target
};

struct Actuators {
  std::shared_ptr<IDcDriver> dc_a;      // motors 1 and 2
  std::shared_ptr<IDcDriver> dc_b;      // motors 3 and 4
  std::shared_ptr<IServoBus> maestro_a;  // 12 leg servos
  std::shared_ptr<IServoBus> maestro_b;  // 25 kg servos, use TBD
  std::shared_ptr<ILegIK> leg_ik;
};

class MovementThread : public Worker {
 public:
  MovementThread(Actuators actuators, MovementConfig config);
  ~MovementThread() override;

  // Main thread side. Never blocks beyond one short lock.
  void submit(const MovementCommand& command, SteadyTime now) { commands_.write(command, now); }
  std::optional<MovementStatus> status() const;

 protected:
  void step(SteadyTime now) override;
  void on_stop() override;

 private:
  void drive(const MotionCommand& command);
  void stop_wheels();
  void apply_legs(const LegRequest& request);
  void advance_servos();
  void stop_servos();

  Actuators act_;
  MovementConfig config_;
  LatestSlot<MovementCommand> commands_;
  LatestSlot<MovementStatus> status_;
  bool was_deadman_ = true;  // stopped until the first command arrives
  // Leg servos, keyed by (bus, channel): where each is heading and where it was last sent.
  std::map<std::pair<int, int>, double> servo_goal_;
  std::map<std::pair<int, int>, double> servo_now_;
};

}  // namespace robot
