#include "state/state_machine.hpp"

#include "state/health.hpp"

namespace robot {

const char* to_string(State s) {
  switch (s) {
    case State::BOOT: return "BOOT";
    case State::INIT: return "INIT";
    case State::READY: return "READY";
    case State::ACTIVE: return "ACTIVE";
    case State::SAFE_STOP: return "SAFE_STOP";
    case State::FAULT: return "FAULT";
    case State::SHUTDOWN: return "SHUTDOWN";
  }
  return "?";
}

const char* to_string(EventType e) {
  switch (e) {
    case EventType::config_valid: return "config_valid";
    case EventType::config_invalid: return "config_invalid";
    case EventType::start: return "start";
    case EventType::stop: return "stop";
    case EventType::mission_done: return "mission_done";
    case EventType::mission_failed: return "mission_failed";
    case EventType::mission_cancelled: return "mission_cancelled";
    case EventType::estop: return "estop";
    case EventType::reset: return "reset";
    case EventType::stale_sensor: return "stale_sensor";
    case EventType::pico_link_lost: return "pico_link_lost";
    case EventType::loop_overrun: return "loop_overrun";
    case EventType::command_out_of_limits: return "command_out_of_limits";
    case EventType::worker_stalled: return "worker_stalled";
    case EventType::sigterm: return "sigterm";
  }
  return "?";
}

namespace {

const Event* find_event(const std::vector<Event>& events, EventType type) {
  for (const auto& e : events) {
    if (e.type == type) return &e;
  }
  return nullptr;
}

bool has(const std::vector<Event>& events, EventType type) { return find_event(events, type) != nullptr; }

// The ACTIVE events that send the robot to SAFE_STOP (besides the e-stop, handled for every state).
const Event* first_safety_event(const std::vector<Event>& events) {
  for (const auto& e : events) {
    switch (e.type) {
      case EventType::stale_sensor:
      case EventType::pico_link_lost:
      case EventType::loop_overrun:
      case EventType::command_out_of_limits:
      case EventType::worker_stalled:
        return &e;
      default:
        break;
    }
  }
  return nullptr;
}

std::string with_detail(const Event& e) {
  return e.detail.empty() ? std::string(to_string(e.type)) : std::string(to_string(e.type)) + " (" + e.detail + ")";
}

}  // namespace

StepResult step(const Machine& current, const WorldSnapshot& world, const std::vector<Event>& events,
                const StateMachineConfig& config) {
  StepResult r;
  r.next = current;
  Machine& next = r.next;

  // The start event this tick accepted, if any. Every other start is rejected at the end.
  const Event* accepted_start = nullptr;
  std::string not_ready_note = std::string("robot not ready: ") + to_string(current.state);

  auto go = [&](State to, std::string why) {
    next.state = to;
    r.reason = std::move(why);
  };
  // Leaving ACTIVE for SAFE_STOP fails the running mission.
  auto abort_if_active = [&](const std::string& why) {
    if (current.state == State::ACTIVE) {
      r.abort_mission = true;
      r.abort_note = "safe stop: " + why;
    }
  };

  if (current.state == State::SHUTDOWN) {
    // Final state: nothing changes.
  } else if (has(events, EventType::sigterm) && !current.shutting_down) {
    abort_if_active("shutdown");
    next.shutting_down = true;
    next.shutdown_started = world.now;
    next.safe_stop_cause = "sigterm";
    go(State::SAFE_STOP, "sigterm: stopping motion before shutdown");
  } else if (has(events, EventType::estop) && !(current.state == State::SAFE_STOP && current.latched)) {
    abort_if_active("estop");
    next.latched = true;
    next.safe_stop_cause = "estop";
    go(State::SAFE_STOP, "e-stop (latched until a human resets it)");
  } else {
    switch (current.state) {
      case State::BOOT:
        if (has(events, EventType::config_invalid)) {
          go(State::SHUTDOWN, "config invalid");
        } else if (has(events, EventType::config_valid)) {
          r.begin_init = true;
          go(State::INIT, "config valid");
        }
        break;

      case State::INIT: {
        if (!world.init_complete) break;  // devices still initializing
        // Every required device must be OK; optional ones may be DEGRADED or FAILED.
        const DeviceView* bad = nullptr;
        for (const auto& d : world.devices) {
          if (d.required && d.status != DeviceStatus::OK) {
            bad = &d;
            break;
          }
        }
        if (bad != nullptr) {
          go(State::FAULT, "required device " + bad->name + " " + to_string(bad->status) +
                               (bad->detail.empty() ? "" : ": " + bad->detail));
        } else {
          next.fault_retries = 0;
          go(State::READY, "all required devices OK");
        }
        break;
      }

      case State::READY: {
        const Event* start = find_event(events, EventType::start);
        if (start == nullptr) break;
        const Health health = assess_health(world, current.latched);
        if (health.ok) {
          accepted_start = start;
          r.start_mission = true;
          r.mission = *start;
          go(State::ACTIVE, "start mission " + std::to_string(start->mission_id) + " (" + start->mission_kind + ")");
        } else {
          not_ready_note += ", " + health.reason;
          r.reason = "start rejected: " + health.reason;
        }
        break;
      }

      case State::ACTIVE:
        if (const Event* safety = first_safety_event(events)) {
          abort_if_active(with_detail(*safety));
          next.safe_stop_cause = with_detail(*safety);
          go(State::SAFE_STOP, with_detail(*safety));
        } else if (has(events, EventType::mission_done)) {
          go(State::READY, "mission done");
        } else if (has(events, EventType::mission_failed)) {
          go(State::READY, "mission failed");
        } else if (has(events, EventType::mission_cancelled)) {
          go(State::READY, "mission cancelled");
        } else if (has(events, EventType::stop)) {
          go(State::READY, "stop command");
        }
        not_ready_note += ", mission already running";
        break;

      case State::SAFE_STOP:
        if (current.shutting_down) {
          if (world.motion_stopped) {
            go(State::SHUTDOWN, "motion stopped");
          } else if (ms_between(current.shutdown_started, world.now) >= config.shutdown_timeout_ms) {
            go(State::SHUTDOWN, "shutdown timeout, motion stop not confirmed");
          }
        } else if (current.latched) {
          // An e-stop in the same tick as the reset wins: stay latched.
          if (has(events, EventType::reset) && !has(events, EventType::estop)) {
            if (world.estop_sense_asserted) {
              r.reason = "reset ignored: e-stop still pressed";
            } else {
              next.latched = false;
              next.fault_retries = 0;
              go(State::FAULT, "reset by operator");
            }
          }
        } else if (world.motion_stopped) {
          // Every unlatched cause (stale sensor, link lost, overrun, bad command) is recoverable.
          go(State::FAULT, "motion stopped after " + current.safe_stop_cause);
        }
        break;

      case State::FAULT:
        if (current.fault_retries < config.max_retries) {
          next.fault_retries = current.fault_retries + 1;
          r.begin_init = true;
          go(State::INIT, "retry " + std::to_string(next.fault_retries) + " of " +
                              std::to_string(config.max_retries));
        } else {
          next.latched = true;
          next.safe_stop_cause = "fault retries exhausted";
          r.alert = true;
          go(State::SAFE_STOP, "fault retries exhausted (" + std::to_string(config.max_retries) + "), latched");
        }
        break;

      case State::SHUTDOWN:
        break;
    }
  }

  for (const auto& e : events) {
    if (e.type == EventType::start && &e != accepted_start) {
      r.rejected.push_back({e.mission_id, not_ready_note});
    }
  }
  return r;
}

}  // namespace robot
