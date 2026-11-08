#pragma once

// A behavior runs while the drone is ACTIVE. Each tick it looks at the snapshot and proposes
// a BehaviorOutput. It never touches hardware; the safety gate decides what reaches the drivers.
// The mission runner and the real mission behaviors (search_cells, inspect, return_home) are not written, as on the dog.

#include "core/commands.hpp"
#include "core/world.hpp"

namespace drone {

class IBehavior {
 public:
  virtual ~IBehavior() = default;
  virtual void start() = 0;
  virtual BehaviorOutput tick(const WorldSnapshot& world) = 0;
  virtual void cancel() = 0;
};

// Stand still until stopped or cancelled (docs/specs/robot.md section 6.6, without the timeout).
class HoldBehavior : public IBehavior {
 public:
  void start() override {}
  BehaviorOutput tick(const WorldSnapshot& world) override;
  void cancel() override {}
};

}  // namespace drone
