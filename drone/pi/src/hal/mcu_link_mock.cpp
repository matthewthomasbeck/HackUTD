#include <atomic>

#include "hal/device_mock.hpp"
#include "hal/mcu_link.hpp"

namespace drone {

namespace {

class McuLinkMock : public IMcuLink {
 public:
  explicit McuLinkMock(std::shared_ptr<MockControls> controls) : controls_(std::move(controls)) {}

  std::string name() const override { return "mcu"; }

  InitResult init() override {
    const DeviceStatus status = controls_->init_status("mcu");
    up_ = status != DeviceStatus::FAILED;
    return {status, status == DeviceStatus::OK ? "mock" : "mock, forced by dronectl"};
  }

  // Pretends a heartbeat and a full set of readings arrived since the last tick.
  void poll(SteadyTime now) override {
    if (!up_ || controls_->mcu_link_lost()) return;
    has_heartbeat_ = true;
    last_heartbeat_ = now;
    if (!controls_->is_stale("imu")) readings_.imu.write(ImuSample{0, 0, 9.81f, 0, 0, 0}, now);  // level, still
  }

  std::optional<double> heartbeat_age_ms(SteadyTime now) const override {
    if (!has_heartbeat_) return std::nullopt;
    return ms_between(last_heartbeat_, now);
  }

  const McuReadings& readings() const override { return readings_; }

 private:
  std::shared_ptr<MockControls> controls_;
  McuReadings readings_;
  std::atomic<bool> up_{false};  // written by the init thread, read by the main thread
  bool has_heartbeat_ = false;
  SteadyTime last_heartbeat_{};
};

}  // namespace

std::shared_ptr<IMcuLink> make_mcu_link_mock(std::shared_ptr<MockControls> controls) {
  return std::make_shared<McuLinkMock>(std::move(controls));
}

}  // namespace drone
