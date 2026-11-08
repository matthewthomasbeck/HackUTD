#pragma once

// Parser for the text lines the drone MCU firmware in drone/mcu/ sends (drone/mcu/README.md,
// firmware 0.1). It is the dog's Pico text protocol (pico/README.md) with the dog's sensors taken
// out and one HB line added, so the link has a heartbeat even when no sensor is streaming.
//
// Lines handled (one per packet, <ms> is the MCU uptime):
//   HB <ms>                                                      heartbeat, mcu.heartbeat_hz
//   IMU <ms> <ax_g> <ay_g> <az_g> <gx_dps> <gy_dps> <gz_dps> <temp_c>
//   PONG <version>, STATUS <name>=<state> ..., LOG <ms> <text>
// Anything else (command replies, the boot report, a half line) is ignored.

#include <cstdint>
#include <map>
#include <optional>
#include <string>

#include "hal/mcu_link.hpp"

namespace drone {

class McuTextParser {
 public:
  explicit McuTextParser(McuReadings& readings) : readings_(readings) {}

  // Feed raw bytes as they arrive. Whole lines are parsed at once; a partial line waits for the
  // next call. Returns the number of whole lines seen (any kind), which the link uses as its
  // heartbeat: the MCU sends HB at mcu.heartbeat_hz while streaming, so a silent link means a lost MCU.
  int feed(const char* data, std::size_t len, SteadyTime now);

  // Parse one complete line (without the newline). Public for tests.
  void parse_line(const std::string& line, SteadyTime now);

  std::optional<std::string> version() const { return version_; }
  // Sensor states from the last STATUS line, keyed by the Pi's device names (imu),
  // for example "OK", "NOT_FOUND", "ERROR".
  const std::map<std::string, std::string>& sensor_states() const { return sensor_states_; }
  bool has_status() const { return has_status_; }
  const std::string& last_log() const { return last_log_; }
  std::uint64_t heartbeats() const { return heartbeats_; }
  std::uint64_t bad_lines() const { return bad_lines_; }

 private:
  void parse_heartbeat(const char* p);
  void parse_imu(const char* p, SteadyTime now);
  void parse_status(const std::string& line);

  McuReadings& readings_;
  std::string partial_;
  std::optional<std::string> version_;
  std::map<std::string, std::string> sensor_states_;
  bool has_status_ = false;
  std::string last_log_;
  std::uint64_t heartbeats_ = 0;
  std::uint64_t bad_lines_ = 0;
};

}  // namespace drone
