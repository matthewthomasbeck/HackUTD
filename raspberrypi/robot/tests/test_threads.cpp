// Thread contracts: the movement dead-man, worker heartbeats, and the vision thread's
// "newest frame only" rule. These use real threads and short real sleeps (well under a second).

#include <atomic>
#include <chrono>
#include <thread>

#include <gtest/gtest.h>

#include "hal/camera.hpp"
#include "hal/dc_driver.hpp"
#include "hal/device_mock.hpp"
#include "motion/movement_thread.hpp"
#include "state/safety_gate.hpp"
#include "vision/vision_thread.hpp"

namespace robot {
namespace {

using namespace std::chrono_literals;

// The only way to get a GatedCommand is through the safety gate, in tests too.
GatedCommand gated_zero() {
  WorldSnapshot w;
  return SafetyGate::filter(State::READY, false, w, BehaviorOutput{}, GateConfig{}, GateMemory{}).motion;
}

Actuators mock_actuators() {
  Actuators a;
  a.dc_a = make_dc_driver_mock("dc_driver_a");
  a.dc_b = make_dc_driver_mock("dc_driver_b");
  a.dc_a->init();
  a.dc_b->init();
  return a;
}

TEST(MovementThread, DeadmanStopsWhenMainIsQuiet) {
  MovementConfig config;
  config.rate_hz = 200;
  config.command_timeout_ms = 50;
  MovementThread movement(mock_actuators(), config);
  movement.start();

  // Main keeps sending: not dead-man.
  for (int i = 1; i <= 10; ++i) {
    movement.submit(MovementCommand{static_cast<std::uint64_t>(i), gated_zero()}, std::chrono::steady_clock::now());
    std::this_thread::sleep_for(10ms);
  }
  auto status = movement.status();
  ASSERT_TRUE(status.has_value());
  EXPECT_FALSE(status->deadman);
  EXPECT_GE(status->applied_seq, 9u);

  // Main goes quiet for longer than the timeout: the thread stops by itself.
  std::this_thread::sleep_for(120ms);
  status = movement.status();
  ASSERT_TRUE(status.has_value());
  EXPECT_TRUE(status->deadman);
  EXPECT_TRUE(status->stopped);
}

class SlowWorker : public Worker {
 public:
  SlowWorker() : Worker("slow", 100) {}
  ~SlowWorker() override {
    request_stop();
    join();
  }
  std::atomic<bool> hang{false};

 protected:
  void step(SteadyTime) override {
    while (hang) std::this_thread::sleep_for(5ms);
  }
};

TEST(Worker, HeartbeatShowsAStuckThread) {
  SlowWorker worker;
  worker.start();
  std::this_thread::sleep_for(50ms);
  EXPECT_LT(worker.heartbeat_age_ms(std::chrono::steady_clock::now()), 40);

  worker.hang = true;
  std::this_thread::sleep_for(150ms);
  EXPECT_GT(worker.heartbeat_age_ms(std::chrono::steady_clock::now()), 100);
  worker.hang = false;
}

// Counts how many frames it was asked to look at.
class CountingDetector : public IDetector {
 public:
  std::string name() const override { return "coral"; }
  InitResult init() override { return {DeviceStatus::OK, "test"}; }
  bool ready() const override { return true; }
  std::vector<Detection> detect(const Frame&) override {
    ++calls;
    return {Detection{0, "person", 0.9f, 0.1f, 0.1f, 0.2f, 0.5f}};
  }
  std::atomic<int> calls{0};
};

TEST(VisionThread, RunsOncePerNewFrameAndPublishes) {
  auto controls = std::make_shared<MockControls>();
  auto camera = make_camera_mock(CameraConfig{64, 48, 20}, controls);  // 20 fps
  auto detector = std::make_shared<CountingDetector>();
  camera->init();
  VisionThread vision(camera, detector, 200);  // polls far faster than frames arrive
  vision.start();
  std::this_thread::sleep_for(300ms);
  vision.request_stop();
  vision.join();
  camera->stop();

  // About 6 frames in 300 ms; polling at 200 Hz must not run the model 60 times.
  EXPECT_GE(detector->calls.load(), 3);
  EXPECT_LE(detector->calls.load(), 8);
  const auto out = vision.detections().read();
  ASSERT_TRUE(out.has_value());
  ASSERT_EQ(out->value.items.size(), 1u);
  EXPECT_EQ(out->value.items[0].label, "person");
  EXPECT_GT(out->value.frame_seq, 0u);
}

}  // namespace
}  // namespace robot
