#pragma once

// Time source for the drone. The main loop uses SteadyClock; tests use FakeClock so they
// can step time forward by exact amounts without sleeping.
// Steady time never jumps when the Pi syncs its wall clock, so it is safe for ages and timeouts.

#include <chrono>

namespace drone {

using SteadyTime = std::chrono::steady_clock::time_point;
using Millis = std::chrono::milliseconds;

// Milliseconds from `earlier` to `later`, as a double (ages and timeouts are compared in ms).
inline double ms_between(SteadyTime earlier, SteadyTime later) {
  return std::chrono::duration<double, std::milli>(later - earlier).count();
}

class Clock {
 public:
  virtual ~Clock() = default;
  virtual SteadyTime now() const = 0;
};

class SteadyClock : public Clock {
 public:
  SteadyTime now() const override { return std::chrono::steady_clock::now(); }
};

class FakeClock : public Clock {
 public:
  SteadyTime now() const override { return now_; }
  void advance(Millis d) { now_ += d; }

 private:
  SteadyTime now_{};
};

}  // namespace drone
