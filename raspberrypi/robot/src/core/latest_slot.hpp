#pragma once

// LatestSlot<T>: the newest value of one sensor plus the time it was written.
// Reader threads (Pico link, camera, GPS) write; the main loop reads once per tick.
// It is a slot, not a queue: old values are overwritten, so stale data never piles up
// (docs/ROBOT.md "Threading model on the Pi").

#include <mutex>
#include <optional>

#include "core/clock.hpp"

namespace robot {

template <typename T>
class LatestSlot {
 public:
  struct Sample {
    T value;
    SteadyTime written;
  };

  void write(const T& value, SteadyTime now) {
    std::lock_guard<std::mutex> lock(mutex_);
    sample_ = Sample{value, now};
  }

  // Empty until the first write.
  std::optional<Sample> read() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return sample_;
  }

  // Age in ms at `now`, or empty if nothing was ever written.
  std::optional<double> age_ms(SteadyTime now) const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!sample_) return std::nullopt;
    return ms_between(sample_->written, now);
  }

 private:
  mutable std::mutex mutex_;
  std::optional<Sample> sample_;
};

}  // namespace robot
