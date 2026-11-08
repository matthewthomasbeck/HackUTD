#pragma once

// Results of the on-robot camera model, produced by the vision thread and read by the main thread.
// Plain data, so the WorldSnapshot can carry it without depending on OpenCV or the Coral runtime.

#include <cstdint>
#include <string>
#include <vector>

#include "core/clock.hpp"

namespace robot {

struct Detection {
  int class_id = -1;
  std::string label;
  float score = 0;  // 0 to 1
  // Box in normalized image coordinates (0 to 1), origin top left.
  float x = 0;
  float y = 0;
  float w = 0;
  float h = 0;
};

struct Detections {
  std::uint64_t frame_seq = 0;  // which camera frame these came from
  SteadyTime captured{};        // when that frame was captured (age = now - captured)
  double inference_ms = 0;      // time spent in the model, for tuning
  std::vector<Detection> items;
};

}  // namespace robot
