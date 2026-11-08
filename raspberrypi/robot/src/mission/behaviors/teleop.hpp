#pragma once

// TeleopBehavior: a person drives the robot remotely (mission kind "teleop").
// Commands arrive from the website (SpacetimeDB -> bridge -> {"type":"teleop",...}, PROPOSED in
// docs/specs/robot.md section 9.4) or from `robotctl drive` / `robotctl teleop` on the Pi, and all
// land in one TeleopInput slot. Each tick the behavior proposes the newest command, or zero motion
// once no command has arrived for deadman_ms (closed tab, dropped Wi-Fi, crashed bridge).
// It never ends on its own; `stop`, a cancel, or any fault ends it. The safety gate still applies
// its speed and acceleration limits, so the website can ask for at most limits.max_lin_mps.

#include <cstdint>
#include <memory>
#include <string>

#include "core/latest_slot.hpp"
#include "mission/behaviors/behavior.hpp"

namespace robot {

struct TeleopCommand {
  double vx_mps = 0;   // + forward
  double vy_mps = 0;   // + left (mecanum strafe)
  double wz_dps = 0;   // + counterclockwise (turn left)
  std::uint64_t seq = 0;
  std::string source;  // "web" or "robotctl", for the log
};

using TeleopInput = LatestSlot<TeleopCommand>;

class TeleopBehavior : public IBehavior {
 public:
  TeleopBehavior(std::shared_ptr<const TeleopInput> input, double deadman_ms)
      : input_(std::move(input)), deadman_ms_(deadman_ms) {}

  void start() override { holding_ = true; }
  BehaviorOutput tick(const WorldSnapshot& world) override;
  void cancel() override {}

  bool holding() const { return holding_; }  // true while the dead-man has it stopped

 private:
  std::shared_ptr<const TeleopInput> input_;
  double deadman_ms_;
  bool holding_ = true;
};

}  // namespace robot
