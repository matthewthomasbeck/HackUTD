#include "terrain/terrain_pipeline.hpp"

#include "core/world.hpp"

namespace robot {

TerrainPipeline::TerrainPipeline(const TerrainConfig& config, std::unique_ptr<ITerrainAssessor> assessor)
    : cfg_(config), assessor_(std::move(assessor)), hysteresis_(config.hold_ticks) {}

TerrainAssessment TerrainPipeline::tick(const WorldSnapshot& world) {
  raw_ = assessor_->assess(world);
  const TerrainAssessment& held = hysteresis_.update(*raw_);
  return apply_hint(held, fresh_hint(world.now), cfg_);
}

std::string TerrainPipeline::offer_hint(const TerrainHintMsg& msg, std::chrono::system_clock::time_point wall_now,
                                        SteadyTime steady_now) {
  if (!cfg_.camera_hint.enabled) return "terrain.camera_hint.enabled is false";
  return hints_.offer(msg, wall_now, steady_now, cfg_.camera_hint.max_age_ms);
}

std::optional<TerrainHint> TerrainPipeline::fresh_hint(SteadyTime now) const {
  if (!cfg_.camera_hint.enabled) return std::nullopt;
  return hints_.fresh(now, cfg_.camera_hint.max_age_ms);
}

}  // namespace robot
