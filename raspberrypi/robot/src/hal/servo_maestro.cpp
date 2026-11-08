// Real Pololu Maestro driver over UART, compact protocol (task R2).
// The Maestro must be in UART mode (docs/ROBOT.md "Electrical rules"); Athena and
// C_Hardware_Testing ran theirs at 9600 baud.
//
// init: open raw at `baud`, send 0xAA so a Maestro in auto-baud mode locks on, then Get Errors
// (0xA1) and expect a 2-byte reply, which proves something is answering. A nonzero error word is
// logged in the detail and cleared by the read, and the bus still comes up.
// set_target_us: Set Target 0x84, channel, target low 7 bits, high 7 bits, in quarter microseconds.
// release_all: target 0 (no pulses, servo goes limp) on every channel this driver has driven.

#include <fcntl.h>
#include <poll.h>
#include <termios.h>
#include <unistd.h>

#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <set>

#include "hal/servo_bus.hpp"

namespace robot {

namespace {

speed_t baud_constant(int baud) {
  switch (baud) {
    case 9600: return B9600;
    case 19200: return B19200;
    case 38400: return B38400;
    case 57600: return B57600;
    case 115200: return B115200;
    default: return 0;
  }
}

class ServoMaestro : public IServoBus {
 public:
  ServoMaestro(std::string name, std::string path, int baud)
      : name_(std::move(name)), path_(std::move(path)), baud_(baud) {}

  ~ServoMaestro() override {
    std::lock_guard<std::mutex> lock(mutex_);
    if (fd_ >= 0) ::close(fd_);
  }

  std::string name() const override { return name_; }

  InitResult init() override {
    std::lock_guard<std::mutex> lock(mutex_);
    ready_ = false;
    if (baud_ <= 0) return {DeviceStatus::FAILED, "baud TBD (" + name_ + ".baud in robot.yaml)"};
    const speed_t speed = baud_constant(baud_);
    if (speed == 0) return {DeviceStatus::FAILED, "unsupported baud " + std::to_string(baud_)};
    if (fd_ >= 0) ::close(fd_);
    fd_ = ::open(path_.c_str(), O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (fd_ < 0) return {DeviceStatus::FAILED, "cannot open " + path_ + ": " + std::strerror(errno)};
    termios tty{};
    if (tcgetattr(fd_, &tty) != 0) return fail("tcgetattr failed on " + path_);
    cfmakeraw(&tty);
    cfsetispeed(&tty, speed);
    cfsetospeed(&tty, speed);
    tty.c_cflag |= (CLOCAL | CREAD);
    tty.c_cc[VMIN] = 0;
    tty.c_cc[VTIME] = 0;
    if (tcsetattr(fd_, TCSANOW, &tty) != 0) return fail("tcsetattr failed on " + path_);
    tcflush(fd_, TCIOFLUSH);

    const unsigned char baud_byte = 0xAA, get_errors = 0xA1;
    if (!write_all(&baud_byte, 1) || !write_all(&get_errors, 1)) return fail("write failed on " + path_);
    unsigned char reply[2];
    if (!read_exact(reply, 2, 300)) {
      return fail("no reply to Get Errors on " + path_ + " (UART mode? baud " + std::to_string(baud_) + "?)");
    }
    const int errors = reply[0] | (reply[1] << 8);
    ready_ = true;
    return {DeviceStatus::OK, path_ + " at " + std::to_string(baud_) +
                                  (errors ? ", cleared error bits 0x" + hex(errors) : std::string())};
  }

  bool ready() const override {
    std::lock_guard<std::mutex> lock(mutex_);
    return ready_;
  }

  bool set_target_us(int channel, double pulse_us) override {
    if (channel < 0 || channel > 23 || pulse_us < 0) return false;
    std::lock_guard<std::mutex> lock(mutex_);
    if (!ready_) return false;
    used_.insert(channel);
    return send_target(channel, static_cast<int>(std::lround(pulse_us * 4)));
  }

  std::optional<double> get_position_us(int channel) override {
    if (channel < 0 || channel > 23) return std::nullopt;
    std::lock_guard<std::mutex> lock(mutex_);
    if (!ready_) return std::nullopt;
    tcflush(fd_, TCIFLUSH);
    const unsigned char cmd[2] = {0x90, static_cast<unsigned char>(channel)};  // Get Position
    unsigned char reply[2];
    if (!write_all(cmd, 2) || !read_exact(reply, 2, 200)) return std::nullopt;
    return (reply[0] | (reply[1] << 8)) / 4.0;  // quarter-microseconds
  }

  std::optional<int> get_errors() override {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!ready_) return std::nullopt;
    tcflush(fd_, TCIFLUSH);
    const unsigned char cmd = 0xA1;  // Get Errors
    unsigned char reply[2];
    if (!write_all(&cmd, 1) || !read_exact(reply, 2, 200)) return std::nullopt;
    return reply[0] | (reply[1] << 8);
  }

  bool release_all() override {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!ready_) return false;
    bool ok = true;
    for (const int ch : used_) ok = send_target(ch, 0) && ok;
    return ok;
  }

 private:
  InitResult fail(const std::string& why) {
    if (fd_ >= 0) ::close(fd_);
    fd_ = -1;
    return {DeviceStatus::FAILED, why};
  }

  bool send_target(int channel, int quarter_us) {
    const unsigned char cmd[4] = {0x84, static_cast<unsigned char>(channel),
                                  static_cast<unsigned char>(quarter_us & 0x7F),
                                  static_cast<unsigned char>((quarter_us >> 7) & 0x7F)};
    return write_all(cmd, sizeof(cmd));
  }

  bool write_all(const unsigned char* p, std::size_t n) {
    std::size_t sent = 0;
    for (int tries = 0; sent < n && tries < 50; ++tries) {
      const ssize_t w = ::write(fd_, p + sent, n - sent);
      if (w > 0) sent += static_cast<std::size_t>(w);
      else if (w < 0 && errno != EAGAIN && errno != EINTR) return false;
      else ::usleep(200);
    }
    return sent == n;
  }

  bool read_exact(unsigned char* p, std::size_t n, int timeout_ms) {
    std::size_t got = 0;
    while (got < n) {
      pollfd pfd{fd_, POLLIN, 0};
      if (::poll(&pfd, 1, timeout_ms) <= 0) return false;
      const ssize_t r = ::read(fd_, p + got, n - got);
      if (r <= 0) return false;
      got += static_cast<std::size_t>(r);
    }
    return true;
  }

  static std::string hex(int v) {
    char buf[8];
    std::snprintf(buf, sizeof(buf), "%04X", v);
    return buf;
  }

  std::string name_;
  std::string path_;
  int baud_;
  mutable std::mutex mutex_;
  int fd_ = -1;
  bool ready_ = false;
  std::set<int> used_;
};

}  // namespace

std::shared_ptr<IServoBus> make_servo_maestro(const std::string& name, const std::string& path, int baud) {
  return std::make_shared<ServoMaestro>(name, path, baud);
}

}  // namespace robot
