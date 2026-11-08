// Real camera through the libcamera C++ API (docs/specs/robot.md section 12.2, task R2).
// Stub: init() reports FAILED.

#include "hal/camera.hpp"

namespace robot {

namespace {

class CameraLibcamera : public ICamera {
 public:
  explicit CameraLibcamera(const CameraConfig& config) : config_(config) {}

  std::string name() const override { return "camera"; }

  InitResult init() override {
#ifdef ROBOT_WITH_LIBCAMERA
    // TODO(R2): CameraManager::start(), take cameras()[0], acquire(), configure a Viewfinder
    // stream at config_.width x config_.height, allocate buffers, connect requestCompleted to a
    // handler that copies the plane into a new Frame and writes frames_, then queue requests.
    // Lock exposure, gain, and white balance before a breathing clip (section 12.2).
    return {DeviceStatus::FAILED, "libcamera capture not written yet (task R2)"};
#else
    return {DeviceStatus::FAILED, "built without libcamera"};
#endif
  }

  const LatestSlot<Frame>& frames() const override { return frames_; }

  void stop() override {
    // TODO(R2): camera->stop(), release(), CameraManager::stop().
  }

 private:
  CameraConfig config_;
  LatestSlot<Frame> frames_;
};

}  // namespace

std::shared_ptr<ICamera> make_camera_libcamera(const CameraConfig& config) {
  return std::make_shared<CameraLibcamera>(config);
}

}  // namespace robot
