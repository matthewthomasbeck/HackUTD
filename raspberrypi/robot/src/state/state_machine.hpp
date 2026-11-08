#pragma once

// The robot's top-level state machine (docs/specs/robot.md section 5, docs/ROBOT.md "State machine").
//
// step() is a pure function: (current machine, snapshot, events) -> (next machine, reason, outputs).
// It does no I/O and reads no clock (time comes in the snapshot), so every transition is unit
// tested without hardware. The main loop acts on the outputs (start init, start or abort the
// mission, send rejection notes).
//
// At most one transition happens per tick. Priority when several events arrive together:
// sigterm, then estop, then the current state's own rules.

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "core/world.hpp"

namespace robot {

enum class State { BOOT, INIT, READY, ACTIVE, SAFE_STOP, FAULT, SHUTDOWN };

enum class EventType {
  config_valid,
  config_invalid,
  start,  // a mission arrived, or `robotctl start`
  stop,
  mission_done,
  mission_failed,
  mission_cancelled,
  estop,
  reset,  // only from a human, locally (robotctl or a button), never from SpacetimeDB
  stale_sensor,
  pico_link_lost,
  loop_overrun,
  command_out_of_limits,
  worker_stalled,  // the movement thread stopped stamping its heartbeat
  sigterm,
};

const char* to_string(State s);
const char* to_string(EventType e);

struct Event {
  explicit Event(EventType t, std::string what = {}) : type(t), detail(std::move(what)) {}

  EventType type;
  std::uint64_t mission_id = 0;  // for start: 0 means a local test mission from robotctl
  std::string mission_kind;      // for start
  std::string detail;            // for safety events: what went wrong
};

// Everything the state machine remembers between ticks.
struct Machine {
  State state = State::BOOT;
  bool latched = false;         // e-stop or exhausted retries; only a human reset clears it
  int fault_retries = 0;        // FAULT -> INIT attempts since the last READY or reset
  bool shutting_down = false;   // sigterm seen: SAFE_STOP, then SHUTDOWN
  SteadyTime shutdown_started{};
  std::string safe_stop_cause;  // why we are in SAFE_STOP
};

struct StateMachineConfig {
  int max_retries = 3;              // fault.max_retries
  double shutdown_timeout_ms = 2000;  // shutdown.timeout_ms
};

struct MissionRejection {
  std::uint64_t mission_id = 0;
  std::string note;  // sent as mission_progress(mission_id, "failed", note)
};

struct StepResult {
  Machine next;
  std::string reason;  // why the state changed (or why an event was ignored); empty if nothing happened

  // Outputs for the main loop to act on.
  bool begin_init = false;        // entering INIT: run device init (all devices from BOOT, failed ones from FAULT)
  bool start_mission = false;     // READY -> ACTIVE: start this mission
  Event mission{EventType::start};
  bool abort_mission = false;     // ACTIVE ended by a safety event: tell the mission runner it failed
  std::string abort_note;         // "safe stop: <reason>"
  bool alert = false;             // fault retries exhausted: send device FAILED and an alert log line
  std::vector<MissionRejection> rejected;
};

StepResult step(const Machine& current, const WorldSnapshot& world, const std::vector<Event>& events,
                const StateMachineConfig& config);

}  // namespace robot
