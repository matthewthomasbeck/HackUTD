#pragma once

#include "devices/status.hpp"

// ADS1115 16-bit ADC on the I2C0 sensor bus, 4 thin-film pressure sensors on AIN0–AIN3.
// Same config as the Pi's Ads1115Driver: single-shot, ±4.096 V, 128 SPS.

namespace ads1115 {

constexpr int channel_count = 4;

bool init(DevStatus& st);

// The ADDR strap on our board is flaky: the chip can drift between 0x48 (ADDR
// to GND) and 0x4B (ADDR to SCL) while running, same as the Pi driver found.
// Probes every possible address, last-known first, and switches to whichever
// answers. Returns false only if the chip is gone from all of them.
bool reacquire();
uint8_t address();

// Blocking single-shot read of one channel (~8 ms). Returns volts.
bool read_channel(int channel, float& volts);

// Non-blocking version for streaming: start a conversion, check back later.
bool start_conversion(int channel);
// true once the conversion started by start_conversion() has finished.
bool conversion_done();
bool read_result(float& volts);

} // namespace ads1115
