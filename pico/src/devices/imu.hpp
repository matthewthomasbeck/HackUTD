#pragma once

#include "devices/status.hpp"

// MPU6050 6-axis IMU on the I2C0 sensor bus.
// Same register setup as the Pi's Mpu6050Driver: ±2 g, ±250 dps, 44 Hz DLPF, 100 Hz.

namespace imu {

struct Sample {
    float ax_g = 0, ay_g = 0, az_g = 0;
    float gx_dps = 0, gy_dps = 0, gz_dps = 0;
    float temp_c = 0;
};

bool init(DevStatus& st);
bool read(Sample& out);

} // namespace imu
