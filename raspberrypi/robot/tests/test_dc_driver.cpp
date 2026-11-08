// GPIO PWM DC driver (docs/ROBOT.md "Pi 4B GPIO: DC motor drivers"), against a fake GPIO.

#include <map>
#include <string>

#include <gtest/gtest.h>

#include "hal/dc_driver.hpp"

namespace robot {
namespace {

class FakeGpio : public IGpio {
 public:
  std::string error;  // what connect() should report
  std::map<int, int> duty;
  std::map<int, int> freq;
  std::map<int, bool> output;

  std::string connect() override { return error; }
  bool set_output(int pin) override { return output[pin] = true; }
  bool set_pwm_frequency(int pin, int hz) override {
    freq[pin] = hz;
    return true;
  }
  bool set_duty(int pin, int d) override {
    duty[pin] = d;
    return true;
  }
};

// The left DCMC as wired: ch0 FL on 17/27, ch1 BL on 22/23.
DcGpioConfig left(double min_duty = 0) { return DcGpioConfig{1000, {{{17, 27}, {22, 23}}}, min_duty}; }

TEST(DcDriverGpio, InitSetsEveryPinToZeroOutput) {
  auto gpio = std::make_shared<FakeGpio>();
  gpio->duty[17] = 200;  // left running by a previous crash
  auto d = make_dc_driver_gpio("dc_driver_a", left(), gpio);
  ASSERT_EQ(d->init().status, DeviceStatus::OK);
  for (int pin : {17, 27, 22, 23}) {
    EXPECT_TRUE(gpio->output[pin]);
    EXPECT_EQ(gpio->freq[pin], 1000);
    EXPECT_EQ(gpio->duty[pin], 0) << pin;
  }
}

TEST(DcDriverGpio, NoPigpiodIsFailedAndRefusesCommands) {
  auto gpio = std::make_shared<FakeGpio>();
  gpio->error = "pigpiod not running";
  auto d = make_dc_driver_gpio("dc_driver_a", left(), gpio);
  const InitResult r = d->init();
  EXPECT_EQ(r.status, DeviceStatus::FAILED);
  EXPECT_EQ(r.detail, "pigpiod not running");
  EXPECT_FALSE(d->ready());
  EXPECT_FALSE(d->set_duty(0, 0.5));
}

TEST(DcDriverGpio, SignPicksTheInput) {
  auto gpio = std::make_shared<FakeGpio>();
  auto d = make_dc_driver_gpio("dc_driver_a", left(), gpio);
  ASSERT_EQ(d->init().status, DeviceStatus::OK);
  ASSERT_TRUE(d->set_duty(0, 0.5));
  EXPECT_EQ(gpio->duty[17], 128);  // IN1 PWM
  EXPECT_EQ(gpio->duty[27], 0);
  ASSERT_TRUE(d->set_duty(0, -1.0));
  EXPECT_EQ(gpio->duty[17], 0);
  EXPECT_EQ(gpio->duty[27], 255);  // IN2 PWM
  ASSERT_TRUE(d->set_duty(1, 2.0));  // clamped to full forward
  EXPECT_EQ(gpio->duty[22], 255);
}

TEST(DcDriverGpio, MinDutyLiftsSmallCommandsButZeroStaysZero) {
  auto gpio = std::make_shared<FakeGpio>();
  auto d = make_dc_driver_gpio("dc_driver_a", left(0.25), gpio);
  ASSERT_EQ(d->init().status, DeviceStatus::OK);
  ASSERT_TRUE(d->set_duty(0, 0.01));
  EXPECT_EQ(gpio->duty[17], 66);  // (0.25 + 0.75 * 0.01) * 255 = 65.7, rounded
  ASSERT_TRUE(d->set_duty(0, 0.0));
  EXPECT_EQ(gpio->duty[17], 0);
}

TEST(DcDriverGpio, StopAllZeroesBothChannels) {
  auto gpio = std::make_shared<FakeGpio>();
  auto d = make_dc_driver_gpio("dc_driver_a", left(), gpio);
  ASSERT_EQ(d->init().status, DeviceStatus::OK);
  d->set_duty(0, 1);
  d->set_duty(1, -1);
  ASSERT_TRUE(d->stop_all());
  for (int pin : {17, 27, 22, 23}) EXPECT_EQ(gpio->duty[pin], 0) << pin;
}

TEST(DcDriverGpio, DestructorStopsTheMotors) {
  auto gpio = std::make_shared<FakeGpio>();
  {
    auto d = make_dc_driver_gpio("dc_driver_a", left(), gpio);
    ASSERT_EQ(d->init().status, DeviceStatus::OK);
    d->set_duty(0, 1);
  }
  EXPECT_EQ(gpio->duty[17], 0);
}

}  // namespace
}  // namespace robot
