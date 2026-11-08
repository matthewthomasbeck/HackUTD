// Thread contracts: the flight dead-man, worker heartbeats, and the vision thread's
// "newest frame only" rule. These use real threads and short real sleeps (well under a second).

#include <atomic>
#include <chrono>
#include <thread>

#include <gtest/gtest.h>

#include "flight/flight_thread.hpp"
#include "hal/camera.hpp"
#include "hal/device_mock.hpp"
#include "hal/flight_output.hpp"
#include "state/safety_gate.hpp"
#include "vision/vision_thread.hpp"

namespace drone {
namespace {

using namespace std::chrono_literals;

// The only way to get a GatedCommand is through the safety gate, in tests too.
GatedCommand gated(double vx) {
  WorldSnapshot w;
  w.init_complete = true;
  BehaviorOutput out;
  out.motion.vx_mps = vx;
  GateMemory moving;
  moving.last_sent.vx_mps = vx;  // already at speed, so the acceleration limit leaves it alone
  return SafetyGate::filter(State::ACTIVE, false, w, out, GateConfig{}, moving).motion;
}

TEST(FlightThread, PassesTheGatedCommandToTheOutput) {
  auto output = make_flight_output_mock();
  output->init();
  FlightThread flight(output, FlightConfig{200, 50});
  flight.start();
  for (int i = 1; i <= 5; ++i) {
    flight.submit(FlightCommand{static_cast<std::uint64_t>(i), gated(0.1)}, std::chrono::steady_clock::now());
    std::this_thread::sleep_for(10ms);
  }
  const auto last = output->last();
  ASSERT_TRUE(last.has_value());
  EXPECT_DOUBLE_EQ(last->vx_mps, 0.1);
  const auto status = flight.status();
  ASSERT_TRUE(status.has_value());
  EXPECT_FALSE(status->stopped);
}

TEST(FlightThread, DeadmanStopsWhenMainIsQuiet) {
  auto output = make_flight_output_mock();
  output->init();
  FlightThread flight(output, FlightConfig{200, 50});
  flight.start();

  // Main keeps sending: not dead-man.
  for (int i = 1; i <= 10; ++i) {
    flight.submit(FlightCommand{static_cast<std::uint64_t>(i), gated(0.1)}, std::chrono::steady_clock::now());
    std::this_thread::sleep_for(10ms);
  }
  auto status = flight.status();
  ASSERT_TRUE(status.has_value());
  EXPECT_FALSE(status->deadman);
  EXPECT_GE(status->applied_seq, 9u);

  // Main goes quiet for longer than the timeout: the thread stops by itself.
  std::this_thread::sleep_for(120ms);
  status = flight.status();
  ASSERT_TRUE(status.has_value());
  EXPECT_TRUE(status->deadman);
  EXPECT_TRUE(status->stopped);
  ASSERT_TRUE(output->last().has_value());
  EXPECT_TRUE(output->last()->is_zero());
}

TEST(FlightThread, UnimplementedOutputNeverTakesACommand) {
  auto output = make_flight_output_unimplemented();
  EXPECT_EQ(output->init().status, DeviceStatus::FAILED);
  EXPECT_FALSE(output->ready());
  EXPECT_FALSE(output->apply(MotionCommand{}));
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
  std::string name() const override { return "detector"; }
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
}  // namespace drone
