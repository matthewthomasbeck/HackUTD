// MCU text protocol and serial link (the drone's copy of the dog's tests/test_pico_text.cpp;
// firmware lines in drone/mcu/README.md).
// The serial link tests run a fake MCU on a pseudo-terminal, so no hardware is needed.

#include <fcntl.h>
#include <unistd.h>
#ifdef __APPLE__
#include <util.h>
#else
#include <pty.h>
#endif

#include <atomic>
#include <chrono>
#include <cstring>
#include <string>
#include <thread>

#include <gtest/gtest.h>

#include "hal/mcu_link.hpp"
#include "hal/mcu_text_protocol.hpp"

namespace drone {
namespace {

using namespace std::chrono_literals;

SteadyTime t0() { return SteadyTime{} + 1000ms; }

TEST(McuText, ImuConvertsGToMetersPerSecondSquared) {
  McuReadings r;
  McuTextParser p(r);
  p.parse_line("IMU 100 0.120 0.040 -1.110 -1.80 -1.40 0.30 23.5", t0());
  const auto s = r.imu.read();
  ASSERT_TRUE(s);
  EXPECT_NEAR(s->value.az, -1.11f * 9.80665f, 1e-3);
  EXPECT_NEAR(s->value.gx, -1.8f, 1e-4);
  EXPECT_EQ(s->written, t0());
}

TEST(McuText, ShortImuLineIsDropped) {
  McuReadings r;
  McuTextParser p(r);
  p.parse_line("IMU 100 0.1 0.2", t0());
  EXPECT_FALSE(r.imu.read());
  EXPECT_EQ(p.bad_lines(), 1u);
}

TEST(McuText, HeartbeatLinesAreCounted) {
  McuReadings r;
  McuTextParser p(r);
  p.parse_line("HB 1234", t0());
  p.parse_line("HB 1284", t0());
  EXPECT_EQ(p.heartbeats(), 2u);
  p.parse_line("HB nope", t0());
  EXPECT_EQ(p.heartbeats(), 2u);
  EXPECT_EQ(p.bad_lines(), 1u);
}

TEST(McuText, EveryWholeLineCountsForTheLink) {
  // The link's heartbeat is any whole line, so an HB with no sensor streaming keeps it alive.
  McuReadings r;
  McuTextParser p(r);
  const std::string stream = "HB 10\r\nHB 60\r\nHB 1";
  EXPECT_EQ(p.feed(stream.data(), stream.size(), t0()), 2);
  EXPECT_EQ(p.feed("10\n", 3, t0()), 1);  // the rest of the half line
  EXPECT_EQ(p.heartbeats(), 3u);
}

TEST(McuText, LinesSplitAcrossReadsAndJunkIgnored) {
  McuReadings r;
  McuTextParser p(r);
  const std::string stream = "[drone-mcu 0.1] device report\r\nIMU 1 0 0 -1 0 0 0 20\r\nPONG 0.1\r\n";
  int lines = 0;
  for (char c : stream) lines += p.feed(&c, 1, t0());  // one byte at a time
  EXPECT_EQ(lines, 3);
  EXPECT_TRUE(r.imu.read());
  ASSERT_TRUE(p.version());
  EXPECT_EQ(*p.version(), "0.1");
}

TEST(McuText, StatusLineGivesEachSensorState) {
  McuReadings r;
  McuTextParser p(r);
  p.parse_line("STATUS imu=NOT_FOUND", t0());
  ASSERT_TRUE(p.has_status());
  EXPECT_EQ(p.sensor_states().at("imu"), "NOT_FOUND");
}

// A fake MCU on the far side of a pseudo-terminal: answers PING and STATUS like the firmware,
// and streams HB (and IMU, when it has one) once it gets STREAM 1.
class FakeMcu {
 public:
  FakeMcu(std::string version, std::string imu_state) : version_(std::move(version)), imu_state_(std::move(imu_state)) {
    int slave = -1;
    char name[128];
    if (openpty(&master_, &slave, name, nullptr, nullptr) != 0) return;
    path_ = name;
    keep_open_ = slave;  // a pty with no open slave reads as hung up on some systems
    ::fcntl(master_, F_SETFL, O_NONBLOCK);
    thread_ = std::thread([this] { run(); });
  }
  ~FakeMcu() {
    quit_ = true;
    if (thread_.joinable()) thread_.join();
    if (master_ >= 0) ::close(master_);
    if (keep_open_ >= 0) ::close(keep_open_);
  }
  const std::string& path() const { return path_; }
  bool streaming() const { return streaming_; }

