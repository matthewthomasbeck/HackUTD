#pragma once

// ArgOS Pico: pin map and device addresses (Raspberry Pi Pico 1.0 / RP2040).
//
// Wiring (Pico physical pin in brackets):
//
//   I2C0 sensor bus @ 100 kHz: IMU + ADS1115
//     SDA  GP4 [6]    SCL  GP5 [7]    3V3 [36]    GND [38]
//
//   I2C1 thermal bus @ 400 kHz: MLX90640 on its own, at the far end of the
//   board. On GP2/GP3 (right next to GP4/GP5) its traffic kept knocking the
//   IMU/ADS1115 bus over; unplugging the camera made that bus solid.
//     SDA  GP14 [19]  SCL  GP15 [20]  GND [18]  3V3 [36] (its own wire)
//
//   Lidars: matched to how the robot is actually wired (LIDARPROBE showed the
//   LD19's packets arriving on GP1 and the TF-Luna's on GP9):
//
//   UART0: LD19 360 lidar @ 230400 (lidar only talks, Pico only listens)
//     Pico RX GP1 [2]  <- LD19 DATA/Tx     LD19 CTL/PWM -> GND (internal ~10 Hz)
//
//   UART1: TF-Luna single-point lidar @ 115200 (Pico only listens)
//     Pico RX GP9 [12] <- TF-Luna green (TXD)     TF-Luna pin 5 open (UART mode)
//
//   Both lidars need 5 V (VBUS [40] when on USB) and a GND shared with the Pico.
//   The Pico never transmits to either lidar.
//
//   USB: serial link to the Pi (/dev/serial/by-id/usb-Raspberry_Pi_Pico_*)
//
// The thermal camera has its own bus, so its ~40 ms frame reads never delay
// the IMU. 400 kHz is safe on breadboard jumpers; the MLX90640 can do 1 MHz.

#include <cstdint>

#define ARGOS_SENSOR_I2C i2c0
#define ARGOS_THERMAL_I2C i2c1
#define ARGOS_LD19_UART uart0
#define ARGOS_TFLUNA_UART uart1

namespace cfg {

// ---- I2C sensor bus ----
// 100 kHz on purpose: the bus was glitching while the thermal camera streamed
// on the neighbouring pins (GP2/GP3). Slower bits ride out crosstalk, and the
// IMU (50 Hz x 14 bytes) and ADS1115 need only a few percent of it.
constexpr unsigned i2c_sda_pin = 4;
constexpr unsigned i2c_scl_pin = 5;
constexpr unsigned i2c_baud_hz = 100 * 1000;

// ---- MPU6050 IMU (AD0 low -> 0x68, high -> 0x69) ----
constexpr uint8_t imu_addrs[] = {0x68, 0x69};

// ---- ADS1115 (ADDR strap: GND 0x48, VDD 0x49, SDA 0x4A, SCL 0x4B) ----
constexpr uint8_t ads_addrs[] = {0x48, 0x49, 0x4A, 0x4B};

// ---- MLX90640 thermal camera (own bus) ----
#ifndef ARGOS_THERMAL_ON_GP2
constexpr unsigned thermal_sda_pin = 14;
constexpr unsigned thermal_scl_pin = 15;
#else
constexpr unsigned thermal_sda_pin = 2;  // original wiring (pins 4/5)
constexpr unsigned thermal_scl_pin = 3;
#endif
constexpr unsigned thermal_baud_hz = 400 * 1000;
constexpr uint8_t mlx_addr = 0x33;
constexpr uint8_t mlx_refresh_code = 0b100; // 0b011=4 Hz, 0b100=8 Hz, 0b101=16 Hz

// ---- TF-Luna (UART1) ----
constexpr int tfluna_tx_pin = -1; // receive only: never talk to the lidar
constexpr int tfluna_rx_pin = 9;
constexpr unsigned tfluna_baud = 115200;

// ---- LD19 (UART0) ----
constexpr int ld19_tx_pin = -1; // receive only
constexpr int ld19_rx_pin = 1;
constexpr unsigned ld19_baud = 230400;

// ---- How long init waits for each device before giving up ----
constexpr unsigned usb_wait_ms = 3000;     // wait for the Pi to open the port
constexpr unsigned tfluna_wait_ms = 1000;  // TF-Luna streams at 100 Hz
constexpr unsigned ld19_wait_ms = 2500;    // LD19 motor needs time to spin up

} // namespace cfg
