#pragma once

// Drone MCU: timing constants (the drone's copy of pico/src/config.hpp).
//
// No pin map and no device addresses: the drone's MCU board and sensors are not confirmed
// (drone/README.md, open questions). The dog's pins and addresses (pico/src/config.hpp) are for
// the dog's wiring and must not be copied here. Add each value only once the team confirms it,
// marked with who confirmed it and when.
//
//   USB: serial link to the drone's Pi (udev name TBD; drone.yaml mcu.path)

#include <cstdint>

namespace cfg {

// ---- Link to the Pi ----
constexpr unsigned usb_wait_ms = 3000;        // wait for the Pi to open the port (the dog's value)
constexpr uint32_t heartbeat_period_ms = 50;  // HB line while streaming, 20 Hz; TBD, must match drone.yaml mcu.heartbeat_hz

// ---- Hardware watchdog ----
// The superloop feeds it once per pass (docs/ROBOT.md "Pico"). TBD: the dog firmware does not
// enable its watchdog yet, so this value has not been tested on any board.
constexpr uint32_t watchdog_ms = 500;

// ---- Sensors ----
constexpr uint32_t imu_period_ms = 20;        // 50 Hz, the dog's IMU rate; TBD for the drone's IMU
constexpr uint32_t retry_period_ms = 3000;    // re-try a missing sensor while streaming (the dog's value)

} // namespace cfg
