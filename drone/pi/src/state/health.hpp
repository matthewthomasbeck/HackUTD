#pragma once

// Health checks shared by the state machine (may READY start a mission?) and the safety gate
// (must ACTIVE stop?). Pure functions of the snapshot.

#include <optional>
#include <string>

#include "core/world.hpp"

namespace drone {

// "Health OK" from docs/specs/robot.md section 5: every required device OK, MCU heartbeat
// fresh, no stale required sensor, not latched.
struct Health {
  bool ok = true;
  std::string reason;  // why not, for logs and mission rejection notes
};

Health assess_health(const WorldSnapshot& world, bool latched);

// The MCU heartbeat is only checked when the MCU is a required device.
// Returns a reason if the link counts as lost.
std::optional<std::string> mcu_link_problem(const WorldSnapshot& world);

// Returns a reason if any required device with a staleness rule has old or no data.
std::optional<std::string> stale_sensor_problem(const WorldSnapshot& world);

}  // namespace drone
