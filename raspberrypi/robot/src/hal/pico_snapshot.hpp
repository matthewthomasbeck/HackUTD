#pragma once

// Copies the Pico's sensor slots into a snapshot, each only while fresh (stale_ms.<sensor>).
// The main loop's observe() and `robot_diag terrain` both use it, so the diagnostic sees exactly
// what the robot's terrain rules see.

#include <map>
#include <string>

#include "core/clock.hpp"
#include "core/world.hpp"
#include "hal/pico_link.hpp"

namespace robot {

void copy_pico_sensors(const PicoReadings& readings, const std::map<std::string, int>& stale_ms, SteadyTime now,
                       WorldSnapshot& w);

}  // namespace robot
