#pragma once

// Mock devices, so the whole state machine runs on a laptop with no hardware (docs/ROBOT.md).
// MockControls is the "knob panel" shared by every mock: `robotctl mock ...` turns the knobs
// to make a device fail its init, a sensor go stale, or the Pico link drop.
//
// The full device layer (real drivers, Pico link, camera, GPS) is task R2. Until then a real
// (mock: false) device is an UnimplementedDevice that reports FAILED, so nothing on the Pi moves.

#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <string>

#include "hal/device.hpp"

namespace robot {

class MockControls {
 public:
  // The status a mock device returns from its next init(). Default OK.
  void set_init_status(const std::string& device, DeviceStatus status);
  DeviceStatus init_status(const std::string& device) const;

  void set_stale(const std::string& device, bool stale);
  bool is_stale(const std::string& device) const;

  void set_pico_link_lost(bool lost);
  bool pico_link_lost() const;

  void set_estop_sense(bool asserted);
  bool estop_sense() const;

 private:
  mutable std::mutex mutex_;
  std::map<std::string, DeviceStatus> init_status_;
  std::set<std::string> stale_;
  bool pico_link_lost_ = false;
  bool estop_sense_ = false;
};

class MockDevice : public IDevice {
 public:
  MockDevice(std::string name, std::shared_ptr<MockControls> controls);
  std::string name() const override { return name_; }
  InitResult init() override;

 private:
  std::string name_;
  std::shared_ptr<MockControls> controls_;
};

class UnimplementedDevice : public IDevice {
 public:
  explicit UnimplementedDevice(std::string name) : name_(std::move(name)) {}
  std::string name() const override { return name_; }
  InitResult init() override { return {DeviceStatus::FAILED, "real driver not written yet (task R2)"}; }

 private:
  std::string name_;
};

}  // namespace robot
