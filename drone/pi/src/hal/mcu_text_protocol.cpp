#include "hal/mcu_text_protocol.hpp"

#include <cstdio>
#include <cstdlib>

namespace drone {

namespace {

constexpr float kStandardGravity = 9.80665f;  // ImuSample is in m/s^2, the firmware sends g
constexpr std::size_t kMaxLine = 1024;         // the longest line (IMU) is under 100 bytes

bool starts_with(const std::string& s, const char* prefix) { return s.rfind(prefix, 0) == 0; }

}  // namespace

int McuTextParser::feed(const char* data, std::size_t len, SteadyTime now) {
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

void McuTextParser::parse_line(const std::string& line, SteadyTime now) {
  if (starts_with(line, "HB ")) parse_heartbeat(line.c_str() + 3);
  else if (starts_with(line, "IMU ")) parse_imu(line.c_str() + 4, now);
  else if (starts_with(line, "PONG ")) version_ = line.substr(5);
  else if (starts_with(line, "STATUS")) parse_status(line);
  else if (starts_with(line, "LOG ")) last_log_ = line.substr(4);
}

void McuTextParser::parse_heartbeat(const char* p) {
  char* end = nullptr;
  std::strtoul(p, &end, 10);  // <ms>
  if (end == p) {
    ++bad_lines_;
    return;
  }
  ++heartbeats_;
}

void McuTextParser::parse_imu(const char* p, SteadyTime now) {
  unsigned long ms = 0;
  float ax, ay, az, gx, gy, gz, temp;
  if (std::sscanf(p, "%lu %f %f %f %f %f %f %f", &ms, &ax, &ay, &az, &gx, &gy, &gz, &temp) != 8) {
    ++bad_lines_;
    return;
  }
  readings_.imu.write(ImuSample{ax * kStandardGravity, ay * kStandardGravity, az * kStandardGravity, gx, gy, gz},
                      now);
}

// "STATUS imu=NOT_FOUND"
void McuTextParser::parse_status(const std::string& line) {
  std::size_t pos = line.find(' ');
  while (pos != std::string::npos) {
    const std::size_t start = pos + 1;
    pos = line.find(' ', start);
    const std::string item = line.substr(start, pos == std::string::npos ? std::string::npos : pos - start);
    const std::size_t eq = item.find('=');
    if (eq == std::string::npos || eq == 0) continue;
    sensor_states_[item.substr(0, eq)] = item.substr(eq + 1);
  }
  has_status_ = true;
}

}  // namespace drone
