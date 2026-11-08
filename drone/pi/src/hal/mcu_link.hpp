#pragma once

// IMcuLink: the Pi side of the serial link to the drone's microcontroller (drone/mcu/). As on the
// dog, the MCU owns the sensors, reads them as fast as it can, and streams parsed values to the Pi.
// Which MCU board and which sensors the drone carries are not confirmed (drone/README.md), so only
// the IMU slot exists, mirroring the dog's IMU; its model is TBD.
//
// The main thread calls poll() once per tick. poll() reads only the bytes already waiting
// (non-blocking), parses whole lines into the sensor slots below, and returns. Half a line stays
// buffered for the next tick. It never waits on the MCU.

#include <memory>
#include <optional>
#include <string>

#include "core/latest_slot.hpp"
#include "hal/device.hpp"

namespace drone {

struct ImuSample {
  float ax = 0, ay = 0, az = 0;  // m/s^2, axes TBD by model and mounting
  float gx = 0, gy = 0, gz = 0;  // deg/s
};

// Newest value of each MCU sensor, stamped with Pi steady time when parsed.
struct McuReadings {
  LatestSlot<ImuSample> imu;
};

struct McuLinkConfig {
  std::string path = "/dev/drone_mcu";   // mcu.path, TBD (no udev rule yet)
  int heartbeat_hz = 20;                 // mcu.heartbeat_hz, TBD
  int link_timeout_ms = 250;             // mcu.link_timeout_ms, TBD
  std::string firmware_version = "0.1";  // mcu.firmware_version: PONG must match, else FAILED
};

class IMcuLink : public IDevice {
 public:
  // init(): open the port, PING/PONG version handshake (a version mismatch is FAILED).
  virtual void poll(SteadyTime now) = 0;
  // Age of the last heartbeat from the MCU; empty if none yet.
  virtual std::optional<double> heartbeat_age_ms(SteadyTime now) const = 0;
  virtual const McuReadings& readings() const = 0;
  // Age of one sensor's newest reading by device name (imu).
  std::optional<double> sensor_age_ms(const std::string& sensor, SteadyTime now) const;
  // What the MCU reported for one of its sensors when the link came up (OK, or why not).
  // The device manager inits each MCU sensor as its own device from this.
  virtual InitResult sensor_status(const std::string& sensor) const {
    (void)sensor;
    return {DeviceStatus::FAILED, "MCU did not report sensor status"};
  }
};

// Real link over mcu.path, speaking the firmware's text lines (hal/mcu_text_protocol.hpp).
std::shared_ptr<IMcuLink> make_mcu_link_serial(const McuLinkConfig& config);

// One MCU sensor as a device for the init list: init() returns what the MCU reported for it.
std::shared_ptr<IDevice> make_mcu_sensor_device(const std::string& sensor, std::shared_ptr<IMcuLink> link);

class MockControls;
// Fresh heartbeat and synthetic readings every poll, unless a `dronectl mock` knob says otherwise
// (mcu_link lost stops the heartbeat; stale <sensor> stops that sensor's updates).
std::shared_ptr<IMcuLink> make_mcu_link_mock(std::shared_ptr<MockControls> controls);

}  // namespace drone
