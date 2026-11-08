#pragma once

// IFlightOutput: where the drone's gated high-level commands end up. It stands where the dog's DC
// drivers and Maestros stand (hal/dc_driver.hpp, hal/servo_bus.hpp), and only the flight thread
// calls it.
//
// There is no real implementation. How the Pi reaches the rotors (an off-the-shelf flight
// controller, ESCs from the MCU, or nothing because the airframe has its own autopilot) is not
// decided, and writing flight control (motor mixing, PID, attitude control) needs a team decision
// first, like motion code on the dog. So `flight_output.mock: false` builds an UnimplementedDevice
// that reports FAILED, and nothing flies. See drone/README.md, open questions.

#include <memory>
#include <optional>
#include <string>

#include "core/commands.hpp"
#include "hal/device.hpp"

namespace drone {

class IFlightOutput : public IDevice {
 public:
  virtual bool ready() const = 0;
  // Hand over one high-level velocity request. Returns false if the output did not take it.
  virtual bool apply(const MotionCommand& command) = 0;
  // Zero velocity request. TODO(flight): what this must do in the air (hover, land, return home)
  // is an open question; the mock only records it.
  virtual bool stop() = 0;
};

// Records the last command in memory, nothing else. `last()` is for tests and the status reply.
class IFlightOutputMock : public IFlightOutput {
 public:
  virtual std::optional<MotionCommand> last() const = 0;
};

std::shared_ptr<IFlightOutputMock> make_flight_output_mock();

// `flight_output.mock: false`: init() reports FAILED and apply() refuses, until the team decides how
// the drone is flown (drone/README.md). Never a place to add motor output without that decision.
std::shared_ptr<IFlightOutput> make_flight_output_unimplemented();

}  // namespace drone
