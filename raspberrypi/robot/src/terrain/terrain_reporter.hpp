#pragma once

// Decides when the robot's terrain goes to the bridge (docs/specs/robot.md section 7b.6).
// The assessor runs every tick; this is what keeps the bridge from getting a message every tick.
//
// - A class or action change is sent, but at most terrain.report_max_hz. A change that comes too
//   soon waits, and the newest result goes out when the window opens, so the last state always arrives.
// - While moving, the current result is resent every terrain.report_keepalive_s.
// - While still, only changes are sent.
//
// Example trace at 1 Hz: flat at t = 0 s (sent), debris at 0.3 s (waits), blocked stop at 0.6 s
// (replaces the waiting debris), and at 1.0 s blocked stop is sent. Debris is never sent.

#include <optional>

#include "core/clock.hpp"
#include "terrain/terrain.hpp"

namespace robot {

class TerrainReporter {
 public:
  explicit TerrainReporter(const TerrainConfig& config) : cfg_(config) {}
  // Returns the assessment to send this tick, if any.
  std::optional<TerrainAssessment> update(const TerrainAssessment& current, bool moving, SteadyTime now);
  // A new bridge connection: send the current result again on the next update.
  void resend() { force_ = true; }

 private:
  TerrainConfig cfg_;
  std::optional<TerrainAssessment> last_sent_;
  SteadyTime last_sent_at_{};
  bool force_ = false;
};

}  // namespace robot
