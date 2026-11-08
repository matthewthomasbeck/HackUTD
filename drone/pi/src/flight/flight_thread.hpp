#pragma once

// The flight thread: the only code that writes to the flight output (hal/flight_output.hpp), so the
// main thread never waits on it and the output has exactly one writer. It is the drone's copy of
// the dog's movement thread (motion/movement_thread.hpp), with the mecanum mixer and the leg
// servos taken out and nothing put in their place: it hands the gated request to the output as is.
//
// Main thread -> flight thread: submit() a FlightCommand. It holds a GatedCommand, which only the
// safety gate can create, so nothing reaches the output without passing the gate.
// Flight thread -> main thread: status(), read every tick.
//
// Dead-man rule: if the newest command is older than command_timeout_ms (the main loop hung or
// died), the thread sends stop() to the output on its own.

#include <cstdint>
#include <memory>
#include <optional>

#include "core/latest_slot.hpp"
#include "core/worker.hpp"
#include "hal/flight_output.hpp"
#include "state/safety_gate.hpp"

namespace drone {

struct FlightCommand {
  std::uint64_t seq = 0;  // increases every main tick
  GatedCommand motion;
};

struct FlightStatus {
  std::uint64_t applied_seq = 0;  // last command applied
  bool stopped = true;            // the last applied command was zero (or the dead-man stopped us)
  bool deadman = false;           // no fresh command: stop() sent by the dead-man rule
};

struct FlightConfig {
  double rate_hz = 100;             // flight.rate_hz, TBD
  double command_timeout_ms = 100;  // flight.command_timeout_ms, TBD: several main ticks
};

class FlightThread : public Worker {
 public:
  FlightThread(std::shared_ptr<IFlightOutput> output, FlightConfig config);
  ~FlightThread() override;

  // Main thread side. Never blocks beyond one short lock.
  void submit(const FlightCommand& command, SteadyTime now) { commands_.write(command, now); }
  std::optional<FlightStatus> status() const;

 protected:
  void step(SteadyTime now) override;
  void on_stop() override;

 private:
  void stop_output();

  std::shared_ptr<IFlightOutput> output_;
  FlightConfig config_;
  LatestSlot<FlightCommand> commands_;
  LatestSlot<FlightStatus> status_;
  bool was_deadman_ = true;  // stopped until the first command arrives
};

}  // namespace drone
