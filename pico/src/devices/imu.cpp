#include "devices/imu.hpp"

#include <cmath>

#include "bus/i2c_bus.hpp"
#include "config.hpp"
#include "pico/stdlib.h"

namespace imu {

static constexpr uint8_t reg_smplrt_div = 0x19;
static constexpr uint8_t reg_config = 0x1A;
static constexpr uint8_t reg_gyro_config = 0x1B;
static constexpr uint8_t reg_accel_config = 0x1C;
static constexpr uint8_t reg_accel_xout_h = 0x3B;
static constexpr uint8_t reg_pwr_mgmt_1 = 0x6B;
static constexpr uint8_t reg_who_am_i = 0x75;

static uint8_t g_addr = 0;

static bool who_am_i_ok(uint8_t id) {
    // Genuine MPU6050 = 0x68; common clones report 0x70, 0x72 or 0x98.
    return id == 0x68 || id == 0x70 || id == 0x72 || id == 0x98;
}

bool init(DevStatus& st) {
    dev_reset(st, "imu");
    g_addr = 0;

    for (uint8_t addr : cfg::imu_addrs) {
        if (i2cbus::probe(addr)) {
            g_addr = addr;
            break;
        }
    }
    if (g_addr == 0) {
        return dev_set(st, DevState::NotFound, "no ACK at 0x68/0x69");
    }
    st.addr = g_addr;

    uint8_t id = 0;
    if (!i2cbus::read_regs(g_addr, reg_who_am_i, &id, 1)) {
        return dev_set(st, DevState::Error, "WHO_AM_I read failed");
    }
    if (!who_am_i_ok(id)) {
        return dev_set(st, DevState::Error, "unexpected WHO_AM_I=0x%02X", id);
    }

    // Wake from sleep, then let the clock settle before configuring.
    if (!i2cbus::write_reg8(g_addr, reg_pwr_mgmt_1, 0x00)) {
        return dev_set(st, DevState::Error, "wake write failed");
    }
    sleep_ms(100);

    const bool cfg_ok =
        i2cbus::write_reg8(g_addr, reg_config, 0x03) &&       // DLPF 44 Hz
        i2cbus::write_reg8(g_addr, reg_smplrt_div, 0x09) &&   // 1 kHz / 10 = 100 Hz
        i2cbus::write_reg8(g_addr, reg_gyro_config, 0x00) &&  // ±250 dps
        i2cbus::write_reg8(g_addr, reg_accel_config, 0x00);   // ±2 g
    if (!cfg_ok) {
        return dev_set(st, DevState::Error, "config write failed");
    }
    sleep_ms(20);

    Sample s;
    if (!read(s)) {
        return dev_set(st, DevState::Error, "first sample read failed");
    }

    // At rest the accelerometer should see about 1 g in total.
    const float g_total = std::sqrt(s.ax_g * s.ax_g + s.ay_g * s.ay_g + s.az_g * s.az_g);
    if (g_total < 0.5f || g_total > 1.5f) {
        return dev_set(st, DevState::Error, "WHO=0x%02X but |a|=%.2fg (expect ~1)", id, g_total);
    }
    return dev_set(st, DevState::Ok, "WHO=0x%02X |a|=%.2fg %.1fC", id, g_total, s.temp_c);
}

bool read(Sample& out) {
    if (g_addr == 0) {
        return false;
    }
    uint8_t b[14];
    if (!i2cbus::read_regs(g_addr, reg_accel_xout_h, b, sizeof(b))) {
        return false;
    }
    auto s16 = [&](int i) { return static_cast<int16_t>((b[i] << 8) | b[i + 1]); };

    out.ax_g = s16(0) / 16384.0f;
    out.ay_g = s16(2) / 16384.0f;
    out.az_g = s16(4) / 16384.0f;
    out.temp_c = s16(6) / 340.0f + 36.53f;
    out.gx_dps = s16(8) / 131.0f;
    out.gy_dps = s16(10) / 131.0f;
    out.gz_dps = s16(12) / 131.0f;
    return true;
}

} // namespace imu
