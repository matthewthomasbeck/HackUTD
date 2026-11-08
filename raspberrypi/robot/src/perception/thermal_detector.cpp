#include "perception/thermal_detector.hpp"

#include <algorithm>
#include <cmath>

namespace robot {

namespace {

bool masked(int col, int row, const ThermalConfig& cfg) {
  for (const auto& m : cfg.mask) {
    if (col >= m[0] && col <= m[2] && row >= m[1] && row <= m[3]) return true;
  }
  return false;
}

double clamp01(double v) { return std::max(0.0, std::min(1.0, v)); }

}  // namespace

std::vector<ThermalBlob> find_blobs(const ThermalFrame& frame, const ThermalConfig& cfg, double* background_c) {
  const int w = frame.width, h = frame.height;
  std::vector<ThermalBlob> blobs;
  if (w <= 0 || h <= 0 || static_cast<int>(frame.centi_deg_c.size()) != w * h) return blobs;

  auto temp = [&](int i) { return frame.centi_deg_c[static_cast<std::size_t>(i)] / 100.0; };

  // 1-2. Background = median of the unmasked pixels (robust while the robot moves).
  std::vector<double> values;
  values.reserve(static_cast<std::size_t>(w * h));
  for (int i = 0; i < w * h; ++i)
    if (!masked(i % w, i / w, cfg)) values.push_back(temp(i));
  if (values.empty()) return blobs;
  std::nth_element(values.begin(), values.begin() + static_cast<long>(values.size() / 2), values.end());
  const double bg = values[values.size() / 2];
  if (background_c) *background_c = bg;

  // 3. Hot pixels.
  std::vector<char> hot(static_cast<std::size_t>(w * h), 0);
  for (int i = 0; i < w * h; ++i) {
    const double t = temp(i);
    hot[static_cast<std::size_t>(i)] =
        !masked(i % w, i / w, cfg) && t >= bg + cfg.delta_c && t >= cfg.min_c && t <= cfg.max_c;
  }

  // 4. 4-connected components with an explicit stack (iterative, no recursion).
  std::vector<char> seen(static_cast<std::size_t>(w * h), 0);
  std::vector<int> stack;
  for (int start = 0; start < w * h; ++start) {
    if (!hot[static_cast<std::size_t>(start)] || seen[static_cast<std::size_t>(start)]) continue;
    ThermalBlob b;
    double sum_c = 0, sum_col = 0, sum_row = 0;
    int c0 = w, c1 = -1, r0 = h, r1 = -1;
    stack.assign(1, start);
    seen[static_cast<std::size_t>(start)] = 1;
    while (!stack.empty()) {
      const int i = stack.back();
      stack.pop_back();
      const int col = i % w, row = i / w;
      const double t = temp(i);
      ++b.area;
      sum_c += t;
      sum_col += col;
      sum_row += row;
      b.max_c = std::max(b.max_c, t);
      c0 = std::min(c0, col); c1 = std::max(c1, col);
      r0 = std::min(r0, row); r1 = std::max(r1, row);
      const int nbr[4][2] = {{col - 1, row}, {col + 1, row}, {col, row - 1}, {col, row + 1}};
      for (const auto& n : nbr) {
        if (n[0] < 0 || n[0] >= w || n[1] < 0 || n[1] >= h) continue;
        const int j = n[1] * w + n[0];
        if (hot[static_cast<std::size_t>(j)] && !seen[static_cast<std::size_t>(j)]) {
          seen[static_cast<std::size_t>(j)] = 1;
          stack.push_back(j);
        }
      }
    }
    // 5. Size check (the LiDAR width check of 7.1 step 5 needs the sensors aligned: TBD).
    if (b.area < cfg.min_blob_px || b.area > cfg.max_blob_frac * w * h) continue;
    b.col = sum_col / b.area;
    b.row = sum_row / b.area;
    b.width = c1 - c0 + 1;
    b.height = r1 - r0 + 1;
    b.mean_c = sum_c / b.area;
    b.contrast_c = b.max_c - bg;
    blobs.push_back(b);
  }
  std::sort(blobs.begin(), blobs.end(), [](const ThermalBlob& a, const ThermalBlob& b) { return a.contrast_c > b.contrast_c; });
  return blobs;
}

double blob_bearing_deg(double centroid_col, int width, const ThermalConfig& cfg) {
  double offset = (centroid_col + 0.5 - width / 2.0) * (cfg.fov_h_deg / width);
  if (cfg.flip_x) offset = -offset;
  return offset + cfg.yaw_offset_deg;
}

std::vector<ThermalCandidate> ThermalTracker::update(const ThermalFrame& frame) {
  history_.push_back(find_blobs(frame, cfg_));
  while (static_cast<int>(history_.size()) > cfg_.persist_window) history_.pop_front();
  std::vector<ThermalCandidate> out;

  // Every blob of this frame that also showed up, near the same place, in enough recent frames.
  for (const ThermalBlob& b : history_.back()) {
    int hits = 0;
    for (const auto& frame_blobs : history_) {
      for (const ThermalBlob& other : frame_blobs) {
        if (std::hypot(other.col - b.col, other.row - b.row) <= cfg_.persist_px) {
          ++hits;
          break;
        }
      }
    }
    if (hits < cfg_.persist_frames) continue;
    ThermalCandidate c;
    c.blob = b;
    c.bearing_deg = blob_bearing_deg(b.col, frame.width, cfg_);
    c.area_frac = static_cast<double>(b.area) / (frame.width * frame.height);
    const double c_contrast = clamp01((b.contrast_c - cfg_.delta_c) / cfg_.contrast_full_c);
    const double c_size = 0.5;  // no LiDAR size term until the sensors are aligned (7.4)
    const double c_persist = static_cast<double>(hits) / cfg_.persist_window;
    c.confidence = 0.3 + 0.7 * (0.4 * c_contrast + 0.3 * c_size + 0.3 * c_persist);
    out.push_back(c);
  }
  return out;
}

}  // namespace robot
