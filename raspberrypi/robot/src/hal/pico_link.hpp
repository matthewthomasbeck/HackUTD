#pragma once

// IPicoLink: the Pi side of the USB serial link to the Pico. The Pico reads every sensor as fast
// as it can and streams parsed values to the Pi (docs/ROBOT.md "Pi to Pico protocol").
//
// The main thread calls poll() once per tick. poll() reads only the bytes already waiting
// (non-blocking), parses whole frames into the sensor slots below, sends a heartbeat when one is
// due, and returns. Half a frame stays buffered for the next tick. It never waits on the Pico.
// Frame format and message ids are PROPOSED in docs/specs/robot.md section 12.1 (protocol/ is Camille's).

#include <array>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "core/latest_slot.hpp"
#include "hal/device.hpp"

namespace robot {

struct ImuSample {
  float ax = 0, ay = 0, az = 0;  // m/s^2, axes TBD by model and mounting
  float gx = 0, gy = 0, gz = 0;  // deg/s
};

struct ThermalFrame {
  int width = 0;
  int height = 0;
  std::vector<std::int16_t> centi_deg_c;  // row-major, hundredths of a degree C
};

struct ForceSample {
  std::array<std::int16_t, 4> raw{};  // ADS1115 A0..A3, the four FSRs; meaning TBD
};

struct LidarSingleSample {
  std::uint16_t dist_mm = 0;
  std::uint16_t strength = 0;
};

struct Ld19Scan {
  struct Point {
    std::uint16_t angle_cdeg = 0;
    std::uint16_t dist_mm = 0;
    std::uint8_t intensity = 0;
  };
  std::vector<Point> points;  // one revolution
};

// Newest value of each Pico sensor, stamped with Pi steady time when parsed.
struct PicoReadings {
  LatestSlot<ImuSample> imu;
  LatestSlot<ThermalFrame> thermal;
  LatestSlot<ForceSample> force;  // the ads1115 device
  LatestSlot<LidarSingleSample> lidar_single;
  LatestSlot<Ld19Scan> ld19;
};

struct PicoLinkConfig {
  std::string path = "/dev/pico";
  int heartbeat_hz = 20;       // pico.heartbeat_hz, TBD
  int link_timeout_ms = 250;   // pico.link_timeout_ms, TBD
};

class IPicoLink : public IDevice {
 public:
  // init(): open the port, HELLO/VERSION handshake (a version mismatch is FAILED).
  virtual void poll(SteadyTime now) = 0;
  // Age of the last heartbeat from the Pico; empty if none yet.
  virtual std::optional<double> heartbeat_age_ms(SteadyTime now) const = 0;
  virtual const PicoReadings& readings() const = 0;
  // Age of one sensor's newest reading by device name (imu, thermal, ads1115, lidar_single, ld19).
  std::optional<double> sensor_age_ms(const std::string& sensor, SteadyTime now) const;
};

// Real link over /dev/pico. Stub until tasks R2 and R4.
std::shared_ptr<IPicoLink> make_pico_link_serial(const PicoLinkConfig& config);

class MockControls;
// Fresh heartbeat and synthetic readings every poll, unless a `robotctl mock` knob says otherwise
// (pico_link lost stops the heartbeat; stale <sensor> stops that sensor's updates).
std::shared_ptr<IPicoLink> make_pico_link_mock(std::shared_ptr<MockControls> controls);

}  // namespace robot
