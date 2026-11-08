#pragma once

// Every device's init() returns OK, DEGRADED, or FAILED with a detail string (docs/ROBOT.md).
// A required device that is not OK sends INIT to FAULT.

#include <string>

namespace robot {

enum class DeviceStatus { OK, DEGRADED, FAILED };

inline const char* to_string(DeviceStatus s) {
  switch (s) {
    case DeviceStatus::OK: return "OK";
    case DeviceStatus::DEGRADED: return "DEGRADED";
    case DeviceStatus::FAILED: return "FAILED";
  }
  return "?";
}

struct InitResult {
  DeviceStatus status = DeviceStatus::FAILED;
  std::string detail;
};

class IDevice {
 public:
  virtual ~IDevice() = default;
  virtual std::string name() const = 0;
  // May block (open a port, handshake). The DeviceManager runs it off the main thread with a timeout.
  virtual InitResult init() = 0;
};

}  // namespace robot
