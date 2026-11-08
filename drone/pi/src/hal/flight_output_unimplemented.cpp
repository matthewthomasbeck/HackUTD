// The real flight output, not written on purpose (hal/flight_output.hpp).
//
// TODO(flight): ask the team before writing anything here. Open questions in drone/README.md: which
// airframe and flight controller, whether the Pi talks to it at all (the DJI Mini 4 Pro in the team
// docs has no Pi on board), the link and protocol to it, and what a stop means in the air.

#include "hal/flight_output.hpp"

namespace drone {

namespace {

class FlightOutputUnimplemented : public IFlightOutput {
 public:
  std::string name() const override { return "flight_output"; }
  InitResult init() override { return {DeviceStatus::FAILED, "flight output not written: needs a team decision"}; }
  bool ready() const override { return false; }
  bool apply(const MotionCommand&) override { return false; }
  bool stop() override { return false; }
};

}  // namespace

std::shared_ptr<IFlightOutput> make_flight_output_unimplemented() {
  return std::make_shared<FlightOutputUnimplemented>();
}

}  // namespace drone
