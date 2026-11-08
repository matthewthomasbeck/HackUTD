#include "vision/vision_thread.hpp"

#include <chrono>

namespace drone {

VisionThread::VisionThread(std::shared_ptr<ICamera> camera, std::shared_ptr<IDetector> detector, double rate_hz)
    : Worker("vision", rate_hz), camera_(std::move(camera)), detector_(std::move(detector)) {}

VisionThread::~VisionThread() {
  request_stop();
  join();
}

void VisionThread::step(SteadyTime now) {
  // Idle until the detector's init (model on the TPU) has succeeded.
  if (!camera_ || !detector_ || !detector_->ready()) return;

  const auto frame = camera_->frames().read();
  if (!frame || frame->value.seq == last_seq_) return;  // no new frame since last time
  last_seq_ = frame->value.seq;

  const auto t0 = std::chrono::steady_clock::now();
  Detections out;
  out.items = detector_->detect(frame->value);
  out.inference_ms = ms_between(t0, std::chrono::steady_clock::now());
  out.frame_seq = frame->value.seq;
  out.captured = frame->value.captured;
  detections_.write(out, now);
}

}  // namespace drone
