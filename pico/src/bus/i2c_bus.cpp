#include "bus/i2c_bus.hpp"

#include "config.hpp"
#include "hardware/gpio.h"
#include "hardware/i2c.h"
#include "pico/stdlib.h"

namespace i2cbus {

static void init_bus(i2c_inst_t* bus, unsigned sda, unsigned scl, unsigned baud) {
    i2c_init(bus, baud);
    gpio_set_function(sda, GPIO_FUNC_I2C);
    gpio_set_function(scl, GPIO_FUNC_I2C);
    // Internal pull-ups are weak (~50k); most breakouts carry their own.
    gpio_pull_up(sda);
    gpio_pull_up(scl);
}

void init() {
    init_bus(ARGOS_SENSOR_I2C, cfg::i2c_sda_pin, cfg::i2c_scl_pin, cfg::i2c_baud_hz);
    init_bus(ARGOS_THERMAL_I2C, cfg::thermal_sda_pin, cfg::thermal_scl_pin, cfg::thermal_baud_hz);
}

unsigned timeout_us(size_t len) {
    // ~9 bit-times per byte at the slower bus, x2 margin, plus a fixed 25 ms.
    // Generous on purpose: giving up mid-transfer is what jams a bus, so only
    // a chip that is truly gone should ever hit this.
    const unsigned slowest_hz =
        cfg::i2c_baud_hz < cfg::thermal_baud_hz ? cfg::i2c_baud_hz : cfg::thermal_baud_hz;
    const unsigned per_byte_us = (9u * 1000000u / slowest_hz) * 2u + 1u;
    return 25000u + static_cast<unsigned>(len + 2) * per_byte_us;
}

void recover(i2c_inst_t* bus) {
    const bool thermal = (bus == ARGOS_THERMAL_I2C);
    const unsigned sda = thermal ? cfg::thermal_sda_pin : cfg::i2c_sda_pin;
    const unsigned scl = thermal ? cfg::thermal_scl_pin : cfg::i2c_scl_pin;
    const unsigned baud = thermal ? cfg::thermal_baud_hz : cfg::i2c_baud_hz;

    // Resets the I2C block, dropping any half-finished transfer.
    i2c_deinit(bus);

    // Drive the pins by hand as open-drain: output-low = pull down,
    // input = released (the pull-ups take the line high).
    gpio_init(sda);
    gpio_init(scl);
    gpio_pull_up(sda);
    gpio_pull_up(scl);
    gpio_put(sda, false);
    gpio_put(scl, false);
    gpio_set_dir(sda, GPIO_IN);
    gpio_set_dir(scl, GPIO_IN);
    sleep_us(10);

    // Up to 9 clock pulses lets any chip finish the byte it was sending
    // and let go of SDA.
    for (int i = 0; i < 9; ++i) {
        gpio_set_dir(scl, GPIO_OUT); // SCL low
        sleep_us(5);
        gpio_set_dir(scl, GPIO_IN);  // SCL high
        sleep_us(5);
    }

    // STOP condition: SDA goes low -> high while SCL is high.
    gpio_set_dir(scl, GPIO_OUT);
    sleep_us(5);
    gpio_set_dir(sda, GPIO_OUT);
    sleep_us(5);
    gpio_set_dir(scl, GPIO_IN);
    sleep_us(5);
    gpio_set_dir(sda, GPIO_IN);
    sleep_us(10);

    init_bus(bus, sda, scl, baud);
}

bool probe(i2c_inst_t* bus, uint8_t addr) {
    uint8_t dummy = 0;
    const int rc = i2c_read_timeout_us(bus, addr, &dummy, 1, false, timeout_us(1));
    return rc == 1;
}

bool probe(uint8_t addr) {
    return probe(ARGOS_SENSOR_I2C, addr);
}

bool write_reg8(uint8_t addr, uint8_t reg, uint8_t value) {
    const uint8_t buf[2] = {reg, value};
    return i2c_write_timeout_us(ARGOS_SENSOR_I2C, addr, buf, 2, false, timeout_us(2)) == 2;
}

bool write_reg16_be(uint8_t addr, uint8_t reg, uint16_t value) {
    const uint8_t buf[3] = {
        reg,
        static_cast<uint8_t>(value >> 8),
        static_cast<uint8_t>(value & 0xFF),
    };
    return i2c_write_timeout_us(ARGOS_SENSOR_I2C, addr, buf, 3, false, timeout_us(3)) == 3;
}

bool read_regs(uint8_t addr, uint8_t reg, uint8_t* out, size_t len) {
    if (i2c_write_timeout_us(ARGOS_SENSOR_I2C, addr, &reg, 1, true, timeout_us(1)) != 1) {
        return false;
    }
    const int rc = i2c_read_timeout_us(
        ARGOS_SENSOR_I2C, addr, out, len, false, timeout_us(len));
    return rc == static_cast<int>(len);
}

bool read_reg16_be(uint8_t addr, uint8_t reg, uint16_t& out) {
    uint8_t b[2] = {0, 0};
    if (!read_regs(addr, reg, b, 2)) {
        return false;
    }
    out = static_cast<uint16_t>((b[0] << 8) | b[1]);
    return true;
}

int scan(i2c_inst_t* bus, uint8_t* found, int max_found) {
    int n = 0;
    for (uint8_t addr = 0x08; addr < 0x78 && n < max_found; ++addr) {
        if (probe(bus, addr)) {
            found[n++] = addr;
        }
    }
    return n;
}

int scan(uint8_t* found, int max_found) {
    return scan(ARGOS_SENSOR_I2C, found, max_found);
}

} // namespace i2cbus
