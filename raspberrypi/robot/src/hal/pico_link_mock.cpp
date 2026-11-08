#include <atomic>

#include "hal/device_mock.hpp"
#include "hal/pico_link.hpp"

namespace robot {

namespace {

class PicoLinkMock : public IPicoLink {
 public:
  explicit PicoLinkMock(std::shared_ptr<MockControls> controls) : controls_(std::move(controls)) {}

  std::string name() const override { return "pico"; }

  InitResult init() override {
    const DeviceStatus status = controls_->init_status("pico");
    up_ = status != DeviceStatus::FAILED;
    return {status, status == DeviceStatus::OK ? "mock" : "mock, forced by robotctl"};
  }

  // Pretends a full set of frames arrived since the last tick.
  void poll(SteadyTime now) override {
    if (!up_ || controls_->pico_link_lost()) return;
    has_heartbeat_ = true;
    last_heartbeat_ = now;
    if (!controls_->is_stale("imu")) readings_.imu.write(ImuSample{0, 0, 9.81f, 0, 0, 0}, now);
    if (!controls_->is_stale("thermal")) {
      ThermalFrame t;
      t.width = 32;  // TBD thermal model
      t.height = 24;
      t.centi_deg_c.assign(32 * 24, 2200);  // a 22 C room
      readings_.thermal.write(t, now);
    }
    if (!controls_->is_stale("ads1115")) readings_.force.write(ForceSample{}, now);
    if (!controls_->is_stale("lidar_single")) readings_.lidar_single.write(LidarSingleSample{1500, 100}, now);
    if (!controls_->is_stale("ld19")) readings_.ld19.write(Ld19Scan{}, now);
  }

  std::optional<double> heartbeat_age_ms(SteadyTime now) const override {
    if (!has_heartbeat_) return std::nullopt;
    return ms_between(last_heartbeat_, now);
  }

  const PicoReadings& readings() const override { return readings_; }

 private:
  std::shared_ptr<MockControls> controls_;
  PicoReadings readings_;
  std::atomic<bool> up_{false};  // written by the init thread, read by the main thread
  bool has_heartbeat_ = false;
  SteadyTime last_heartbeat_{};
};

}  // namespace

std::shared_ptr<IPicoLink> make_pico_link_mock(std::shared_ptr<MockControls> controls) {
  return std::make_shared<PicoLinkMock>(std::move(controls));
}

}  // namespace robot
