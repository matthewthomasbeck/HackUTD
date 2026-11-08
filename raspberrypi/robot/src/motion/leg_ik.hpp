#pragma once

// ILegIK: turns a LegRequest into servo pulse targets (docs/specs/robot.md section 12.5, task R8).
// Inverse kinematics, not reinforcement learning, and no URDF (docs/ROBOT.md).
// Leg geometry, channel map, and joint limits are TBD: ask Matthew before writing a real solver.

#include <memory>
#include <vector>

#include "core/commands.hpp"

namespace robot {

struct ServoTarget {
  int bus = 0;  // 0 = Maestro A (legs), 1 = Maestro B
  int channel = 0;
  double pulse_us = 0;
};

class ILegIK {
 public:
  virtual ~ILegIK() = default;
  // Fills `out` with one target per joint. Returns false if the request is unreachable;
  // the movement thread then keeps the current pose.
  virtual bool solve(const LegRequest& request, std::vector<ServoTarget>& out) = 0;
};

// Accepts every request and produces no targets (nothing moves).
std::shared_ptr<ILegIK> make_leg_ik_mock();

}  // namespace robot
