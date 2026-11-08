#pragma once

#include <cstdint>

#include "devices/status.hpp"

// MLX90640 32x24 thermal camera on its own I2C1 bus (GP14 SDA, GP15 SCL).
// Uses the same Melexis API as the Pi (src/hardware/mlx90640/MLX90640_API.cpp)
// with a Pico I2C backend in mlx90640_pico_i2c.cpp.
//
// After init, capture runs on the RP2040's second core (core 1): it waits for
// each subpage, converts it to °C and publishes the whole frame. Core 0 never
// blocks on the camera; it just copies the latest frame with latest().

namespace thermal {

constexpr int width = 32;
constexpr int height = 24;
constexpr int pixel_count = width * height;

bool init(DevStatus& st);

// Start / stop the core-1 capture loop. start() does nothing unless init() succeeded.
void start_background();
void stop_background();

// Counters from the core-1 capture loop, for diagnosing a camera that set up
// fine but stops delivering frames.
struct Core1Stats {
    bool running = false;
    uint32_t frames = 0;    // subpages read and published
    uint32_t fails = 0;     // GetFrameData errors
    uint32_t recovers = 0;  // bus recoveries after 5 errors in a row
    int last_error = 0;     // last GetFrameData return code
};
Core1Stats core1_stats();

// Copies the newest frame if it is newer than `seen_seq`. Returns true and
// updates seen_seq when it copied one.
bool latest(float* out_c, float& ta_c, float& t_min, float& t_max, uint32_t& seen_seq);

} // namespace thermal
