#pragma once

// One tick of terrain (docs/specs/robot.md section 7b): assessor, then hysteresis, then the
// camera hint. The main loop calls tick() right after observe() and puts the result in the
// snapshot. Nothing here waits on the network: with no hint, or the hint switched off, the rules
// work alone, so a dead bridge or perception service changes nothing on the robot.

#include <chrono>
#include <memory>
#include <optional>
#include <string>

#include "terrain/terrain.hpp"
#include "terrain/terrain_hint.hpp"

namespace robot {

class TerrainPipeline {
 public:
  TerrainPipeline(const TerrainConfig& config, std::unique_ptr<ITerrainAssessor> assessor);

  TerrainAssessment tick(const WorldSnapshot& world);
  // A terrain_hint from the bridge. Returns why it was dropped (for a log line), or empty if kept.
  std::string offer_hint(const TerrainHintMsg& msg, std::chrono::system_clock::time_point wall_now,
                         SteadyTime steady_now);

  const std::optional<TerrainAssessment>& raw() const { return raw_; }  // before hysteresis
  TerrainInputs inputs() const { return assessor_->last_inputs(); }
  std::optional<TerrainHint> fresh_hint(SteadyTime now) const;

 private:
  TerrainConfig cfg_;
  std::unique_ptr<ITerrainAssessor> assessor_;
  TerrainHysteresis hysteresis_;
  TerrainHintSlot hints_;
  std::optional<TerrainAssessment> raw_;
};

}  // namespace robot
