#include "hal/pico_text_protocol.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace robot {

namespace {

constexpr float kStandardGravity = 9.80665f;  // ImuSample is in m/s^2, the firmware sends g
constexpr std::size_t kMaxLine = 16384;        // a THM line is about 4 KB
constexpr int kThermalWidth = 32;
constexpr int kThermalHeight = 24;
constexpr int kLd19PacketBytes = 47;
constexpr int kLd19PointsPerPacket = 12;

bool starts_with(const std::string& s, const char* prefix) { return s.rfind(prefix, 0) == 0; }

int hex_nibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

std::uint16_t u16le(const std::uint8_t* p) { return static_cast<std::uint16_t>(p[0] | (p[1] << 8)); }

// The firmware's device names, mapped to the Pi's (docs/specs/robot.md section 2).
std::string pi_sensor_name(const std::string& pico_name) {
  if (pico_name == "tfluna") return "lidar_single";
  return pico_name;  // imu, thermal, ads1115, ld19 match already
}

}  // namespace

std::int16_t ads_counts_from_volts(float volts) {
  const float counts = std::round(volts / (4.096f / 32768.0f));
  return static_cast<std::int16_t>(std::max(-32768.0f, std::min(32767.0f, counts)));
}

int PicoTextParser::feed(const char* data, std::size_t len, SteadyTime now) {
  int lines = 0;
  for (std::size_t i = 0; i < len; ++i) {
    const char c = data[i];
    if (c == '\n') {
      if (!partial_.empty() && partial_.back() == '\r') partial_.pop_back();
      parse_line(partial_, now);
      partial_.clear();
      ++lines;
    } else if (partial_.size() < kMaxLine) {
      partial_.push_back(c);
    } else {
      partial_.clear();  // runaway line with no newline: drop it and resync on the next one
      ++bad_lines_;
    }
  }
  return lines;
}

void PicoTextParser::parse_line(const std::string& line, SteadyTime now) {
  if (line.size() < 4) return;
  const char* rest = line.c_str() + 4;
  if (starts_with(line, "IMU ")) parse_imu(rest, now);
  else if (starts_with(line, "ADS ")) parse_ads(rest, now);
  else if (starts_with(line, "THM ")) parse_thermal(rest, now);
  else if (starts_with(line, "LDP ")) parse_ld19(rest, now);
  else if (starts_with(line, "TFL ")) parse_tfluna(rest, now);
  else if (starts_with(line, "PONG ")) version_ = line.substr(5);
  else if (starts_with(line, "STATUS")) parse_status(line);
  else if (starts_with(line, "LOG ")) last_log_ = line.substr(4);
}

void PicoTextParser::parse_imu(const char* p, SteadyTime now) {
  unsigned long ms = 0;
  float ax, ay, az, gx, gy, gz, temp;
  if (std::sscanf(p, "%lu %f %f %f %f %f %f %f", &ms, &ax, &ay, &az, &gx, &gy, &gz, &temp) != 8) {
    ++bad_lines_;
    return;
  }
  readings_.imu.write(ImuSample{ax * kStandardGravity, ay * kStandardGravity, az * kStandardGravity, gx, gy, gz},
                      now);
}

void PicoTextParser::parse_ads(const char* p, SteadyTime now) {
  unsigned long ms = 0;
  float v[4];
  if (std::sscanf(p, "%lu %f %f %f %f", &ms, &v[0], &v[1], &v[2], &v[3]) != 5) {
    ++bad_lines_;
    return;
  }
  ForceSample s;
  for (int i = 0; i < 4; ++i) s.raw[static_cast<std::size_t>(i)] = ads_counts_from_volts(v[i]);
  readings_.force.write(s, now);
}

