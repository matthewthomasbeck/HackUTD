// Real Pololu Maestro driver (task R2). Stub: init() reports FAILED, so nothing moves.

#include "hal/servo_bus.hpp"

namespace robot {

namespace {

class ServoMaestro : public IServoBus {
 public:
  ServoMaestro(std::string name, std::string path, int baud)
      : name_(std::move(name)), path_(std::move(path)), baud_(baud) {}

  std::string name() const override { return name_; }

  InitResult init() override {
    // TODO(R2): open path_ raw (cfmakeraw) at baud_ (TBD, 0 means unset), then send the
    // compact-protocol Get Errors command (0xA1) and read 2 bytes to prove the Maestro answers.
    // The Maestro must be in UART mode (docs/ROBOT.md "Electrical rules").
    return {DeviceStatus::FAILED, "real driver not written yet (task R2), " + path_ + " baud " + baud_text()};
  }

  bool ready() const override { return false; }

  bool set_target_us(int channel, double pulse_us) override {
    // TODO(R2): compact protocol Set Target: 0x84, channel, target low 7 bits, target high 7 bits,
    // where target is in quarter-microseconds (pulse_us * 4).
    (void)channel;
    (void)pulse_us;
    return false;
  }

  bool release_all() override {
    // TODO(R2): Set Target 0 on every channel (stops pulses).
    return false;
  }

 private:
  std::string baud_text() const { return baud_ > 0 ? std::to_string(baud_) : "TBD"; }

  std::string name_;
  std::string path_;
  int baud_;
};

}  // namespace

std::shared_ptr<IServoBus> make_servo_maestro(const std::string& name, const std::string& path, int baud) {
  return std::make_shared<ServoMaestro>(name, path, baud);
}

}  // namespace robot
