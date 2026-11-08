#pragma once

#include <cstddef>
#include <cstdint>

// I2C helpers. Every call has a timeout so a missing or stuck device can't
// hang the Pico. Calls without a bus argument use the I2C0 sensor bus
// (IMU + ADS1115); the thermal camera uses I2C1 (see config.hpp).

#include "hardware/i2c.h"

namespace i2cbus {

// Sets up both buses: I2C0 sensors and I2C1 thermal.
void init();

// True if a device ACKs its address.
bool probe(uint8_t addr);
bool probe(i2c_inst_t* bus, uint8_t addr);

bool write_reg8(uint8_t addr, uint8_t reg, uint8_t value);
bool write_reg16_be(uint8_t addr, uint8_t reg, uint16_t value);
bool read_regs(uint8_t addr, uint8_t reg, uint8_t* out, size_t len);
bool read_reg16_be(uint8_t addr, uint8_t reg, uint16_t& out);

// Fills found[] with responding addresses, returns how many.
int scan(uint8_t* found, int max_found);
int scan(i2c_inst_t* bus, uint8_t* found, int max_found);

// Timeout for a transfer of len bytes at the bus speed, with margin.
unsigned timeout_us(size_t len);

// Unstick a jammed bus: if a transfer was cut off mid-byte, a chip can keep
// SDA held low forever. This pulses SCL 9 times, sends a STOP, and resets the
// Pico's I2C block. Chips keep their settings; callers may re-init them anyway.
void recover(i2c_inst_t* bus);

} // namespace i2cbus
