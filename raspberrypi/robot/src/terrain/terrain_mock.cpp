// Mock terrain assessor (terrain.impl: mock), so every class runs on a laptop with no hardware.
// `robotctl mock terrain <class>` wins; `robotctl mock terrain off` goes back to the script.

#include "core/world.hpp"
#include "hal/device_mock.hpp"
#include "terrain/terrain.hpp"

namespace robot {

namespace {

// What the rules would do for each class. A step stops because terrain.max_step_m is TBD,
// and a mock blocked has no scan to find a clear side in.
TerrainAction mock_action(TerrainClass c) {
  switch (c) {
    case TerrainClass::flat: return TerrainAction::kContinue;
    case TerrainClass::debris: return TerrainAction::kSlow;
    case TerrainClass::unknown: return TerrainAction::kSlow;
    case TerrainClass::step:
    case TerrainClass::gap:
    case TerrainClass::blocked: return TerrainAction::kStop;
  }
  return TerrainAction::kStop;
}

class MockAssessor : public ITerrainAssessor {
 public:
  MockAssessor(const TerrainConfig& config, std::shared_ptr<MockControls> controls)
      : cfg_(config), controls_(std::move(controls)) {}

  TerrainAssessment assess(const WorldSnapshot& w) override {
    if (!started_) {
      start_ = w.now;
      started_ = true;
    }
    TerrainClass cls = TerrainClass::flat;
    std::string reason = "mock default";
    const std::string forced = controls_ ? controls_->terrain() : "";
    if (const auto c = parse_terrain_class(forced)) {
      cls = *c;
      reason = "mock, set by robotctl";
    } else if (!cfg_.mock_sequence.empty() && cfg_.mock_step_s > 0) {
      const auto step = static_cast<std::size_t>(ms_between(start_, w.now) / (cfg_.mock_step_s * 1000.0));
      cls = cfg_.mock_sequence[step % cfg_.mock_sequence.size()];
      reason = "mock, terrain.mock_sequence";
    }
    TerrainAssessment a;
    a.cls = cls;
    set_action(a, mock_action(cls), cfg_);
    a.confidence = cfg_.base(cls);
    a.source = "mock";  // logs and status only; the wire always says lidar_imu_rules (main.cpp)
    a.reason = reason;
    return a;
  }

 private:
  TerrainConfig cfg_;
  std::shared_ptr<MockControls> controls_;
  bool started_ = false;
  SteadyTime start_{};
};

}  // namespace

std::unique_ptr<ITerrainAssessor> make_terrain_mock(const TerrainConfig& config, std::shared_ptr<MockControls> controls) {
  return std::make_unique<MockAssessor>(config, std::move(controls));
}

}  // namespace robot
