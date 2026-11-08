#pragma once

#include <cstdint>

#include "devices/status.hpp"

// Benewake TF-Luna single-point lidar on UART0 @ 115200, streaming 9-byte frames at 100 Hz:
//   59 59 Dist_L Dist_H Strength_L Strength_H Temp_L Temp_H Checksum

namespace tfluna {

struct Sample {
    uint16_t dist_cm = 0;
    uint16_t strength = 0; // < 100 or 65535 means the reading is unreliable
    float temp_c = 0;
};

bool init(DevStatus& st);

// Parses everything buffered so far. Returns true if at least one new frame arrived.
bool poll(Sample& latest);

uint32_t frames_ok();
uint32_t frames_bad();
uint32_t overflows();

} // namespace tfluna