void PicoTextParser::parse_thermal(const char* p, SteadyTime now) {
  char* end = nullptr;
  // <ms> <seq> <ta_c> <min_c> <max_c>, then 768 pixels.
  for (int field = 0; field < 5; ++field) {
    std::strtod(p, &end);
    if (end == p) {
      ++bad_lines_;
      return;
    }
    p = end;
  }
  ThermalFrame frame;
  frame.width = kThermalWidth;
  frame.height = kThermalHeight;
  frame.centi_deg_c.resize(static_cast<std::size_t>(kThermalWidth * kThermalHeight));
  for (auto& px : frame.centi_deg_c) {
    const long tenths = std::strtol(p, &end, 10);
    if (end == p) {
      ++bad_lines_;
      return;
    }
    px = static_cast<std::int16_t>(std::max(-32768L, std::min(32767L, tenths * 10)));
    p = end;
  }
  readings_.thermal.write(frame, now);
}

void PicoTextParser::parse_tfluna(const char* p, SteadyTime now) {
  unsigned long ms = 0;
  unsigned dist_cm = 0, strength = 0;
  float temp = 0;
  if (std::sscanf(p, "%lu %u %u %f", &ms, &dist_cm, &strength, &temp) != 4) {
    ++bad_lines_;
    return;
  }
  LidarSingleSample s;
  s.dist_mm = static_cast<std::uint16_t>(std::min(65535u, dist_cm * 10u));
  s.strength = static_cast<std::uint16_t>(std::min(65535u, strength));
  readings_.lidar_single.write(s, now);
}

// One LD19 packet: 54 2C speed(2) start(2) 12x[dist(2) intensity(1)] end(2) timestamp(2) crc.
// The Pico already checked the CRC, so only the framing bytes are checked here.
void PicoTextParser::parse_ld19(const char* p, SteadyTime now) {
  char* end = nullptr;
  std::strtoul(p, &end, 10);  // <ms>
  if (end == p || *end != ' ') {
    ++bad_lines_;
    return;
  }
  p = end + 1;
  if (std::strlen(p) < 2 * kLd19PacketBytes) {
    ++bad_lines_;
    return;
  }
  std::uint8_t raw[kLd19PacketBytes];
  for (int i = 0; i < kLd19PacketBytes; ++i) {
    const int hi = hex_nibble(p[2 * i]);
    const int lo = hex_nibble(p[2 * i + 1]);
    if (hi < 0 || lo < 0) {
      ++bad_lines_;
      return;
    }
    raw[i] = static_cast<std::uint8_t>((hi << 4) | lo);
  }
  if (raw[0] != 0x54 || raw[1] != 0x2C) {
    ++bad_lines_;
    return;
  }

  const int start = u16le(raw + 4);  // hundredths of a degree
  int stop = u16le(raw + 42);
  if (stop < start) stop += 36000;

  // The scan wrapped past 0 degrees: the points so far are one full revolution.
  if (last_start_cdeg_ >= 0 && start < last_start_cdeg_ && !building_.points.empty()) {
    readings_.ld19.write(building_, now);
    building_.points.clear();
  }
  last_start_cdeg_ = start;

  const double step = static_cast<double>(stop - start) / (kLd19PointsPerPacket - 1);
  for (int i = 0; i < kLd19PointsPerPacket; ++i) {
    const std::uint8_t* pt = raw + 6 + i * 3;
    Ld19Scan::Point point;
    point.angle_cdeg = static_cast<std::uint16_t>(static_cast<int>(std::lround(start + step * i)) % 36000);
    point.dist_mm = u16le(pt);
    point.intensity = pt[2];
    building_.points.push_back(point);
  }
}

// "STATUS imu=OK thermal=OK ads1115=NOT_FOUND tfluna=OK ld19=OK"
void PicoTextParser::parse_status(const std::string& line) {
  std::size_t pos = line.find(' ');
  while (pos != std::string::npos) {
    const std::size_t start = pos + 1;
    pos = line.find(' ', start);
    const std::string item = line.substr(start, pos == std::string::npos ? std::string::npos : pos - start);
    const std::size_t eq = item.find('=');
    if (eq == std::string::npos || eq == 0) continue;
    sensor_states_[pi_sensor_name(item.substr(0, eq))] = item.substr(eq + 1);
  }
  has_status_ = true;
}

}  // namespace robot
