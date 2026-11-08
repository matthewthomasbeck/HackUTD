#include "mission/behaviors/thermal_seek.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "core/log.hpp"

namespace robot {

namespace {
double clampd(double v, double lim) { return std::max(-lim, std::min(lim, v)); }
double seconds(SteadyTime from, SteadyTime to) { return ms_between(from, to) / 1000.0; }
}  // namespace

const char* ThermalSeekBehavior::phase_name(Phase p) {
  switch (p) {
    case Phase::Scan: return "scan";
    case Phase::Turn: return "turn";
    case Phase::Approach: return "approach";
    case Phase::Arrived: return "arrived";
    case Phase::GaveUp: return "gave_up";
  }
  return "?";
}

void ThermalSeekBehavior::start() {
  started_ = false;
  tracker_.reset();
  target_.reset();
  target_distance_.reset();
}

void ThermalSeekBehavior::enter(Phase p, SteadyTime now, const std::string& why) {
  if (p == phase_) return;
  log::info(std::string("seek_thermal: ") + phase_name(phase_) + " -> " + phase_name(p) + ": " + why);
  phase_ = p;
  phase_since_ = now;
  blocked_logged_ = false;
}

std::optional<double> ThermalSeekBehavior::distance_to(const ThermalCandidate& c, const WorldSnapshot& world) const {
  if (world.ld19) {
    if (auto d = ld19_range_at(*world.ld19, c.bearing_deg, cfg_.ld19_window_deg, mount_)) return d;
  }
  // The TF-Luna points straight ahead, so it only measures the target once it is centered.
  if (world.range_m && std::fabs(c.bearing_deg) <= cfg_.center_deg) return world.range_m;
  return std::nullopt;
}

std::optional<ThermalCandidate> ThermalSeekBehavior::choose(const std::vector<ThermalCandidate>& found,
                                                           const WorldSnapshot& world) const {
  if (found.empty()) return std::nullopt;
  // Locked: keep the same target while it stays near where it was.
  if (target_) {
    const ThermalCandidate* same = nullptr;
    for (const auto& c : found) {
      const double drift = std::fabs(c.bearing_deg - target_->bearing_deg);
      if (drift <= cfg_.lock_deg && (!same || drift < std::fabs(same->bearing_deg - target_->bearing_deg))) same = &c;
    }
    if (same) return *same;
  }
  // New pick: the closest by the LD19, or the biggest blob when no distance is known.
  const ThermalCandidate* best = nullptr;
  std::optional<double> best_d;
  for (const auto& c : found) {
    const auto d = distance_to(c, world);
    const bool better = !best ? true
                        : (d && best_d) ? *d < *best_d
                        : d ? true
                        : best_d ? false
                        : c.area_frac > best->area_frac;
    if (better) {
      best = &c;
      best_d = d;
    }
  }
  return *best;
}

BehaviorOutput ThermalSeekBehavior::tick(const WorldSnapshot& world) {
  const SteadyTime now = world.now;
  if (!started_) {
    phase_ = Phase::Scan;
    phase_since_ = mission_since_ = now;
    started_ = true;
    log::info("seek_thermal: scanning for a warm, person-sized shape");
  }

  // New thermal frame (about 8 a second): update the tracker and the chosen target.
  if (world.thermal && world.thermal_at != last_frame_at_) {
    last_frame_at_ = world.thermal_at;
    if (auto c = choose(tracker_.update(*world.thermal), world)) {
      target_ = c;
      target_at_ = now;
    }
  }
  const bool seen = target_ && seconds(target_at_, now) <= cfg_.lost_s;
  target_distance_ = seen ? distance_to(*target_, world) : std::nullopt;

  BehaviorOutput out;
  switch (phase_) {
    case Phase::Scan: {
      if (seen) {
        char why[128];
        std::snprintf(why, sizeof(why), "target at %+.0f deg, %.1f C, confidence %.2f, %s", target_->bearing_deg,
                      target_->blob.max_c, target_->confidence,
                      target_distance_ ? (std::to_string(*target_distance_).substr(0, 4) + " m away").c_str()
                                       : "distance unknown");
        enter(Phase::Turn, now, why);
        break;
      }
      if (seconds(mission_since_, now) > cfg_.scan_max_s) {
        enter(Phase::GaveUp, now, "nothing warm found while scanning");
        break;
      }
      // Turn for scan_step_s, then hold still for scan_dwell_s so the frames are sharp.
      const double cycle = cfg_.scan_step_s + cfg_.scan_dwell_s;
      const double t = std::fmod(seconds(phase_since_, now), cycle);
      out.motion.wz_dps = t < cfg_.scan_step_s ? cfg_.scan_wz_dps : 0;
      break;
    }
    case Phase::Turn: {
      if (!seen) {
        target_.reset();
        enter(Phase::Scan, now, "lost the target");
        break;
      }
      if (std::fabs(target_->bearing_deg) <= cfg_.center_deg) {
        enter(Phase::Approach, now, "centered");
        break;
      }
      // Bearing is positive to the right; turning right is negative wz (counterclockwise positive).
      out.motion.wz_dps = clampd(-cfg_.turn_gain * target_->bearing_deg, cfg_.max_turn_dps);
      break;
    }
    case Phase::Approach: {
      if (!seen) {
        target_.reset();
        enter(Phase::Scan, now, "lost the target");
        break;
      }
      const bool range_close = target_distance_ && *target_distance_ <= cfg_.standoff_m;
      const bool blob_close = !target_distance_ && target_->area_frac >= cfg_.close_frac;
      if (range_close || blob_close) {
        char why[64];
        if (range_close) std::snprintf(why, sizeof(why), "%.2f m from the target", *target_distance_);
        else std::snprintf(why, sizeof(why), "blob fills %.0f%% of the frame", target_->area_frac * 100);
        enter(Phase::Arrived, now, why);
        break;
      }
      if (std::fabs(target_->bearing_deg) > 3 * cfg_.center_deg) {
        enter(Phase::Turn, now, "drifted off center");
        break;
      }
      if (seconds(phase_since_, now) > cfg_.approach_timeout_s) {
        enter(Phase::GaveUp, now, "approach took too long");
        break;
      }
      out.motion.wz_dps = clampd(-cfg_.turn_gain * target_->bearing_deg, cfg_.max_turn_dps);
      // Something in the way that is not the target: hold forward motion, keep steering.
      std::optional<double> ahead;
      if (world.ld19) ahead = ld19_range_at(*world.ld19, 0, cfg_.front_sector_deg / 2, mount_);
      const bool is_target = ahead && target_distance_ && std::fabs(*ahead - *target_distance_) < 0.15;
      if (ahead && *ahead < cfg_.blocked_m && !is_target) {
        if (!blocked_logged_) {
          log::warn("seek_thermal: blocked, something " + std::to_string(*ahead).substr(0, 4) + " m ahead");
          blocked_logged_ = true;
        }
        break;
      }
      blocked_logged_ = false;
      out.motion.vx_mps = cfg_.approach_mps;
      break;
    }
    case Phase::Arrived:
    case Phase::GaveUp:
      break;
  }
  if (phase_ == Phase::Arrived) out.done = true;
  if (phase_ == Phase::GaveUp) out.failed = true;
  if (out.done || out.failed) out.motion = MotionCommand{};
  return out;
}

}  // namespace robot
