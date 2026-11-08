#pragma once

// Saves the camera frame the perception service's terrain model looks at (robot.md 7b.5).
// Only with terrain.camera_hint.enabled. While the robot moves, every
// terrain.camera_hint.frame_every_s it writes the newest camera frame, downscaled, as JPEG to
// <media_dir>/terrain_hint.jpg: first to a temporary file, then renamed, so the bridge never reads
// half a frame. The file's modification time is set to when the camera captured the frame, and the
// bridge sends that time as observed_at, so the hint that comes back is aged from the capture.
//
// It is its own Worker because JPEG encoding and file I/O must never run on the main loop.
// If the camera has no new frame, or the robot is still, it writes nothing.

#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "core/worker.hpp"
#include "hal/camera.hpp"

namespace robot {

struct TerrainFrameConfig {
  std::string path;           // <media_dir>/terrain_hint.jpg
  double every_s = 1.0;       // terrain.camera_hint.frame_every_s
  int max_width = 320;        // downscaled by a whole factor until it fits
  int jpeg_quality = 80;
};

// Box-downscales by a whole factor until the width is at most max_width; Rgb888 stays RGB.
// Returns the pixels, tightly packed, and sets width, height, and channels (1 or 3).
std::vector<std::uint8_t> downscale_frame(const Frame& frame, int max_width, int* width, int* height, int* channels);

// Writes the frame as JPEG to `path` through `path`.tmp and a rename, with the file's
// modification time set to `captured_wall`. Returns an error text, or empty on success.
std::string write_terrain_frame(const Frame& frame, const TerrainFrameConfig& config,
                                std::chrono::system_clock::time_point captured_wall);

class TerrainFrameWriter : public Worker {
 public:
  TerrainFrameWriter(std::shared_ptr<ICamera> camera, TerrainFrameConfig config);
  ~TerrainFrameWriter() override;
  void set_moving(bool moving) { moving_ = moving; }
  std::uint64_t frames_written() const { return written_; }

 protected:
  void step(SteadyTime now) override;

 private:
  std::shared_ptr<ICamera> camera_;
  TerrainFrameConfig config_;
  std::atomic<bool> moving_{false};
  std::atomic<std::uint64_t> written_{0};
  std::uint64_t last_seq_ = 0;
  bool logged_error_ = false;
};

}  // namespace robot
