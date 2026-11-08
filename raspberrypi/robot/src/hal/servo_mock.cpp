#include <atomic>
#include <map>
#include <mutex>

#include "hal/servo_bus.hpp"

namespace robot {

namespace {

class ServoMock : public IServoBus {
 public:
  explicit ServoMock(std::string name) : name_(std::move(name)) {}

  std::string name() const override { return name_; }

  InitResult init() override {
    ready_ = true;
    return {DeviceStatus::OK, "mock"};
  }

  bool ready() const override { return ready_; }

  bool set_target_us(int channel, double pulse_us) override {
    std::lock_guard<std::mutex> lock(mutex_);
    targets_[channel] = pulse_us;
    return true;
  }

  bool release_all() override {
    std::lock_guard<std::mutex> lock(mutex_);
    targets_.clear();
    return true;
  }

 private:
  std::string name_;
  std::atomic<bool> ready_{false};
  std::mutex mutex_;
  std::map<int, double> targets_;
};

}  // namespace

std::shared_ptr<IServoBus> make_servo_mock(const std::string& name) { return std::make_shared<ServoMock>(name); }

}  // namespace robot
