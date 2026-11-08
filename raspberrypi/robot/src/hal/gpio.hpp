#pragma once

// IGpio: PWM on Pi GPIO pins, used by the DC motor drivers (docs/ROBOT.md "Pi 4B GPIO").
// The real one talks to the pigpiod daemon; tests use a fake that records every write.
// One instance is shared by both DC drivers (one pigpiod connection).

#include <memory>
#include <string>

namespace robot {

class IGpio {
 public:
  virtual ~IGpio() = default;
  // Connects on first call; later calls return the same answer. Empty string = connected.
  virtual std::string connect() = 0;
  virtual bool set_output(int pin) = 0;
  virtual bool set_pwm_frequency(int pin, int hz) = 0;
  virtual bool set_duty(int pin, int duty_0_255) = 0;
};

// pigpiod over its socket interface (pigpiod_if2). Built only with ROBOT_WITH_PIGPIO; without it,
// connect() reports why, so the DC drivers come up FAILED instead of silently doing nothing.
std::shared_ptr<IGpio> make_gpio_pigpio();

}  // namespace robot
