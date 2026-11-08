#pragma once

// WorldSnapshot: one tick's copy of everything the state machine and safety gate look at.
// The main loop builds it at the start of each tick (the "observe" step) from the latest-value
// slots, so step() and filter() are pure functions of the snapshot and never read hardware.

#include <optional>
#include <string>
#include <vector>

#include "core/clock.hpp"
#include "hal/device.hpp"
#include "hal/mcu_link.hpp"
#include "vision/detection.hpp"

namespace drone {

struct DeviceView {
  std::string name;
  bool required = false;
  bool initialized = false;  // init() finished (or timed out) for the current INIT pass
  DeviceStatus status = DeviceStatus::FAILED;
  std::string detail;
  std::optional<double> age_ms;  // age of the newest data; empty if the device has no data yet
  double stale_ms = 0;           // 0 means this device has no staleness rule
};

struct WorldSnapshot {
  SteadyTime now{};
  std::vector<DeviceView> devices;
  bool init_complete = false;  // every device finished its init for the current INIT pass

  std::optional<double> mcu_heartbeat_age_ms;  // empty if no heartbeat seen yet
  double mcu_link_timeout_ms = 250;

  bool estop_sense_asserted = false;  // physical e-stop sense line, if one is wired (estop.sense)
  bool motion_stopped = true;         // the last command sent to the flight output was zero
  std::optional<Detections> detections;  // newest result from the vision thread, if any

  // MCU sensors the behaviors use, only when fresh (stale_ms.imu).
  std::optional<ImuSample> imu;  // newest IMU sample
  SteadyTime imu_at{};           // when it arrived

  const DeviceView* device(const std::string& name) const {
    for (const auto& d : devices) {
      if (d.name == name) return &d;
    }
    return nullptr;
  }
};

}  // namespace drone
