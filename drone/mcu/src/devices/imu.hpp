#pragma once

#include "devices/status.hpp"

// The drone's IMU, mirroring the dog's (pico/src/devices/imu.hpp, an MPU6050).
// The drone's IMU model, bus, and address are TBD, so init() reports NotFound until a driver is
// written for the confirmed part. The streaming code in main.cpp is ready for it.

namespace imu {

struct Sample {
    float ax_g = 0, ay_g = 0, az_g = 0;
    float gx_dps = 0, gy_dps = 0, gz_dps = 0;
    float temp_c = 0;
};

bool init(DevStatus& st);
bool read(Sample& out);

} // namespace imu
