// Dual H-bridge DC motor driver on Pi GPIO PWM (docs/ROBOT.md "Pi 4B GPIO: DC motor drivers").
// Same wiring and logic as Vending_Machine_Robot-Hardware utilities/motors.py and
// C_Hardware_Testing DcmcDriver, bench-tested 2026-11-08.
//
// Each channel has two inputs. Positive duty puts PWM on IN1 with IN2 low, negative duty puts PWM
// on IN2 with IN1 low, zero holds both low. Which way that turns a wheel, and which wheel it is,
// is the mixer's job (motion.mecanum.wheel_order and invert), not the driver's.
//
// Safety: an H-bridge has no timeout, and pigpiod keeps the last duty if this program dies.
// init() and the destructor set every pin to 0, and systemd ExecStartPre / ExecStopPost should do
// the same (docs/ROBOT.md "Safety without an actuator watchdog chip").

#include <algorithm>
#include <cmath>
#include <mutex>

#include "hal/dc_driver.hpp"

namespace robot {

namespace {

class DcDriverGpio : public IDcDriver {
 public:
  DcDriverGpio(std::string name, DcGpioConfig config, std::shared_ptr<IGpio> gpio)
      : name_(std::move(name)), config_(config), gpio_(std::move(gpio)) {}

  ~DcDriverGpio() override { stop_all(); }

  std::string name() const override { return name_; }

  InitResult init() override {
    std::lock_guard<std::mutex> lock(mutex_);
    ready_ = false;
    const std::string error = gpio_->connect();
    if (!error.empty()) return {DeviceStatus::FAILED, error};
    for (const auto& channel : config_.pins) {
      for (const int pin : channel) {
        if (!gpio_->set_output(pin) || !gpio_->set_pwm_frequency(pin, config_.pwm_hz) || !gpio_->set_duty(pin, 0)) {
          return {DeviceStatus::FAILED, "cannot set up GPIO " + std::to_string(pin)};
        }
      }
    }
    ready_ = true;
    return {DeviceStatus::OK, "GPIO " + pins_text() + " at " + std::to_string(config_.pwm_hz) + " Hz"};
  }

  bool ready() const override {
    std::lock_guard<std::mutex> lock(mutex_);
    return ready_;
  }

  bool set_duty(int channel, double duty) override {
    if (channel < 0 || channel > 1) return false;
    std::lock_guard<std::mutex> lock(mutex_);
    if (!ready_) return false;
    duty = std::max(-1.0, std::min(1.0, duty));
    const int pwm = to_pwm(std::fabs(duty));
    const auto& pins = config_.pins[static_cast<std::size_t>(channel)];
    // Drop the opposite input first, so both are never driven at once.
    if (duty >= 0) {
      return gpio_->set_duty(pins[1], 0) && gpio_->set_duty(pins[0], pwm);
    }
    return gpio_->set_duty(pins[0], 0) && gpio_->set_duty(pins[1], pwm);
  }

  bool stop_all() override {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!ready_) return false;
    bool ok = true;
    for (const auto& channel : config_.pins) {
      for (const int pin : channel) ok = gpio_->set_duty(pin, 0) && ok;
    }
    return ok;
  }

 private:
  // |duty| 0..1 -> 0..255. Any nonzero command starts at min_duty, because a gearmotor sits still
  // below some duty (TBD per wheel on the floor); 0 stays exactly 0.
  int to_pwm(double magnitude) const {
    if (magnitude < 1e-6) return 0;
    const double scaled = config_.min_duty + (1.0 - config_.min_duty) * magnitude;
    return static_cast<int>(std::lround(std::min(1.0, scaled) * 255.0));
  }

  std::string pins_text() const {
    std::string s;
    for (const auto& channel : config_.pins) {
      if (!s.empty()) s += ", ";
      s += std::to_string(channel[0]) + "/" + std::to_string(channel[1]);
    }
    return s;
  }

  std::string name_;
  DcGpioConfig config_;
  std::shared_ptr<IGpio> gpio_;
  mutable std::mutex mutex_;
  bool ready_ = false;
};

}  // namespace

std::shared_ptr<IDcDriver> make_dc_driver_gpio(const std::string& name, const DcGpioConfig& config,
                                               std::shared_ptr<IGpio> gpio) {
  return std::make_shared<DcDriverGpio>(name, config, std::move(gpio));
}

}  // namespace robot
