#pragma once

// The vision thread: takes the newest camera frame, runs the detector on it, and publishes the
// result. It always works on the latest frame and drops the ones it was too slow for, so it
// never falls behind. If the model takes 40 ms, it simply runs at about 25 Hz.
//
// Camera (libcamera thread) --LatestSlot<Frame>--> vision thread --LatestSlot<Detections>--> main.

#include <memory>

#include "core/latest_slot.hpp"
#include "core/worker.hpp"
#include "hal/camera.hpp"
#include "vision/detector.hpp"

namespace robot {

class VisionThread : public Worker {
 public:
  // rate_hz caps how often it looks for a new frame (vision.rate_hz).
  VisionThread(std::shared_ptr<ICamera> camera, std::shared_ptr<IDetector> detector, double rate_hz);
  ~VisionThread() override;

  const LatestSlot<Detections>& detections() const { return detections_; }

 protected:
  void step(SteadyTime now) override;

 private:
  std::shared_ptr<ICamera> camera_;
  std::shared_ptr<IDetector> detector_;
  LatestSlot<Detections> detections_;
  std::uint64_t last_seq_ = 0;
};

}  // namespace robot
