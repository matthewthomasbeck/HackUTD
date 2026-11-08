// IGpio over pigpiod (sudo systemctl enable --now pigpiod). See hal/gpio.hpp.

#include <mutex>

#include "hal/gpio.hpp"

#ifdef ROBOT_WITH_PIGPIO
#include <pigpiod_if2.h>
#endif

namespace robot {

namespace {

#ifdef ROBOT_WITH_PIGPIO

class GpioPigpio : public IGpio {
 public:
  ~GpioPigpio() override {
    if (pi_ >= 0) pigpio_stop(pi_);
  }

  std::string connect() override {
    std::lock_guard<std::mutex> lock(mutex_);
    if (tried_) return error_;
    tried_ = true;
    pi_ = pigpio_start(nullptr, nullptr);
    if (pi_ < 0) error_ = "pigpiod not running (sudo systemctl enable --now pigpiod)";
    return error_;
  }

  bool set_output(int pin) override {
    std::lock_guard<std::mutex> lock(mutex_);
    return pi_ >= 0 && set_mode(pi_, static_cast<unsigned>(pin), PI_OUTPUT) == 0;
  }

  bool set_pwm_frequency(int pin, int hz) override {
    std::lock_guard<std::mutex> lock(mutex_);
    return pi_ >= 0 && set_PWM_frequency(pi_, static_cast<unsigned>(pin), static_cast<unsigned>(hz)) >= 0;
  }

  bool set_duty(int pin, int duty) override {
    std::lock_guard<std::mutex> lock(mutex_);
    return pi_ >= 0 && set_PWM_dutycycle(pi_, static_cast<unsigned>(pin), static_cast<unsigned>(duty)) == 0;
  }

 private:
  std::mutex mutex_;
  bool tried_ = false;
  std::string error_;
  int pi_ = -1;
};

#else

class GpioUnavailable : public IGpio {
 public:
  std::string connect() override {
    return "built without pigpio (sudo apt install pigpio, then rebuild)";
  }
  bool set_output(int) override { return false; }
  bool set_pwm_frequency(int, int) override { return false; }
  bool set_duty(int, int) override { return false; }
};

#endif

}  // namespace

std::shared_ptr<IGpio> make_gpio_pigpio() {
#ifdef ROBOT_WITH_PIGPIO
  return std::make_shared<GpioPigpio>();
#else
  return std::make_shared<GpioUnavailable>();
#endif
}

}  // namespace robot
