#pragma once

// Copies the MCU's sensor slots into a snapshot, each only while fresh (stale_ms.<sensor>).
// The main loop's observe() uses it, so the behaviors only ever see fresh sensor data.

#include <map>
#include <string>

#include "core/clock.hpp"
#include "core/world.hpp"
#include "hal/mcu_link.hpp"

namespace drone {

void copy_mcu_sensors(const McuReadings& readings, const std::map<std::string, int>& stale_ms, SteadyTime now,
                      WorldSnapshot& w);

}  // namespace drone
