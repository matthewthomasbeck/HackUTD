#pragma once

// Warm-blob detector for the thermal camera (docs/specs/robot.md section 7, task R6).
// Explainable rules, no learning:
//   7.1 per frame: mask, background = median, hot = background + delta_c and inside min_c..max_c,
//       4-connected blobs (iterative flood fill), size check
//   7.2 a blob is a candidate once it shows in persist_frames of the last persist_window frames,
//       within persist_px of where it was
//   7.3 bearing_offset_deg = (centroid_col + 0.5 - w / 2) * (fov_h_deg / w), positive to the right
// It never claims a person: it reports a warm, person-sized shape with a confidence (7.4).

#include <array>
#include <deque>
#include <optional>
#include <vector>

#include "hal/pico_link.hpp"

namespace robot {

struct ThermalConfig {
  double fov_h_deg = 55;      // thermal.fov_h_deg, TBD by lens
  double yaw_offset_deg = 0;  // camera mounted turned this far right of straight ahead
  bool flip_x = false;        // thermal.flip_x: the sensor's columns run right to left (TBD on the robot)
  double delta_c = 4.0;       // hot = this far above the frame's median
  double min_c = 25.0;        // TBD from the range test (section 7.5)
  double max_c = 45.0;
  int min_blob_px = 3;
  double max_blob_frac = 0.5;
  int persist_frames = 3;
  int persist_window = 5;
  double persist_px = 2;
  double contrast_full_c = 6;
  std::vector<std::array<int, 4>> mask;  // [col0, row0, col1, row1], inclusive
};

struct ThermalBlob {
  double col = 0, row = 0;  // centroid, in pixels
  int area = 0;             // pixels
  int width = 0, height = 0;
  double max_c = 0, mean_c = 0, contrast_c = 0;  // contrast = max - background
};

struct ThermalCandidate {
  ThermalBlob blob;
  double bearing_deg = 0;   // positive to the right
  double area_frac = 0;     // of the whole frame: grows as the robot gets closer
  double confidence = 0;    // 0.3..1, section 7.4 without the LiDAR size term
};

// 7.1: every blob that passes the size check, biggest contrast first.
std::vector<ThermalBlob> find_blobs(const ThermalFrame& frame, const ThermalConfig& cfg, double* background_c = nullptr);

// 7.3
double blob_bearing_deg(double centroid_col, int width, const ThermalConfig& cfg);

// 7.2: feed every new frame; returns every confirmed candidate (strongest contrast first).
// Choosing which one to go to (the closest) is the behavior's job, with the LD19.
class ThermalTracker {
 public:
  explicit ThermalTracker(ThermalConfig cfg) : cfg_(std::move(cfg)) {}
  std::vector<ThermalCandidate> update(const ThermalFrame& frame);
  void reset() { history_.clear(); }

 private:
  ThermalConfig cfg_;
  std::deque<std::vector<ThermalBlob>> history_;  // the last persist_window frames' blobs
};

}  // namespace robot
