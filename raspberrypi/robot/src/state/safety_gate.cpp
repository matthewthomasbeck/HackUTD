#include "state/safety_gate.hpp"

#include <algorithm>
#include <cmath>
#include <optional>

#include "state/health.hpp"

namespace robot {

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
  std::optional<std::string> stop;
  if (state != State::ACTIVE) {
    stop = "not_active";
  } else if (latched || world.estop_sense_asserted) {
    stop = "estop";
  } else if (auto problem = pico_link_problem(world)) {
    stop = "pico_link_lost";
    raised.push_back(Event(EventType::pico_link_lost, *problem));
  } else if (auto problem = stale_sensor_problem(world)) {
    stop = "stale_sensor";
    raised.push_back(Event(EventType::stale_sensor, *problem));
  } else if (world.clip_recording) {
    stop = "clip_recording";  // the breathing clip needs a still camera
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

    // 2. Terrain (task R7 fills world.terrain): a stop zeroes translation, slow caps the speed.
    double lin_limit = cfg.max_lin_mps;
    if (world.terrain == TerrainAction::Stop && (cmd.vx_mps != 0 || cmd.vy_mps != 0)) {
      cmd.vx_mps = 0;
      cmd.vy_mps = 0;
      ++mem.interventions["terrain_stop"];
    } else if (world.terrain == TerrainAction::Slow) {
      lin_limit *= cfg.terrain_slow_scale;
    }

    // Legs (docs/specs/robot.md section 12.5): while a leg is lifted, translation is zero,
    // because a mecanum wheel in the air changes the drive kinematics. Reachability and servo
    // limits are checked by the IK, which rejects (never clamps) a bad goal.
    if (cmd.legs.move == LegRequest::Move::Lift) mem.leg_lifted = true;
    if (cmd.legs.move == LegRequest::Move::Stance) mem.leg_lifted = false;
    if (mem.leg_lifted && (cmd.vx_mps != 0 || cmd.vy_mps != 0)) {
      cmd.vx_mps = 0;
      cmd.vy_mps = 0;
      ++mem.interventions["leg_lifted"];
    }

    // 3. Clamp each axis to its limit.
    const MotionCommand before_clamp = cmd;
    cmd.vx_mps = clamp_abs(cmd.vx_mps, lin_limit);
    cmd.vy_mps = clamp_abs(cmd.vy_mps, lin_limit);
    cmd.wz_dps = clamp_abs(cmd.wz_dps, cfg.max_ang_dps);
    if (cmd.vx_mps != before_clamp.vx_mps || cmd.vy_mps != before_clamp.vy_mps || cmd.wz_dps != before_clamp.wz_dps) {
      ++mem.interventions["clamp"];
    }

    // 4. Acceleration limit: change each axis by at most accel x tick from the last sent command.
    //    A terrain stop is a stop, so translation drops to zero at once instead of ramping.
    const MotionCommand before_ramp = cmd;
    const double dv = cfg.max_lin_accel * cfg.tick_s;
    const double dw = cfg.max_ang_accel * cfg.tick_s;
    if (world.terrain != TerrainAction::Stop && !mem.leg_lifted) {
      cmd.vx_mps = rate_limit(mem.last_sent.vx_mps, cmd.vx_mps, dv);
      cmd.vy_mps = rate_limit(mem.last_sent.vy_mps, cmd.vy_mps, dv);
    }
    cmd.wz_dps = rate_limit(mem.last_sent.wz_dps, cmd.wz_dps, dw);
    if (cmd.vx_mps != before_ramp.vx_mps || cmd.vy_mps != before_ramp.vy_mps || cmd.wz_dps != before_ramp.wz_dps) {
      ++mem.interventions["accel_limit"];
    }
    result = cmd;
  }
  mem.last_sent = result;

  // 5. Log interventions at most once per second (the first one right away).
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

}  // namespace robot