 private:
  void say(const std::string& line) {
    const std::string out = line + "\r\n";
    (void)!::write(master_, out.data(), out.size());
  }
  void run() {
    std::string buf;
    while (!quit_) {
      char c[256];
      const ssize_t n = ::read(master_, c, sizeof(c));
      if (n > 0) buf.append(c, static_cast<std::size_t>(n));
      std::size_t nl;
      while ((nl = buf.find('\n')) != std::string::npos) {
        std::string cmd = buf.substr(0, nl);
        buf.erase(0, nl + 1);
        if (!cmd.empty() && cmd.back() == '\r') cmd.pop_back();
        if (cmd == "PING") say("PONG " + version_);
        if (cmd == "STATUS") say("STATUS imu=" + imu_state_);
        if (cmd == "STREAM 1") {
          say("STREAM on");
          streaming_ = true;
        }
      }
      if (streaming_) {
        say("HB 5");
        if (imu_state_ == "OK") say("IMU 5 0.0 0.0 -1.0 0.0 0.0 0.0 22.0");
      }
      std::this_thread::sleep_for(5ms);
    }
  }
  std::string version_;
  std::string imu_state_;
  std::string path_;
  int master_ = -1;
  int keep_open_ = -1;
  std::atomic<bool> quit_{false};
  std::atomic<bool> streaming_{false};
  std::thread thread_;
};

TEST(McuLink, HandshakeReportsSensorsAndStreams) {
  FakeMcu mcu("0.1", "OK");
  ASSERT_FALSE(mcu.path().empty()) << "openpty failed";
  auto link = make_mcu_link_serial(McuLinkConfig{mcu.path(), 20, 250, "0.1"});
  const InitResult r = link->init();
  ASSERT_EQ(r.status, DeviceStatus::OK) << r.detail;
  EXPECT_NE(r.detail.find("firmware 0.1"), std::string::npos);
  EXPECT_EQ(link->sensor_status("imu").status, DeviceStatus::OK);
  EXPECT_EQ(make_mcu_sensor_device("imu", link)->init().status, DeviceStatus::OK);

  // poll() picks up the stream and counts it as the heartbeat.
  const auto deadline = std::chrono::steady_clock::now() + 1s;
  while (!link->readings().imu.read() && std::chrono::steady_clock::now() < deadline) {
    link->poll(std::chrono::steady_clock::now());
    std::this_thread::sleep_for(10ms);
  }
  EXPECT_TRUE(mcu.streaming());
  EXPECT_TRUE(link->readings().imu.read());
  ASSERT_TRUE(link->heartbeat_age_ms(std::chrono::steady_clock::now()));
}

TEST(McuLink, HeartbeatWithNoSensorKeepsTheLinkUp) {
  // The drone's sensors are TBD: with no IMU found, the HB lines alone are the heartbeat.
  FakeMcu mcu("0.1", "NOT_FOUND");
  ASSERT_FALSE(mcu.path().empty()) << "openpty failed";
  auto link = make_mcu_link_serial(McuLinkConfig{mcu.path(), 20, 250, "0.1"});
  ASSERT_EQ(link->init().status, DeviceStatus::OK);
  EXPECT_EQ(make_mcu_sensor_device("imu", link)->init().status, DeviceStatus::FAILED);
  const auto deadline = std::chrono::steady_clock::now() + 1s;
  while (!link->heartbeat_age_ms(std::chrono::steady_clock::now()) && std::chrono::steady_clock::now() < deadline) {
    link->poll(std::chrono::steady_clock::now());
    std::this_thread::sleep_for(10ms);
  }
  ASSERT_TRUE(link->heartbeat_age_ms(std::chrono::steady_clock::now()));
  EXPECT_FALSE(link->readings().imu.read());
}

TEST(McuLink, FirmwareVersionMismatchFails) {
  FakeMcu mcu("0.0", "OK");
  ASSERT_FALSE(mcu.path().empty()) << "openpty failed";
  auto link = make_mcu_link_serial(McuLinkConfig{mcu.path(), 20, 250, "0.1"});
  const InitResult r = link->init();
  EXPECT_EQ(r.status, DeviceStatus::FAILED);
  EXPECT_NE(r.detail.find("expected 0.1"), std::string::npos) << r.detail;
}

TEST(McuLink, MissingPortFails) {
  auto link = make_mcu_link_serial(McuLinkConfig{"/dev/does-not-exist-drone-mcu", 20, 250, "0.1"});
  EXPECT_EQ(link->init().status, DeviceStatus::FAILED);
}

}  // namespace
}  // namespace drone
