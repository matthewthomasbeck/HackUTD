#include <atomic>

#include "vision/detector.hpp"

namespace drone {

namespace {

class DetectorMock : public IDetector {
 public:
  std::string name() const override { return "detector"; }

  InitResult init() override {
    ready_ = true;
    return {DeviceStatus::OK, "mock"};
  }

  bool ready() const override { return ready_; }

  std::vector<Detection> detect(const Frame&) override { return {}; }

 private:
  std::atomic<bool> ready_{false};
};

}  // namespace

std::shared_ptr<IDetector> make_detector_mock() { return std::make_shared<DetectorMock>(); }

}  // namespace drone
