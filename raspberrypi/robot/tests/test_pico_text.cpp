// Pico text protocol and serial link (docs/tasks/camille.md R2; firmware lines in pico/README.md).
// The serial link tests run a fake Pico on a pseudo-terminal, so no hardware is needed.

#include <fcntl.h>
#include <unistd.h>
#if defined(__APPLE__)
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

#include "hal/pico_link.hpp"
#include "hal/pico_text_protocol.hpp"

namespace robot {
namespace {

using namespace std::chrono_literals;

SteadyTime t0() { return SteadyTime{} + 1000ms; }

// One LD19 packet as the firmware forwards it: start and end angle in hundredths of a degree,
// 12 points of the same distance.
std::string ldp_line(int start_cdeg, int end_cdeg, int dist_mm) {
  unsigned char raw[47] = {0x54, 0x2C, 0x10, 0x0E};
  raw[4] = static_cast<unsigned char>(start_cdeg & 0xFF);
  raw[5] = static_cast<unsigned char>(start_cdeg >> 8);
  for (int i = 0; i < 12; ++i) {
    raw[6 + i * 3] = static_cast<unsigned char>(dist_mm & 0xFF);
    raw[7 + i * 3] = static_cast<unsigned char>(dist_mm >> 8);
    raw[8 + i * 3] = 200;
  }
  raw[42] = static_cast<unsigned char>(end_cdeg & 0xFF);
  raw[43] = static_cast<unsigned char>(end_cdeg >> 8);
  std::string line = "LDP 1234 ";
  char hex[3];
  for (unsigned char b : raw) {
    std::snprintf(hex, sizeof(hex), "%02X", b);
    line += hex;
  }
  return line;
}

TEST(PicoText, ImuConvertsGToMetersPerSecondSquared) {
  PicoReadings r;
  PicoTextParser p(r);
  p.parse_line("IMU 100 0.120 0.040 -1.110 -1.80 -1.40 0.30 23.5", t0());
  const auto s = r.imu.read();
  ASSERT_TRUE(s);
  EXPECT_NEAR(s->value.az, -1.11f * 9.80665f, 1e-3);
  EXPECT_NEAR(s->value.gx, -1.8f, 1e-4);
  EXPECT_EQ(s->written, t0());
}

TEST(PicoText, AdsVoltsBecomeCounts) {
  PicoReadings r;
  PicoTextParser p(r);
  p.parse_line("ADS 100 0.0000 0.0000 1.3710 4.0960", t0());
  const auto s = r.force.read();
  ASSERT_TRUE(s);
  EXPECT_EQ(s->value.raw[0], 0);
  EXPECT_EQ(s->value.raw[2], ads_counts_from_volts(1.371f));
  EXPECT_EQ(s->value.raw[3], 32767);  // full scale clamps instead of wrapping
}

TEST(PicoText, ThermalFrameInCentiDegrees) {
  PicoReadings r;
  PicoTextParser p(r);
  std::string line = "THM 100 7 25.90 22.50 29.90";
  for (int i = 0; i < 768; ++i) line += i == 5 ? " 312" : " 230";
  p.parse_line(line, t0());
  const auto s = r.thermal.read();
  ASSERT_TRUE(s);
  EXPECT_EQ(s->value.width, 32);
  EXPECT_EQ(s->value.height, 24);
  ASSERT_EQ(s->value.centi_deg_c.size(), 768u);
  EXPECT_EQ(s->value.centi_deg_c[0], 2300);
  EXPECT_EQ(s->value.centi_deg_c[5], 3120);
}

TEST(PicoText, ShortThermalFrameIsDropped) {
  PicoReadings r;
  PicoTextParser p(r);
  p.parse_line("THM 100 7 25.90 22.50 29.90 230 230", t0());
  EXPECT_FALSE(r.thermal.read());
  EXPECT_EQ(p.bad_lines(), 1u);
}

TEST(PicoText, TfLunaCentimetersToMillimeters) {
  PicoReadings r;
  PicoTextParser p(r);
  p.parse_line("TFL 100 152 1800 41.0", t0());
  const auto s = r.lidar_single.read();
  ASSERT_TRUE(s);
  EXPECT_EQ(s->value.dist_mm, 1520);
  EXPECT_EQ(s->value.strength, 1800);
}

TEST(PicoText, Ld19PublishesOneScanPerRevolution) {
  PicoReadings r;
  PicoTextParser p(r);
  // 30 packets covering 0 to 360 degrees, then the next revolution starts.
  for (int i = 0; i < 30; ++i) p.parse_line(ldp_line(i * 1200, i * 1200 + 1100, 800 + i), t0());
  EXPECT_FALSE(r.ld19.read()) << "no scan until the angle wraps";
  p.parse_line(ldp_line(100, 1200, 999), t0());
  const auto s = r.ld19.read();
  ASSERT_TRUE(s);
  ASSERT_EQ(s->value.points.size(), 30u * 12u);
  EXPECT_EQ(s->value.points.front().angle_cdeg, 0);
  EXPECT_EQ(s->value.points.front().dist_mm, 800);
  EXPECT_EQ(s->value.points.back().angle_cdeg, 29 * 1200 + 1100);
}

TEST(PicoText, Ld19WithBadHexIsDropped) {
  PicoReadings r;
  PicoTextParser p(r);
  std::string line = ldp_line(0, 1100, 800);
  line[20] = 'Z';
  p.parse_line(line, t0());
  EXPECT_EQ(p.bad_lines(), 1u);
}

TEST(PicoText, LinesSplitAcrossReadsAndJunkIgnored) {
  PicoReadings r;
  PicoTextParser p(r);
  const std::string stream = "[argos-pico 0.9] device report\r\nIMU 1 0 0 -1 0 0 0 20\r\nPONG 0.9\r\n";
  int lines = 0;
  for (char c : stream) lines += p.feed(&c, 1, t0());  // one byte at a time
  EXPECT_EQ(lines, 3);
  EXPECT_TRUE(r.imu.read());
  ASSERT_TRUE(p.version());
  EXPECT_EQ(*p.version(), "0.9");
}

TEST(PicoText, StatusMapsFirmwareNamesToPiNames) {
  PicoReadings r;
  PicoTextParser p(r);
  p.parse_line("STATUS imu=OK thermal=OK ads1115=NOT_FOUND tfluna=OK ld19=ERROR", t0());
  ASSERT_TRUE(p.has_status());
  EXPECT_EQ(p.sensor_states().at("lidar_single"), "OK");
  EXPECT_EQ(p.sensor_states().at("ads1115"), "NOT_FOUND");
  EXPECT_EQ(p.sensor_states().at("ld19"), "ERROR");
}

// A fake Pico on the far side of a pseudo-terminal: answers PING and STATUS like the firmware,
// and streams IMU lines once it gets STREAM 1.
class FakePico {
 public:
  explicit FakePico(std::string version) : version_(std::move(version)) {
    int slave = -1;
    char name[128];
    if (openpty(&master_, &slave, name, nullptr, nullptr) != 0) return;
    path_ = name;
    keep_open_ = slave;  // a pty with no open slave reads as hung up on some systems
    ::fcntl(master_, F_SETFL, O_NONBLOCK);
    thread_ = std::thread([this] { run(); });
  }
  ~FakePico() {
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
        if (cmd == "STATUS") say("STATUS imu=OK thermal=OK ads1115=NOT_FOUND tfluna=OK ld19=OK");
        if (cmd == "STREAM 1") {
          say("STREAM on");
          streaming_ = true;
        }
      }
      if (streaming_) say("IMU 5 0.0 0.0 -1.0 0.0 0.0 0.0 22.0");
      std::this_thread::sleep_for(5ms);
    }
  }
  std::string version_;
  std::string path_;
  int master_ = -1;
  int keep_open_ = -1;
  std::atomic<bool> quit_{false};
  std::atomic<bool> streaming_{false};
  std::thread thread_;
};

