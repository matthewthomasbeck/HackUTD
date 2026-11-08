#include <array>
#include <atomic>
#include <mutex>

#include "hal/dc_driver.hpp"

namespace robot {

namespace {

class DcDriverMock : public IDcDriver {
 public:
  explicit DcDriverMock(std::string name) : name_(std::move(name)) {}

  std::string name() const override { return name_; }

  InitResult init() override {
    ready_ = true;
    return {DeviceStatus::OK, "mock"};
  }

  bool ready() const override { return ready_; }

  bool set_duty(int channel, double duty) override {
    if (channel < 0 || channel > 1) return false;
    std::lock_guard<std::mutex> lock(mutex_);
    duty_[static_cast<std::size_t>(channel)] = duty;
    return true;
  }

  bool stop_all() override {
    std::lock_guard<std::mutex> lock(mutex_);
    duty_ = {0, 0};
    return true;
  }

 private:
  std::string name_;
  std::atomic<bool> ready_{false};
  std::mutex mutex_;
  std::array<double, 2> duty_{0, 0};
};

}  // namespace

std::shared_ptr<IDcDriver> make_dc_driver_mock(const std::string& name) { return std::make_shared<DcDriverMock>(name); }

}  // namespace robot
