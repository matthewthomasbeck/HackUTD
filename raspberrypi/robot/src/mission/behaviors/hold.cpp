#include "mission/behaviors/behavior.hpp"

namespace robot {

BehaviorOutput HoldBehavior::tick(const WorldSnapshot&) {
  return BehaviorOutput{};  // zero motion, never done
}

}  // namespace robot
