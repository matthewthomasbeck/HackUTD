#include "state/safety_gate.hpp"

#include <algorithm>
#include <cmath>
#include <optional>

#include "state/health.hpp"

namespace drone {

namespace {

double clamp_abs(double value, double limit) { return std::clamp(value, -limit, limit); }

// Move `from` toward `to` by at most `max_step`.
double rate_limit(double from, double to, double max_step) { return from + clamp_abs(to - from, max_step); }

bool finite(const MotionCommand& c) {
  return std::isfinite(c.vx_mps) && std::isfinite(c.vy_mps) && std::isfinite(c.wz_dps);
}

// A command far beyond the limits is a bug (NaN, wrong units), not a request to clamp.
bool beyond_reject_limit(const MotionCommand& c, const GateConfig& cfg) {
  const double lin = cfg.max_lin_mps * cfg.reject_factor;
  const double ang = cfg.max_ang_dps * cfg.reject_factor;
  return std::abs(c.vx_mps) > lin || std::abs(c.vy_mps) > lin || std::abs(c.wz_dps) > ang;
}

}  // namespace

GateResult SafetyGate::filter(State state, bool latched, const WorldSnapshot& world, const BehaviorOutput& output,
                              const GateConfig& cfg, const GateMemory& memory) {
  GateMemory mem = memory;
  std::vector<Event> raised;
  const MotionCommand& wanted = output.motion;

  // 1. Full stops, checked in order. The first one that applies zeroes all motion at once,
  //    with no acceleration ramp: stopping is always allowed to be sudden.
  //    TODO(flight): what a zero command means in the air (hover, land, return home) is an open
  //    question for the team (drone/README.md). Here it is only a zero velocity request.
  std::optional<std::string> stop;
  if (state != State::ACTIVE) {
    stop = "not_active";
  } else if (latched || world.estop_sense_asserted) {
    stop = "estop";
  } else if (auto problem = mcu_link_problem(world)) {
    stop = "mcu_link_lost";
    raised.push_back(Event(EventType::mcu_link_lost, *problem));
  } else if (auto problem = stale_sensor_problem(world)) {
    stop = "stale_sensor";
    raised.push_back(Event(EventType::stale_sensor, *problem));
  } else if (!finite(wanted) || beyond_reject_limit(wanted, cfg)) {
    stop = "out_of_limits";
    raised.push_back(Event(EventType::command_out_of_limits, "behavior asked for an impossible command"));
  }

  MotionCommand result;
  if (stop) {
    // Count it only when it changed something, so READY with a zero command is not an "intervention".
    if (!wanted.is_zero() || !raised.empty()) ++mem.interventions[*stop];
  } else {
    MotionCommand cmd = wanted;

    // 2. Clamp each axis to its limit.
    const MotionCommand before_clamp = cmd;
    cmd.vx_mps = clamp_abs(cmd.vx_mps, cfg.max_lin_mps);
    cmd.vy_mps = clamp_abs(cmd.vy_mps, cfg.max_lin_mps);
    cmd.wz_dps = clamp_abs(cmd.wz_dps, cfg.max_ang_dps);
    if (cmd.vx_mps != before_clamp.vx_mps || cmd.vy_mps != before_clamp.vy_mps || cmd.wz_dps != before_clamp.wz_dps) {
      ++mem.interventions["clamp"];
    }

    // 3. Acceleration limit: change each axis by at most accel x tick from the last sent command.
    const MotionCommand before_ramp = cmd;
    const double dv = cfg.max_lin_accel * cfg.tick_s;
    const double dw = cfg.max_ang_accel * cfg.tick_s;
    cmd.vx_mps = rate_limit(mem.last_sent.vx_mps, cmd.vx_mps, dv);
    cmd.vy_mps = rate_limit(mem.last_sent.vy_mps, cmd.vy_mps, dv);
    cmd.wz_dps = rate_limit(mem.last_sent.wz_dps, cmd.wz_dps, dw);
    if (cmd.vx_mps != before_ramp.vx_mps || cmd.vy_mps != before_ramp.vy_mps || cmd.wz_dps != before_ramp.wz_dps) {
      ++mem.interventions["accel_limit"];
    }
    result = cmd;
  }
  mem.last_sent = result;

  // 4. Log interventions at most once per second (the first one right away).
  std::vector<std::string> lines;
  if (!mem.interventions.empty() && (!mem.ever_logged || ms_between(mem.last_log, world.now) >= 1000.0)) {
    std::string line = "safety gate interventions:";
    for (const auto& [name, count] : mem.interventions) line += " " + name + " x" + std::to_string(count);
    lines.push_back(line);
    mem.interventions.clear();
    mem.ever_logged = true;
    mem.last_log = world.now;
  }

  return GateResult{GatedCommand(result), raised, lines, mem};
}

}  // namespace drone
