#include "terrain/terrain_reporter.hpp"

namespace robot {

std::optional<TerrainAssessment> TerrainReporter::update(const TerrainAssessment& current, bool moving, SteadyTime now) {
  const bool changed = !last_sent_ || last_sent_->cls != current.cls || last_sent_->action != current.action;
  const double since_ms = last_sent_ ? ms_between(last_sent_at_, now) : 0;
  const bool window_open = !last_sent_ || cfg_.report_max_hz <= 0 || since_ms >= 1000.0 / cfg_.report_max_hz;
  const bool keepalive = moving && last_sent_ && cfg_.report_keepalive_s > 0 && since_ms >= cfg_.report_keepalive_s * 1000.0;
  if (!window_open || !(changed || keepalive || force_)) return std::nullopt;
  last_sent_ = current;
  last_sent_at_ = now;
  force_ = false;
  return current;
}

}  // namespace robot
