#include "core/worker.hpp"
#include "hal/camera.hpp"
#include "hal/device_mock.hpp"

namespace robot {

namespace {

// Stands in for libcamera's delivery thread: writes a gray frame at the configured rate.
class MockCapture : public Worker {
 public:
  MockCapture(const CameraConfig& config, std::shared_ptr<MockControls> controls, LatestSlot<Frame>& out)
      : Worker("camera-mock", config.fps), config_(config), controls_(std::move(controls)), out_(out) {}
  ~MockCapture() override {
    request_stop();
    join();
  }

 protected:
  void step(SteadyTime now) override {
    if (controls_->is_stale("camera")) return;
    Frame f;
    f.seq = ++seq_;
    f.captured = now;
    f.width = config_.width;
    f.height = config_.height;
    f.stride = config_.width;
    f.format = Frame::Format::Gray8;
    // A slow brightness change, so later breathing-clip code has something periodic to find.
    const auto level = static_cast<std::uint8_t>(100 + (seq_ % 60));
    f.pixels = std::make_shared<const std::vector<std::uint8_t>>(
        static_cast<std::size_t>(config_.width * config_.height), level);
    out_.write(f, now);
  }

 private:
  CameraConfig config_;
  std::shared_ptr<MockControls> controls_;
  LatestSlot<Frame>& out_;
  std::uint64_t seq_ = 0;
};

class CameraMock : public ICamera {
 public:
  CameraMock(const CameraConfig& config, std::shared_ptr<MockControls> controls)
      : config_(config), controls_(std::move(controls)) {}
  ~CameraMock() override { stop(); }

  std::string name() const override { return "camera"; }

  InitResult init() override {
    if (!capture_) {
      capture_ = std::make_unique<MockCapture>(config_, controls_, frames_);
      capture_->start();
    }
    return {DeviceStatus::OK, "mock"};
  }

  const LatestSlot<Frame>& frames() const override { return frames_; }

  void stop() override { capture_.reset(); }

 private:
  CameraConfig config_;
  std::shared_ptr<MockControls> controls_;
  LatestSlot<Frame> frames_;
  std::unique_ptr<MockCapture> capture_;
};

}  // namespace

std::shared_ptr<ICamera> make_camera_mock(const CameraConfig& config, std::shared_ptr<MockControls> controls) {
  return std::make_shared<CameraMock>(config, std::move(controls));
}

}  // namespace robot
