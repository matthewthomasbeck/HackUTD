// Real Pico link over USB serial (tasks R2 and R4).
//
// Speaks the text lines of the firmware in pico/ (hal/pico_text_protocol.hpp), because that is what
// is flashed today. The binary frames in docs/ROBOT.md are still PROPOSED.
//
// init() (on the init thread, may block for a few seconds):
//   open the port raw and non-blocking, PING until PONG <version> arrives (the Pico ignores
//   commands while it is still checking its sensors at boot), FAILED on a version mismatch,
//   then STATUS for the per-sensor states, then STREAM 1.
// poll() (on the main thread, never blocks):
//   read what is waiting, parse whole lines into the readings, and treat any line as the
//   heartbeat. The firmware has no HEARTBEAT message yet, but it streams at 50 Hz or more.
//   If a sensor the Pico said was OK goes quiet, send STREAM 1 again (at most every 2 s):
//   that restarts the stream after a Pico reboot without waiting for every sensor to stop.
//
// Threads: the main loop calls poll() every tick, even while init() is still running on the init
// thread. mutex_ guards the port and the parser; poll() only try_locks it, so the main loop skips
// one read instead of waiting. The heartbeat time is atomic because the main loop reads it.

#include <fcntl.h>
#include <termios.h>
#include <unistd.h>

#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <mutex>
#include <thread>

#include "hal/pico_link.hpp"
#include "hal/pico_text_protocol.hpp"

namespace robot {

std::optional<double> IPicoLink::sensor_age_ms(const std::string& sensor, SteadyTime now) const {
  const PicoReadings& r = readings();
  if (sensor == "imu") return r.imu.age_ms(now);
  if (sensor == "thermal") return r.thermal.age_ms(now);
  if (sensor == "ads1115") return r.force.age_ms(now);
  if (sensor == "lidar_single") return r.lidar_single.age_ms(now);
  if (sensor == "ld19") return r.ld19.age_ms(now);
  return std::nullopt;
}

namespace {

using namespace std::chrono_literals;

constexpr double kQuietSensorMs = 2000;     // a reporting sensor silent this long: ask for STREAM 1
constexpr double kStreamRetryMs = 2000;     // and not more often than this
constexpr auto kPingTimeout = 2500ms;       // stays under init.device_timeout_ms (3000)
constexpr const char* kSensors[] = {"imu", "thermal", "ads1115", "lidar_single", "ld19"};

class PicoLinkSerial : public IPicoLink {
 public:
  explicit PicoLinkSerial(PicoLinkConfig config) : config_(std::move(config)), parser_(readings_) {}

  ~PicoLinkSerial() override {
    std::lock_guard<std::mutex> lock(mutex_);
    if (fd_ >= 0) {
      write_line("STREAM 0");
      ::close(fd_);
    }
  }

  std::string name() const override { return "pico"; }

