#include "terrain/terrain_hint.hpp"

#include <algorithm>
#include <cstdio>

namespace robot {

std::string TerrainHintSlot::offer(const TerrainHintMsg& msg, std::chrono::system_clock::time_point wall_now,
                                   SteadyTime steady_now, double max_age_ms) {
  const auto cls = parse_terrain_class(msg.terrain_class);
  if (!cls) return "unknown terrain_class '" + msg.terrain_class + "'";
  if (!(msg.confidence >= 0 && msg.confidence <= 1)) return "confidence outside 0 to 1";
  const auto wall = parse_iso8601_utc(msg.observed_at);
  if (!wall) return "observed_at '" + msg.observed_at + "' is not ISO 8601 UTC";
  const double age_ms = std::chrono::duration<double, std::milli>(wall_now - *wall).count();
  // The frame was saved by this robot's own clock, so a time in the future means a broken clock or message.
  if (age_ms < -max_age_ms) return "observed_at is in the future";
  TerrainHint hint;
  hint.cls = *cls;
  hint.confidence = msg.confidence;
  hint.observed = steady_now - std::chrono::duration_cast<SteadyTime::duration>(
                                   std::chrono::duration<double, std::milli>(std::max(0.0, age_ms)));
  hint.observed_at = msg.observed_at;
  // A late answer for an older frame never replaces the answer for a newer one.
  if (latest_ && hint.observed < latest_->observed) return "older than the hint already held";
  latest_ = hint;
  return "";
}

std::optional<TerrainHint> TerrainHintSlot::fresh(SteadyTime now, double max_age_ms) const {
  if (!latest_ || ms_between(latest_->observed, now) > max_age_ms) return std::nullopt;
  return latest_;
}

TerrainAssessment apply_hint(const TerrainAssessment& rules, const std::optional<TerrainHint>& hint,
                             const TerrainConfig& config) {
  // "unknown" or confidence 0 is how the service says it has no advice (terrain_hint_enabled false).
  if (!hint || hint->cls == TerrainClass::unknown || hint->confidence <= 0) return rules;
  TerrainAssessment out = rules;
  const double delta = config.camera_hint.weight * hint->confidence;
  out.confidence = std::clamp(rules.confidence + (hint->cls == rules.cls ? delta : -delta), 0.0, 1.0);
  const bool hazard = hint->cls != TerrainClass::flat;
  if (rules.cls == TerrainClass::flat && rules.action == TerrainAction::kContinue && hazard) {
    set_action(out, TerrainAction::kSlow, config);  // more cautious, and the only change it may make
  }
  char buf[64];
  std::snprintf(buf, sizeof(buf), "; camera: %s %.2f", to_string(hint->cls), hint->confidence);
  out.reason += buf;
  out.source = rules.source + "+camera_model";
  return out;
}

}  // namespace robot
