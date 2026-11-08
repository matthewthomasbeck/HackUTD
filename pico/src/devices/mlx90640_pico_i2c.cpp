// Pico backend for the Melexis MLX90640 API (replaces MLX90640_LINUX_I2C_Driver.cpp).
// The camera has its own bus: ARGOS_THERMAL_I2C (I2C1, GP14/GP15).
// The API reads/writes 16-bit registers at 16-bit addresses, big-endian.

#include "MLX90640_I2C_Driver.h"

#include "bus/i2c_bus.hpp"
#include "config.hpp"
#include "hardware/i2c.h"

void MLX90640_I2CInit(void) {
    // The thermal bus is set up once by i2cbus::init().
}

int MLX90640_I2CRead(uint8_t slaveAddr, uint16_t startAddress,
                     uint16_t nMemAddressRead, uint16_t* data) {
    const uint8_t cmd[2] = {
        static_cast<uint8_t>(startAddress >> 8),
        static_cast<uint8_t>(startAddress & 0xFF),
    };
    if (i2c_write_timeout_us(ARGOS_THERMAL_I2C, slaveAddr, cmd, 2, true,
                             i2cbus::timeout_us(2)) != 2) {
        return -1;
    }

    // Read straight into the caller's buffer, then fix byte order in place.
    // Word i occupies exactly bytes 2i and 2i+1, so this is safe.
    const size_t len = static_cast<size_t>(nMemAddressRead) * 2;
    uint8_t* bytes = reinterpret_cast<uint8_t*>(data);
    if (i2c_read_timeout_us(ARGOS_THERMAL_I2C, slaveAddr, bytes, len, false,
                            i2cbus::timeout_us(len)) != static_cast<int>(len)) {
        return -1;
    }
    for (uint16_t i = 0; i < nMemAddressRead; ++i) {
        const uint8_t hi = bytes[2 * i];
        const uint8_t lo = bytes[2 * i + 1];
        data[i] = static_cast<uint16_t>((hi << 8) | lo);
    }
    return 0;
}

int MLX90640_I2CWrite(uint8_t slaveAddr, uint16_t writeAddress, uint16_t data) {
    const uint8_t cmd[4] = {
        static_cast<uint8_t>(writeAddress >> 8),
        static_cast<uint8_t>(writeAddress & 0xFF),
        static_cast<uint8_t>(data >> 8),
        static_cast<uint8_t>(data & 0xFF),
    };
    if (i2c_write_timeout_us(ARGOS_THERMAL_I2C, slaveAddr, cmd, 4, false,
                             i2cbus::timeout_us(4)) != 4) {
        return -1;
    }
    return 0;
}

void MLX90640_I2CFreqSet(int freq) {
    // Intentionally ignored: set cfg::thermal_baud_hz in config.hpp instead.
    (void)freq;
}