  InitResult init() override {
    std::lock_guard<std::mutex> lock(mutex_);
    if (fd_ >= 0) ::close(fd_);
    fd_ = ::open(config_.path.c_str(), O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (fd_ < 0) return {DeviceStatus::FAILED, "cannot open " + config_.path + ": " + std::strerror(errno)};
    termios tty{};
    if (tcgetattr(fd_, &tty) != 0) return close_with("tcgetattr failed on " + config_.path);
    cfmakeraw(&tty);
    tty.c_cflag |= (CLOCAL | CREAD);
    tty.c_cc[VMIN] = 0;
    tty.c_cc[VTIME] = 0;
    if (tcsetattr(fd_, TCSANOW, &tty) != 0) return close_with("tcsetattr failed on " + config_.path);
    tcflush(fd_, TCIOFLUSH);

    // Handshake: PING every 250 ms until PONG, because a Pico that just booted ignores commands
    // for a few seconds while it checks its sensors.
    const auto deadline = std::chrono::steady_clock::now() + kPingTimeout;
    auto next_ping = std::chrono::steady_clock::now();
    bool status_asked = false;
    while (std::chrono::steady_clock::now() < deadline) {
      const auto now = std::chrono::steady_clock::now();
      if (!parser_.version() && now >= next_ping) {
        write_line("PING");
        next_ping = now + 250ms;
      }
      if (parser_.version() && !status_asked) {
        if (*parser_.version() != config_.firmware_version) {
          return close_with("Pico firmware " + *parser_.version() + ", expected " + config_.firmware_version +
                            " (pico.firmware_version)");
        }
        write_line("STATUS");
        status_asked = true;
      }
      if (parser_.has_status()) break;
      drain(now);
      std::this_thread::sleep_for(10ms);
    }
    if (!parser_.version()) return close_with("no PONG from the Pico on " + config_.path);
    if (!parser_.has_status()) return close_with("no STATUS reply from the Pico");

    write_line("STREAM 1");
    last_stream_request_ = std::chrono::steady_clock::now();
    std::string detail = "firmware " + *parser_.version();
    for (const auto& [sensor, state] : parser_.sensor_states()) detail += ", " + sensor + "=" + state;
    return {DeviceStatus::OK, detail};
  }

  void poll(SteadyTime now) override {
    std::unique_lock<std::mutex> lock(mutex_, std::try_to_lock);
    if (!lock.owns_lock() || fd_ < 0) return;
    drain(now);
    restart_stream_if_quiet(now);
  }

  std::optional<double> heartbeat_age_ms(SteadyTime now) const override {
    const auto rep = last_heartbeat_rep_.load();
    if (rep == kNoHeartbeat) return std::nullopt;
    return ms_between(SteadyTime(SteadyTime::duration(rep)), now);
  }

  const PicoReadings& readings() const override { return readings_; }

  InitResult sensor_status(const std::string& sensor) const override {
    std::lock_guard<std::mutex> lock(mutex_);
    return sensor_status_locked(sensor);
  }

 private:
  InitResult sensor_status_locked(const std::string& sensor) const {
    const auto& states = parser_.sensor_states();
    const auto it = states.find(sensor);
    if (it == states.end()) return {DeviceStatus::FAILED, "Pico did not list " + sensor};
    if (it->second == "OK") return {DeviceStatus::OK, "via Pico"};
    return {DeviceStatus::FAILED, "Pico reports " + sensor + " " + it->second};
  }

  InitResult close_with(const std::string& why) {
    if (fd_ >= 0) ::close(fd_);
    fd_ = -1;
    return {DeviceStatus::FAILED, why};
  }

  void write_line(const char* text) {
    if (fd_ < 0) return;
    char buf[64];
    const int n = std::snprintf(buf, sizeof(buf), "%s\r\n", text);
    // Non-blocking: a full USB buffer drops the command, and the next retry sends it again.
    if (::write(fd_, buf, static_cast<std::size_t>(n)) < 0 && errno != EAGAIN) {
      ++write_errors_;
    }
  }

  // Reads until EAGAIN. Bounded so a flood of bytes can never hold the main loop.
  void drain(SteadyTime now) {
    char chunk[4096];
    for (int i = 0; i < 64; ++i) {
      const ssize_t n = ::read(fd_, chunk, sizeof(chunk));
      if (n <= 0) break;
      if (parser_.feed(chunk, static_cast<std::size_t>(n), now) > 0) {
        last_heartbeat_rep_.store(now.time_since_epoch().count());
      }
    }
  }

  void restart_stream_if_quiet(SteadyTime now) {
    if (ms_between(last_stream_request_, now) < kStreamRetryMs) return;
    for (const char* sensor : kSensors) {
      if (sensor_status_locked(sensor).status != DeviceStatus::OK) continue;  // the Pico never had it
      const auto age = sensor_age_ms(sensor, now);
      const bool quiet = age ? *age > kQuietSensorMs : ms_between(last_stream_request_, now) > kQuietSensorMs;
      if (quiet) {
        write_line("STREAM 1");
        last_stream_request_ = now;
        return;
      }
    }
  }

  PicoLinkConfig config_;
  PicoReadings readings_;
  PicoTextParser parser_;
  static constexpr SteadyTime::rep kNoHeartbeat = SteadyTime::duration::min().count();
  mutable std::mutex mutex_;
  int fd_ = -1;
  std::atomic<SteadyTime::rep> last_heartbeat_rep_{kNoHeartbeat};
  SteadyTime last_stream_request_{};
  std::uint64_t write_errors_ = 0;
};

class PicoSensorDevice : public IDevice {
 public:
  PicoSensorDevice(std::string sensor, std::shared_ptr<IPicoLink> link)
      : sensor_(std::move(sensor)), link_(std::move(link)) {}
  std::string name() const override { return sensor_; }
  InitResult init() override { return link_->sensor_status(sensor_); }

 private:
  std::string sensor_;
  std::shared_ptr<IPicoLink> link_;
};

}  // namespace

std::shared_ptr<IPicoLink> make_pico_link_serial(const PicoLinkConfig& config) {
  return std::make_shared<PicoLinkSerial>(config);
}

std::shared_ptr<IDevice> make_pico_sensor_device(const std::string& sensor, std::shared_ptr<IPicoLink> link) {
  return std::make_shared<PicoSensorDevice>(sensor, std::move(link));
}

}  // namespace robot
