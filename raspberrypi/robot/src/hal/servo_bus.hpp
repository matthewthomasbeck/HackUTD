#pragma once

// IServoBus: one Pololu Maestro (Maestro A drives the 12 leg servos, Maestro B the 25 kg servos).
// Only the movement thread calls these. Writes are quick UART writes, but they still never
// happen on the main thread.
// Channel map, pulse limits, and baud rate are TBD (docs/specs/robot.md section 15.1); the
// safety limits on targets are applied before these calls, never inside them.

#include <cstdint>
#include <memory>
#include <optional>
#include <string>

#include "hal/device.hpp"

namespace robot {

class IServoBus : public IDevice {
 public:
  // True after init() returned OK or DEGRADED. The movement thread skips a bus that is not ready.
  virtual bool ready() const = 0;
  // Pulse width target for one channel, in microseconds.
  virtual bool set_target_us(int channel, double pulse_us) = 0;
  // Stop sending pulses on every channel (target 0), so the servos go limp.
  virtual bool release_all() = 0;
  // Bring-up checks (robot_diag ping); empty if the board does not answer.
  // Position = the pulse the Maestro is sending on that channel now, in microseconds (0 = no pulses).
  virtual std::optional<double> get_position_us(int channel) {
    (void)channel;
    return std::nullopt;
  }
  // Maestro error flags (0 = none); reading them clears them on the board.
  virtual std::optional<int> get_errors() { return std::nullopt; }
};

// Real Maestro over UART, Pololu compact protocol. Stub until task R2.
std::shared_ptr<IServoBus> make_servo_maestro(const std::string& name, const std::string& path, int baud);
// Records targets, moves nothing.
std::shared_ptr<IServoBus> make_servo_mock(const std::string& name);

}  // namespace robot