TEST(PicoLink, HandshakeReportsSensorsAndStreams) {
  FakePico pico("0.9");
  ASSERT_FALSE(pico.path().empty()) << "openpty failed";
  auto link = make_pico_link_serial(PicoLinkConfig{pico.path(), 20, 250, "0.9"});
  const InitResult r = link->init();
  ASSERT_EQ(r.status, DeviceStatus::OK) << r.detail;
  EXPECT_NE(r.detail.find("firmware 0.9"), std::string::npos);
  EXPECT_EQ(link->sensor_status("imu").status, DeviceStatus::OK);
  EXPECT_EQ(link->sensor_status("ads1115").status, DeviceStatus::FAILED);
  EXPECT_EQ(make_pico_sensor_device("lidar_single", link)->init().status, DeviceStatus::OK);

  // poll() picks up the stream and counts it as the heartbeat.
  const auto deadline = std::chrono::steady_clock::now() + 1s;
  while (!link->readings().imu.read() && std::chrono::steady_clock::now() < deadline) {
    link->poll(std::chrono::steady_clock::now());
    std::this_thread::sleep_for(10ms);
  }
  EXPECT_TRUE(pico.streaming());
  EXPECT_TRUE(link->readings().imu.read());
  ASSERT_TRUE(link->heartbeat_age_ms(std::chrono::steady_clock::now()));
}

TEST(PicoLink, FirmwareVersionMismatchFails) {
  FakePico pico("0.8");
  ASSERT_FALSE(pico.path().empty()) << "openpty failed";
  auto link = make_pico_link_serial(PicoLinkConfig{pico.path(), 20, 250, "0.9"});
  const InitResult r = link->init();
  EXPECT_EQ(r.status, DeviceStatus::FAILED);
  EXPECT_NE(r.detail.find("expected 0.9"), std::string::npos) << r.detail;
}

TEST(PicoLink, MissingPortFails) {
  auto link = make_pico_link_serial(PicoLinkConfig{"/dev/does-not-exist-pico", 20, 250, "0.9"});
  EXPECT_EQ(link->init().status, DeviceStatus::FAILED);
}

}  // namespace
}  // namespace robot
