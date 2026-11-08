#pragma once

// WorldSnapshot: one tick's copy of everything the state machine and safety gate look at.
// The main loop builds it at the start of each tick (the "observe" step) from the latest-value
// slots, so step() and filter() are pure functions of the snapshot and never read hardware.

#include <optional>
#include <string>
#include <vector>

#include "core/clock.hpp"
#include "hal/device.hpp"
#include "hal/pico_link.hpp"
#include "terrain/terrain.hpp"
#include "vision/detection.hpp"

namespace robot {

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

  std::optional<double> pico_heartbeat_age_ms;  // empty if no heartbeat seen yet
  double pico_link_timeout_ms = 250;

  bool estop_sense_asserted = false;  // physical e-stop sense line, if one is wired (estop.sense)
  bool motion_stopped = true;         // the last command sent to the drivers was zero
  bool clip_recording = false;        // the camera is recording a breathing clip (task R5)
  // This tick's terrain (task R7, robot.md 7b), after hysteresis and the camera hint. The main loop
  // fills it after observe(); empty only before the first assessment, which the gate treats as no limit.
  std::optional<TerrainAssessment> terrain;
  std::optional<Detections> detections;  // newest result from the vision thread, if any

  // Pico sensors the mission behaviors use, only when fresh (thermal.stale_ms etc.).
  std::optional<ThermalFrame> thermal;   // newest thermal frame
  SteadyTime thermal_at{};               // when it arrived, so a behavior can tell a new frame
  std::optional<double> range_m;         // TF-Luna, straight ahead, only with a trustworthy strength
  std::optional<Ld19Scan> ld19;          // newest full LD19 revolution (the 360 degree lidar on top)
  std::optional<ImuSample> imu;          // newest IMU sample
  SteadyTime imu_at{};                   // when it arrived, so the terrain rules can tell a new sample

  const DeviceView* device(const std::string& name) const {
    for (const auto& d : devices) {
      if (d.name == name) return &d;
    }
    return nullptr;
  }
};

}  // namespace robot
