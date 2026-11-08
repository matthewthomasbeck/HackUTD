#pragma once

// IDcDriver: one dual DC motor driver (A drives motors 1 and 2, B drives 3 and 4, the mecanum wheels).
// Only the movement thread calls these.
// The driver model and interface (UART or PWM plus direction) are TBD (docs/ROBOT.md).

#include <memory>
#include <string>

#include "hal/device.hpp"

namespace robot {

class IDcDriver : public IDevice {
 public:
  virtual bool ready() const = 0;
  // channel 0 or 1; duty from -1 (full reverse) to 1 (full forward).
  virtual bool set_duty(int channel, double duty) = 0;
  virtual bool stop_all() = 0;
};

// Real driver, protocol TBD. Stub until task R2.
std::shared_ptr<IDcDriver> make_dc_driver_tbd(const std::string& name, const std::string& path, int baud);
std::shared_ptr<IDcDriver> make_dc_driver_mock(const std::string& name);

}  // namespace robot
