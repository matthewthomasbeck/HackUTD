// Real dual DC motor driver (task R2). The model and protocol are TBD, so this stub reports
// FAILED until Matthew confirms the part (docs/tasks/matthew.md M0).

#include "hal/dc_driver.hpp"

namespace robot {

namespace {

class DcDriverTbd : public IDcDriver {
 public:
  DcDriverTbd(std::string name, std::string path, int baud)
      : name_(std::move(name)), path_(std::move(path)), baud_(baud) {}

  std::string name() const override { return name_; }

  InitResult init() override {
    // TODO(R2): once the model is known, open path_ at baud_ and turn on the driver's serial
    // timeout if it has one, so the motors stop by themselves if the Pi stops talking.
    return {DeviceStatus::FAILED, "driver model and protocol TBD (task R2), " + path_ + " baud " + baud_text()};
  }

  bool ready() const override { return false; }

  bool set_duty(int channel, double duty) override {
    // TODO(R2): encode per the driver's datasheet.
    (void)channel;
    (void)duty;
    return false;
  }

  bool stop_all() override { return false; }

 private:
  std::string baud_text() const { return baud_ > 0 ? std::to_string(baud_) : "TBD"; }

  std::string name_;
  std::string path_;
  int baud_;
};

}  // namespace

std::shared_ptr<IDcDriver> make_dc_driver_tbd(const std::string& name, const std::string& path, int baud) {
  return std::make_shared<DcDriverTbd>(name, path, baud);
}

}  // namespace robot
