#pragma once

// The safety gate (docs/specs/robot.md section 10.1, unchanged for the drone): the only path from a
// behavior's proposed command to the flight output. It is a pure function of (state, snapshot,
// behavior output, memory).
//
// The flight thread takes a GatedCommand, and only SafetyGate can construct one, so a behavior's
// MotionCommand cannot reach the flight output without passing through filter(). The compiler
// enforces it.

#include <map>
#include <string>
#include <vector>

#include "core/commands.hpp"
#include "core/world.hpp"
#include "state/state_machine.hpp"

namespace drone {

class SafetyGate;

class GatedCommand {
 public:
  const MotionCommand& command() const { return command_; }

 private:
  friend class SafetyGate;
  explicit GatedCommand(const MotionCommand& command) : command_(command) {}
  MotionCommand command_;
};

// Every limit is TBD for the drone (drone.yaml limits.*); the defaults here only match the dog's.
struct GateConfig {
  double max_lin_mps = 0.2;    // limits.max_lin_mps
  double max_ang_dps = 45;     // limits.max_ang_dps
  double max_lin_accel = 0.5;  // limits.max_lin_accel
  double max_ang_accel = 90;   // limits.max_ang_accel
  double reject_factor = 5;    // limits.reject_factor
  double tick_s = 0.02;        // 1 / loop.rate_hz, used for the acceleration limit
};

// What the gate remembers between ticks: the last command sent (for the acceleration limit)
// and intervention counts (logged at most once per second, never every tick).
struct GateMemory {
  MotionCommand last_sent;
  std::map<std::string, int> interventions;
  bool ever_logged = false;
  SteadyTime last_log{};
};

struct GateResult {
  GatedCommand motion;
  std::vector<Event> raised;           // safety events for the state machine's next step
  std::vector<std::string> log_lines;  // at most one per second
  GateMemory memory;
};

class SafetyGate {
 public:
  static GateResult filter(State state, bool latched, const WorldSnapshot& world, const BehaviorOutput& output,
                           const GateConfig& config, const GateMemory& memory);
};

}  // namespace drone
