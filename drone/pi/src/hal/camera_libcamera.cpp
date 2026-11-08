// Real camera through the libcamera C++ API (the dog's stub, docs/specs/robot.md section 12.2).
// Stub: init() reports FAILED.

#include "hal/camera.hpp"

namespace drone {

namespace {

class CameraLibcamera : public ICamera {
 public:
  explicit CameraLibcamera(const CameraConfig& config) : config_(config) {}

  std::string name() const override { return "camera"; }

  InitResult init() override {
#ifdef DRONE_WITH_LIBCAMERA
    // TODO(camera): CameraManager::start(), take cameras()[0], acquire(), configure a Viewfinder
    // stream at config_.width x config_.height, allocate buffers, connect requestCompleted to a
    // handler that copies the plane into a new Frame and writes frames_, then queue requests.
    return {DeviceStatus::FAILED, "libcamera capture not written yet"};
#else
    return {DeviceStatus::FAILED, "built without libcamera"};
#endif
  }

  const LatestSlot<Frame>& frames() const override { return frames_; }

  void stop() override {
    // TODO(camera): camera->stop(), release(), CameraManager::stop().
  }

 private:
  CameraConfig config_;
  LatestSlot<Frame> frames_;
};

}  // namespace

std::shared_ptr<ICamera> make_camera_libcamera(const CameraConfig& config) {
  return std::make_shared<CameraLibcamera>(config);
}

}  // namespace drone
