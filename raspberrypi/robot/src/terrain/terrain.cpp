#include "terrain/terrain.hpp"

#include <cmath>

namespace robot {

const char* to_string(TerrainClass c) {
  switch (c) {
    case TerrainClass::flat: return "flat";
    case TerrainClass::debris: return "debris";
    case TerrainClass::step: return "step";
    case TerrainClass::gap: return "gap";
    case TerrainClass::blocked: return "blocked";
    case TerrainClass::unknown: return "unknown";
  }
  return "unknown";
}

const char* to_string(TerrainAction a) {
  switch (a) {
    case TerrainAction::kContinue: return "continue";
    case TerrainAction::kSlow: return "slow";
    case TerrainAction::kSteer: return "steer";
    case TerrainAction::kStop: return "stop";
  }
  return "stop";
}

std::optional<TerrainClass> parse_terrain_class(const std::string& s) {
  for (const TerrainClass c : kTerrainClasses) {
    if (s == to_string(c)) return c;
  }
  return std::nullopt;
}

int caution(TerrainAction a) { return static_cast<int>(a); }

void set_action(TerrainAssessment& a, TerrainAction action, const TerrainConfig& config) {
  a.action = action;
  switch (action) {
    case TerrainAction::kContinue:
      a.speed_scale = 1.0;
      a.safety_stop = false;
      a.allow_rotation = false;
      break;
    case TerrainAction::kSlow:
      a.speed_scale = config.slow_scale;
      a.safety_stop = false;
      a.allow_rotation = false;
      break;
    case TerrainAction::kSteer:
      // Only the blocked rule steers: something is close ahead, so no translation until the
      // behavior has turned toward the clear side. Turning in place stays allowed.
      a.speed_scale = 0;
      a.safety_stop = true;
      a.allow_rotation = true;
      break;
    case TerrainAction::kStop:
      a.speed_scale = 0;
      a.safety_stop = true;
      a.allow_rotation = false;
      break;
  }
}

const TerrainAssessment& TerrainHysteresis::update(const TerrainAssessment& raw) {
  // The first result, a stop, or the class we already have: take it now. A stop is never delayed.
  if (!current_ || raw.action == TerrainAction::kStop || raw.cls == current_->cls) {
    current_ = raw;
    candidate_.reset();
    candidate_ticks_ = 0;
    return *current_;
  }
  if (candidate_ == raw.cls) {
    ++candidate_ticks_;
  } else {
    candidate_ = raw.cls;
    candidate_ticks_ = 1;
  }
  if (candidate_ticks_ >= hold_ticks_) {
    current_ = raw;
    candidate_.reset();
    candidate_ticks_ = 0;
  }
  return *current_;
}

double ld19_bearing_deg(const Ld19Scan::Point& p, const Ld19Mount& mount) {
  const double sign = mount.clockwise ? 1.0 : -1.0;
  const double raw = sign * (p.angle_cdeg / 100.0 - mount.front_deg);
  return std::fmod(raw + 540.0, 360.0) - 180.0;  // -180..180
}

bool ld19_valid(const Ld19Scan::Point& p) { return p.dist_mm >= 50 && p.intensity >= 10; }

}  // namespace robot
