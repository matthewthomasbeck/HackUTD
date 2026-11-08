#pragma once

// IDcDriver: one dual DC motor driver (A drives motors 1 and 2, B drives 3 and 4, the mecanum wheels).
// Only the movement thread calls these.
// The drivers are dual H-bridge modules on Pi GPIO PWM through pigpiod (docs/ROBOT.md "Pi 4B GPIO").

#include <array>
#include <memory>
#include <string>

#include "hal/device.hpp"
#include "hal/gpio.hpp"

namespace robot {

class IDcDriver : public IDevice {
 public:
  virtual bool ready() const = 0;
  // channel 0 or 1; duty from -1 (full reverse) to 1 (full forward).
  virtual bool set_duty(int channel, double duty) = 0;
  virtual bool stop_all() = 0;
};

// dc_driver_a / dc_driver_b keys in robot.yaml.
struct DcGpioConfig {
  int pwm_hz = 1000;
  std::array<std::array<int, 2>, 2> pins{};  // [channel][IN1, IN2] as BCM GPIO numbers
  double min_duty = 0;                        // smallest duty that turns a wheel, TBD on the floor
};

std::shared_ptr<IDcDriver> make_dc_driver_gpio(const std::string& name, const DcGpioConfig& config,
                                               std::shared_ptr<IGpio> gpio);
std::shared_ptr<IDcDriver> make_dc_driver_mock(const std::string& name);

}  // namespace robot
