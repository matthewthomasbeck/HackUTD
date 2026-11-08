#pragma once

// ICamera: the drone's camera, captured with the libcamera C++ API like the dog's CSI camera.
// Which camera the drone carries, and whether it is on the Pi at all, is TBD.
// libcamera delivers finished frames on its own internal thread; the camera writes each one into
// a LatestSlot<Frame>. The main thread reads the frame age, and the vision thread reads the frame.
// No extra capture thread of ours is needed for the real camera.

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "core/latest_slot.hpp"
#include "hal/device.hpp"

namespace drone {

struct Frame {
  enum class Format { Gray8, Rgb888 };

  std::uint64_t seq = 0;  // increases by one per captured frame; the vision thread skips repeats
  SteadyTime captured{};
  int width = 0;
  int height = 0;
  int stride = 0;  // bytes per row
  Format format = Format::Gray8;
  // Shared and immutable, so copying a Frame out of the slot copies a pointer, not the image.
  std::shared_ptr<const std::vector<std::uint8_t>> pixels;
};

struct CameraConfig {
  int width = 640;   // camera.width, TBD
  int height = 480;  // camera.height, TBD
  double fps = 30;   // camera.fps, TBD
};

class ICamera : public IDevice {
 public:
  // init() opens the camera and starts streaming into frames().
  virtual const LatestSlot<Frame>& frames() const = 0;
  virtual void stop() = 0;
};

// Real camera through libcamera. Stub, as on the dog.
std::shared_ptr<ICamera> make_camera_libcamera(const CameraConfig& config);

class MockControls;
// Synthetic gray frames at config.fps on a small thread of its own. `dronectl mock stale camera on`
// pauses it, so the frame goes stale.
std::shared_ptr<ICamera> make_camera_mock(const CameraConfig& config, std::shared_ptr<MockControls> controls);

}  // namespace drone
