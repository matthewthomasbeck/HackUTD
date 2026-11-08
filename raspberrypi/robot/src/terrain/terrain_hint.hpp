#pragma once

// The optional camera terrain hint (docs/specs/robot.md section 7b.5), off by default
// (terrain.camera_hint.enabled: false).
//
// The bridge forwards the perception service's answer for a saved frame as a terrain_hint
// message. TerrainHintSlot keeps only the newest one, and only if it is not older than the one it
// has. apply_hint() then uses it, if it is fresh, to move the confidence and, for flat ground the
// camera calls a hazard, to slow down. It never clears a safety stop, never turns a stop into
// anything else, never raises speed, and never changes the rule class.
//
// Example trace: the rules say blocked, stop (no clear side), confidence 0.8. A fresh hint says
// flat 0.9 with weight 0.3: it disagrees, so the confidence drops to 0.8 - 0.27 = 0.53. The class
// stays blocked, the action stays stop, safety_stop stays true, and the gate still zeroes translation.

#include <chrono>
#include <optional>
#include <string>

#include "bridge/messages.hpp"
#include "core/clock.hpp"
#include "terrain/terrain.hpp"

namespace robot {

struct TerrainHint {
  TerrainClass cls = TerrainClass::unknown;
  double confidence = 0;
  SteadyTime observed{};    // when the frame was saved, on this robot's steady clock
  std::string observed_at;  // the original ISO time, unchanged, for logs
};

class TerrainHintSlot {
 public:
  // Takes a bridge message. Returns why it was dropped (for a log line), or empty if kept.
  // wall_now and steady_now are read together, to turn observed_at into steady time.
  std::string offer(const TerrainHintMsg& msg, std::chrono::system_clock::time_point wall_now, SteadyTime steady_now,
                    double max_age_ms);
  // The newest hint if it is at most max_age_ms old at `now`.
  std::optional<TerrainHint> fresh(SteadyTime now, double max_age_ms) const;
  void clear() { latest_.reset(); }

 private:
  std::optional<TerrainHint> latest_;
};

// Step 3 of the terrain pipeline. Pure: the result depends only on its arguments.
TerrainAssessment apply_hint(const TerrainAssessment& rules, const std::optional<TerrainHint>& hint,
                             const TerrainConfig& config);

}  // namespace robot
