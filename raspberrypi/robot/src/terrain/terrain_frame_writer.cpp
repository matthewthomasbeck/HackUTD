#include "terrain/terrain_frame_writer.hpp"

#include <sys/stat.h>
#include <sys/time.h>

#include <cstdio>
#include <cstring>

#include "core/log.hpp"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#pragma GCC diagnostic ignored "-Wunused-parameter"
#pragma GCC diagnostic ignored "-Wsign-compare"
#endif
#include "stb_image_write.h"
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

namespace robot {

std::vector<std::uint8_t> downscale_frame(const Frame& frame, int max_width, int* width, int* height, int* channels) {
  const int ch = frame.format == Frame::Format::Rgb888 ? 3 : 1;
  int factor = 1;
  while (frame.width / factor > max_width) ++factor;
  const int w = frame.width / factor, h = frame.height / factor;
  std::vector<std::uint8_t> out(static_cast<std::size_t>(w) * h * ch);
  const auto& px = *frame.pixels;
  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x) {
      for (int c = 0; c < ch; ++c) {
        int sum = 0;
        for (int dy = 0; dy < factor; ++dy) {
          const std::size_t row = static_cast<std::size_t>(y * factor + dy) * frame.stride;
          for (int dx = 0; dx < factor; ++dx) sum += px[row + static_cast<std::size_t>((x * factor + dx) * ch + c)];
        }
        out[(static_cast<std::size_t>(y) * w + x) * ch + c] = static_cast<std::uint8_t>(sum / (factor * factor));
      }
    }
  }
  *width = w;
  *height = h;
  *channels = ch;
  return out;
}

std::string write_terrain_frame(const Frame& frame, const TerrainFrameConfig& config,
                                std::chrono::system_clock::time_point captured_wall) {
  if (!frame.pixels || frame.width <= 0 || frame.height <= 0) return "empty frame";
  const int ch_needed = frame.format == Frame::Format::Rgb888 ? 3 : 1;
  if (frame.stride < frame.width * ch_needed ||
      frame.pixels->size() < static_cast<std::size_t>(frame.stride) * static_cast<std::size_t>(frame.height)) {
    return "frame buffer smaller than its size";
  }
  int w = 0, h = 0, ch = 0;
  const auto pixels = downscale_frame(frame, config.max_width, &w, &h, &ch);
  const std::string tmp = config.path + ".tmp";
  if (!stbi_write_jpg(tmp.c_str(), w, h, ch, pixels.data(), config.jpeg_quality)) {
    return "cannot write " + tmp;
  }
  // The capture time, to the microsecond, as the file's modification time.
  const auto us = std::chrono::duration_cast<std::chrono::microseconds>(captured_wall.time_since_epoch()).count();
  struct timeval times[2];
  times[0].tv_sec = times[1].tv_sec = static_cast<time_t>(us / 1000000);
  times[0].tv_usec = times[1].tv_usec = static_cast<suseconds_t>(us % 1000000);
  if (utimes(tmp.c_str(), times) != 0) return std::string("cannot set the time of ") + tmp + ": " + std::strerror(errno);
  if (std::rename(tmp.c_str(), config.path.c_str()) != 0) {
    return "cannot rename to " + config.path + ": " + std::strerror(errno);
  }
  return "";
}

TerrainFrameWriter::TerrainFrameWriter(std::shared_ptr<ICamera> camera, TerrainFrameConfig config)
    : Worker("terrain_frames", 1.0 / config.every_s), camera_(std::move(camera)), config_(std::move(config)) {}

TerrainFrameWriter::~TerrainFrameWriter() {
  request_stop();
  join();
}

void TerrainFrameWriter::step(SteadyTime now) {
  if (!moving_) return;
  const auto sample = camera_->frames().read();
  if (!sample || sample->value.seq == last_seq_) return;
  last_seq_ = sample->value.seq;
  // Wall time of the capture: now on the wall clock, minus how long ago the camera took it.
  const auto captured_wall = std::chrono::system_clock::now() -
                             std::chrono::duration_cast<std::chrono::system_clock::duration>(now - sample->value.captured);
  const std::string error = write_terrain_frame(sample->value, config_, captured_wall);
  if (!error.empty()) {
    if (!logged_error_) log::warn("terrain frames: " + error);  // once, not every second
    logged_error_ = true;
    return;
  }
  logged_error_ = false;
  ++written_;
}

}  // namespace robot
