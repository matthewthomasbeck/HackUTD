// Real Pico link over USB serial (tasks R2 and R4). Stub: init() reports FAILED.

#include "hal/pico_link.hpp"

namespace robot {

std::optional<double> IPicoLink::sensor_age_ms(const std::string& sensor, SteadyTime now) const {
  const PicoReadings& r = readings();
  if (sensor == "imu") return r.imu.age_ms(now);
  if (sensor == "thermal") return r.thermal.age_ms(now);
  if (sensor == "ads1115") return r.force.age_ms(now);
  if (sensor == "lidar_single") return r.lidar_single.age_ms(now);
  if (sensor == "ld19") return r.ld19.age_ms(now);
  return std::nullopt;
}

namespace {

class PicoLinkSerial : public IPicoLink {
 public:
  explicit PicoLinkSerial(PicoLinkConfig config) : config_(std::move(config)) {}

  std::string name() const override { return "pico"; }

  InitResult init() override {
    // TODO(R2): open config_.path with O_NONBLOCK, cfmakeraw, then send HELLO with the protocol
    // version from protocol/pico_link.h and wait (here, on the init thread) for VERSION.
    // Then INIT_DEV for each Pico sensor and collect DEV_STATUS (section 4.1 step 4).
    return {DeviceStatus::FAILED, "Pico link not written yet (task R2), " + config_.path};
  }

  void poll(SteadyTime now) override {
    // TODO(R2): read() until EAGAIN into rx_, then loop: find 0xAA 0x55, check length and CRC,
    // decode one frame (DATA -> the matching slot in readings_, HEARTBEAT -> last_heartbeat_),
    // drop and count bad frames, keep a partial frame in rx_. Send our HEARTBEAT every
    // 1 / config_.heartbeat_hz seconds with a non-blocking write.
    (void)now;
  }

  std::optional<double> heartbeat_age_ms(SteadyTime now) const override {
    if (!has_heartbeat_) return std::nullopt;
    return ms_between(last_heartbeat_, now);
  }

  const PicoReadings& readings() const override { return readings_; }

 private:
  PicoLinkConfig config_;
  PicoReadings readings_;
  std::vector<std::uint8_t> rx_;  // bytes received but not yet parsed
  bool has_heartbeat_ = false;
  SteadyTime last_heartbeat_{};
};

}  // namespace

std::shared_ptr<IPicoLink> make_pico_link_serial(const PicoLinkConfig& config) {
  return std::make_shared<PicoLinkSerial>(config);
}

}  // namespace robot
