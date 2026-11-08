#include "mission/behaviors/teleop.hpp"

#include "core/log.hpp"

namespace drone {

BehaviorOutput TeleopBehavior::tick(const WorldSnapshot& world) {
  BehaviorOutput out;
  const auto sample = input_ ? input_->read() : std::nullopt;
  const bool fresh = sample && ms_between(sample->written, world.now) <= deadman_ms_;
  if (!fresh) {
    if (!holding_) log::warn("teleop: no command for " + std::to_string(static_cast<int>(deadman_ms_)) + " ms, stopped");
    holding_ = true;
    return out;  // zero motion
  }
  if (holding_) log::info("teleop: driving (" + sample->value.source + ")");
  holding_ = false;
  out.motion.vx_mps = sample->value.vx_mps;
  out.motion.vy_mps = sample->value.vy_mps;
  out.motion.wz_dps = sample->value.wz_dps;
  return out;
}

}  // namespace drone
