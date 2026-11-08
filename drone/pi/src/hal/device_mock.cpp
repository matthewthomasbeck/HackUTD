#include "hal/device_mock.hpp"

namespace drone {

void MockControls::set_init_status(const std::string& device, DeviceStatus status) {
  std::lock_guard<std::mutex> lock(mutex_);
  init_status_[device] = status;
}

DeviceStatus MockControls::init_status(const std::string& device) const {
  std::lock_guard<std::mutex> lock(mutex_);
  const auto it = init_status_.find(device);
  return it == init_status_.end() ? DeviceStatus::OK : it->second;
}

void MockControls::set_stale(const std::string& device, bool stale) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (stale) {
    stale_.insert(device);
  } else {
    stale_.erase(device);
  }
}

bool MockControls::is_stale(const std::string& device) const {
  std::lock_guard<std::mutex> lock(mutex_);
  return stale_.count(device) > 0;
}

void MockControls::set_mcu_link_lost(bool lost) {
  std::lock_guard<std::mutex> lock(mutex_);
  mcu_link_lost_ = lost;
}

bool MockControls::mcu_link_lost() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return mcu_link_lost_;
}

void MockControls::set_estop_sense(bool asserted) {
  std::lock_guard<std::mutex> lock(mutex_);
  estop_sense_ = asserted;
}

bool MockControls::estop_sense() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return estop_sense_;
}

MockDevice::MockDevice(std::string name, std::shared_ptr<MockControls> controls)
    : name_(std::move(name)), controls_(std::move(controls)) {}

InitResult MockDevice::init() {
  const DeviceStatus status = controls_->init_status(name_);
  return {status, status == DeviceStatus::OK ? "mock" : "mock, forced by dronectl"};
}

}  // namespace drone
