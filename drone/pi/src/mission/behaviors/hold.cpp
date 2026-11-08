#include "mission/behaviors/behavior.hpp"

namespace drone {

BehaviorOutput HoldBehavior::tick(const WorldSnapshot&) {
  return BehaviorOutput{};  // zero motion, never done
}

}  // namespace drone
