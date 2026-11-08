#include "hal/device_manager.hpp"

#include <future>

#include "core/log.hpp"

namespace robot {

DeviceManager::DeviceManager(std::vector<std::shared_ptr<IDevice>> devices_in_order,
                             std::set<std::string> pico_devices, std::chrono::milliseconds timeout)
    : devices_(std::move(devices_in_order)), pico_devices_(std::move(pico_devices)), timeout_(timeout) {
  for (const auto& d : devices_) {
    DeviceRecord r;
    r.name = d->name();
    records_.push_back(r);
  }
}

DeviceManager::~DeviceManager() {
  if (worker_.joinable()) worker_.join();
}

void DeviceManager::start_init(bool all) {
  // The state machine only re-enters INIT after the last pass finished, so this join is quick.
  if (worker_.joinable()) worker_.join();

  std::vector<std::size_t> todo;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    for (std::size_t i = 0; i < records_.size(); ++i) {
      if (all || records_[i].status != DeviceStatus::OK) {
        // Mark as pending now, before returning, so the next tick's snapshot shows init in progress.
        records_[i].initialized = false;
        records_[i].detail = "initializing";
        todo.push_back(i);
      }
    }
  }
  worker_ = std::thread(&DeviceManager::run, this, std::move(todo));
}

bool DeviceManager::init_complete() const {
  std::lock_guard<std::mutex> lock(mutex_);
  for (const auto& r : records_) {
    if (!r.initialized) return false;
  }
  return true;
}

std::vector<DeviceRecord> DeviceManager::records() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return records_;
}

void DeviceManager::set_record(std::size_t index, const DeviceRecord& record) {
  std::lock_guard<std::mutex> lock(mutex_);
  records_[index] = record;
}

DeviceStatus DeviceManager::status_of(const std::string& name) const {
  std::lock_guard<std::mutex> lock(mutex_);
  for (const auto& r : records_) {
    if (r.name == name) return r.status;
  }
  return DeviceStatus::FAILED;
}

void DeviceManager::run(std::vector<std::size_t> todo) {
  for (const std::size_t i : todo) {
    const std::shared_ptr<IDevice> device = devices_[i];
    DeviceRecord record;
    record.name = device->name();
    record.initialized = true;

    if (pico_devices_.count(record.name) > 0 && status_of("pico") != DeviceStatus::OK) {
      record.status = DeviceStatus::FAILED;
      record.detail = "Pico link is not up";
    } else {
      // A packaged_task on a detached thread: if init() hangs we stop waiting after the timeout
      // and move on. (A std::async future would block in its destructor and hang us anyway.)
      auto task = std::make_shared<std::packaged_task<InitResult()>>([device] { return device->init(); });
      std::future<InitResult> result = task->get_future();
      std::thread([task] { (*task)(); }).detach();

      if (result.wait_for(timeout_) == std::future_status::ready) {
        try {
          const InitResult r = result.get();
          record.status = r.status;
          record.detail = r.detail;
        } catch (const std::exception& e) {
          record.status = DeviceStatus::FAILED;
          record.detail = std::string("init threw: ") + e.what();
        }
      } else {
        record.status = DeviceStatus::FAILED;
        record.detail = "init timed out after " + std::to_string(timeout_.count()) + " ms";
      }
    }

    log::info("device " + record.name + ": " + to_string(record.status) + " (" + record.detail + ")");
    set_record(i, record);
  }
}

}  // namespace robot
