#include "devices/ads1115.hpp"

#include "bus/i2c_bus.hpp"
#include "config.hpp"
#include "pico/stdlib.h"

namespace ads1115 {

static constexpr uint8_t reg_conversion = 0x00;
static constexpr uint8_t reg_config = 0x01;

static constexpr uint16_t os_start = 0x8000;   // write: start conversion / read: idle
static constexpr uint16_t config_base = 0x0383; // single-shot | ±4.096 V | 128 SPS | comparator off
static constexpr uint16_t mux_ain[channel_count] = {0x4000, 0x5000, 0x6000, 0x7000};
static constexpr float volts_per_bit = 4.096f / 32768.0f;

static uint8_t g_addr = 0;

bool read_channel(int channel, float& volts) {
    if (g_addr == 0 || channel < 0 || channel >= channel_count) {
        return false;
    }
    const uint16_t cfg_word = config_base | mux_ain[channel] | os_start;
    if (!i2cbus::write_reg16_be(g_addr, reg_config, cfg_word)) {
        return false;
    }

    // 128 SPS -> ~7.8 ms per conversion. Poll the OS bit, give up after 25 ms.
    const absolute_time_t deadline = make_timeout_time_ms(25);
    uint16_t status = 0;
    do {
        sleep_us(1000);
        if (!i2cbus::read_reg16_be(g_addr, reg_config, status)) {
            return false;
        }
    } while ((status & os_start) == 0 && !time_reached(deadline));
    if ((status & os_start) == 0) {
        return false;
    }

    uint16_t raw = 0;
    if (!i2cbus::read_reg16_be(g_addr, reg_conversion, raw)) {
        return false;
    }
    volts = static_cast<int16_t>(raw) * volts_per_bit;
    return true;
}

uint8_t address() {
    return g_addr;
}

bool reacquire() {
    if (g_addr != 0 && i2cbus::probe(g_addr)) {
        return true;
    }
    for (uint8_t addr : cfg::ads_addrs) {
        if (addr != g_addr && i2cbus::probe(addr)) {
            g_addr = addr;
            return true;
        }
    }
    return false;
}

bool start_conversion(int channel) {
    if (g_addr == 0 || channel < 0 || channel >= channel_count) {
        return false;
    }
    return i2cbus::write_reg16_be(g_addr, reg_config, config_base | mux_ain[channel] | os_start);
}

bool conversion_done() {
    uint16_t status = 0;
    return g_addr != 0 && i2cbus::read_reg16_be(g_addr, reg_config, status) &&
           (status & os_start) != 0;
}

bool read_result(float& volts) {
    uint16_t raw = 0;
    if (g_addr == 0 || !i2cbus::read_reg16_be(g_addr, reg_conversion, raw)) {
        return false;
    }
    volts = static_cast<int16_t>(raw) * volts_per_bit;
    return true;
}

bool init(DevStatus& st) {
    dev_reset(st, "ads1115");
    g_addr = 0;

    for (uint8_t addr : cfg::ads_addrs) {
        if (i2cbus::probe(addr)) {
            g_addr = addr;
            break;
        }
    }
    if (g_addr == 0) {
        return dev_set(st, DevState::NotFound, "no ACK at 0x48-0x4B");
    }
    st.addr = g_addr;

    // Write a config (no conversion), read it back: proves it's really an ADS1115.
    const uint16_t probe_cfg = config_base | mux_ain[0];
    uint16_t readback = 0;
    if (!i2cbus::write_reg16_be(g_addr, reg_config, probe_cfg) ||
        !i2cbus::read_reg16_be(g_addr, reg_config, readback)) {
        return dev_set(st, DevState::Error, "config write/read failed");
    }
    if ((readback & 0x7FFF) != (probe_cfg & 0x7FFF)) {
        return dev_set(st, DevState::Error, "config readback 0x%04X != 0x%04X", readback, probe_cfg);
    }

    float v[channel_count] = {};
    for (int ch = 0; ch < channel_count; ++ch) {
        if (!read_channel(ch, v[ch])) {
            return dev_set(st, DevState::Error, "conversion on AIN%d timed out", ch);
        }
    }
    return dev_set(st, DevState::Ok, "AIN0-3 %.2f %.2f %.2f %.2f V", v[0], v[1], v[2], v[3]);
}

} // namespace ads1115
