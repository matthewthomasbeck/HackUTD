#pragma once

// Parser for the text lines the Pico firmware in pico/ sends (pico/README.md, firmware 0.9).
// This is what the flashed firmware speaks today. The binary frames in docs/ROBOT.md
// ("Pi to Pico protocol") are still PROPOSED; when the team moves to them, only this parser and
// pico_link_serial.cpp change, not the readings or anything that uses them.
//
// Lines handled (one per packet, <ms> is the Pico uptime):
//   IMU <ms> <ax_g> <ay_g> <az_g> <gx_dps> <gy_dps> <gz_dps> <temp_c>
//   ADS <ms> <v0> <v1> <v2> <v3>                          volts, A0..A3
//   THM <ms> <seq> <ta_c> <min_c> <max_c> <p0> .. <p767>  tenths of a degree C, 32x24
//   LDP <ms> <94 hex chars>                               one raw LD19 packet (47 bytes)
//   TFL <ms> <dist_cm> <strength> <temp_c>                TF-Luna
//   PONG <version>, STATUS <name>=<state> ..., LOG <ms> <text>
// Anything else (command replies, the boot report, a half line) is ignored.

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "hal/pico_link.hpp"

namespace robot {

class PicoTextParser {
 public:
  explicit PicoTextParser(PicoReadings& readings) : readings_(readings) {}

  // Feed raw bytes as they arrive. Whole lines are parsed at once; a partial line waits for the
  // next call. Returns the number of whole lines seen (any kind), which the link uses as its
  // heartbeat: the Pico streams at 50 Hz or more, so a silent link means a lost Pico.
  int feed(const char* data, std::size_t len, SteadyTime now);

  // Parse one complete line (without the newline). Public for tests.
  void parse_line(const std::string& line, SteadyTime now);

  std::optional<std::string> version() const { return version_; }
  // Sensor states from the last STATUS line, keyed by the Pi's device names
  // (imu, thermal, ads1115, lidar_single, ld19), for example "OK", "NOT_FOUND", "ERROR".
  const std::map<std::string, std::string>& sensor_states() const { return sensor_states_; }
  bool has_status() const { return has_status_; }
  const std::string& last_log() const { return last_log_; }
  std::uint64_t bad_lines() const { return bad_lines_; }

 private:
  void parse_imu(const char* p, SteadyTime now);
  void parse_ads(const char* p, SteadyTime now);
  void parse_thermal(const char* p, SteadyTime now);
  void parse_ld19(const char* p, SteadyTime now);
  void parse_tfluna(const char* p, SteadyTime now);
  void parse_status(const std::string& line);

  PicoReadings& readings_;
  std::string partial_;
  std::optional<std::string> version_;
  std::map<std::string, std::string> sensor_states_;
  bool has_status_ = false;
  std::string last_log_;
  std::uint64_t bad_lines_ = 0;

  // LD19: points collect here until the scan wraps past 0 degrees, then the revolution is
  // published as one Ld19Scan.
  Ld19Scan building_;
  int last_start_cdeg_ = -1;
};

// ADS1115 counts for a voltage at the firmware's +-4.096 V range (pico/src/devices/ads1115.cpp).
std::int16_t ads_counts_from_volts(float volts);

}  // namespace robot
