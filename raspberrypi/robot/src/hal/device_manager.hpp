#pragma once

// Runs device init off the main thread (whiteboard step 2-A, "open ephemeral threads").
//
// start_init() returns at once. A worker thread inits the devices one at a time, in config
// order, each in its own short-lived thread with a timeout, and records OK | DEGRADED | FAILED.
// The main loop reads records() every tick and never waits, so a hung device cannot stall it.
// Devices behind the Pico are only tried once the Pico itself is OK.

#include <chrono>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "hal/device.hpp"

namespace robot {

struct DeviceRecord {
  std::string name;
  bool initialized = false;  // init finished (or timed out) in the current pass
  DeviceStatus status = DeviceStatus::FAILED;
  std::string detail = "not initialized";
};

class DeviceManager {
 public:
  DeviceManager(std::vector<std::shared_ptr<IDevice>> devices_in_order, std::set<std::string> pico_devices,
                std::chrono::milliseconds timeout);
  ~DeviceManager();

  DeviceManager(const DeviceManager&) = delete;
  DeviceManager& operator=(const DeviceManager&) = delete;

  // all = true: init every device (from BOOT). all = false: only devices that are not OK (FAULT retry).
  void start_init(bool all);

  bool init_complete() const;
  std::vector<DeviceRecord> records() const;

 private:
  void run(std::vector<std::size_t> todo);
  void set_record(std::size_t index, const DeviceRecord& record);
  DeviceStatus status_of(const std::string& name) const;

  std::vector<std::shared_ptr<IDevice>> devices_;
  std::set<std::string> pico_devices_;
  std::chrono::milliseconds timeout_;

  mutable std::mutex mutex_;
  std::vector<DeviceRecord> records_;
  std::thread worker_;
};

}  // namespace robot
