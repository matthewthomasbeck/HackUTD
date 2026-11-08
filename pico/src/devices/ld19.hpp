#pragma once

#include <cstdint>

#include "devices/status.hpp"

// LDRobot LD19 360° lidar on UART1 @ 230400 (receive only).
// 47-byte packets: 54 2C speed(2) start_angle(2) 12x[dist(2) intensity(1)]
//                  end_angle(2) timestamp(2) crc8
// All multi-byte fields little-endian; angles in 0.01°, distance in mm.

namespace ld19 {

constexpr int points_per_packet = 12;

struct Packet {
    float speed_dps = 0;   // rotation speed, ~3600 deg/s = 10 Hz
    float start_deg = 0;
    float end_deg = 0;
    uint16_t dist_mm[points_per_packet]{};
    uint8_t intensity[points_per_packet]{};
};

bool init(DevStatus& st);

// Parses everything buffered so far. Returns true if at least one new packet arrived.
bool poll(Packet& latest);

// Called with every good raw 47-byte packet as it is parsed (nullptr = off).
// main.cpp uses it to forward the whole scan to the Pi while streaming;
// poll() alone only keeps the newest packet.
using RawHandler = void (*)(const uint8_t* raw47);
void set_raw_handler(RawHandler fn);

uint32_t packets_ok();
uint32_t packets_bad();
uint32_t overflows();

} // namespace ld19
