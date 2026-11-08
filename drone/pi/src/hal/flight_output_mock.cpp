#include <atomic>
#include <mutex>

#include "hal/flight_output.hpp"

namespace drone {

namespace {

class FlightOutputMock : public IFlightOutputMock {
 public:
  std::string name() const override { return "flight_output"; }

  InitResult init() override {
    ready_ = true;
    return {DeviceStatus::OK, "mock"};
  }

  bool ready() const override { return ready_; }

  bool apply(const MotionCommand& command) override {
    std::lock_guard<std::mutex> lock(mutex_);
    last_ = command;
    return true;
  }

  bool stop() override { return apply(MotionCommand::stop()); }

  std::optional<MotionCommand> last() const override {
    std::lock_guard<std::mutex> lock(mutex_);
    return last_;
  }

 private:
  std::atomic<bool> ready_{false};
  mutable std::mutex mutex_;
  std::optional<MotionCommand> last_;
};

}  // namespace

std::shared_ptr<IFlightOutputMock> make_flight_output_mock() { return std::make_shared<FlightOutputMock>(); }

}  // namespace drone
