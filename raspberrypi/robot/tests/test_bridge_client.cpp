// Bridge client and local message tests (docs/specs/robot.md section 16.1, docs/tasks/camille.md R3).
// A temporary Unix socket plays the Node.js bridge. Time is passed in, so backoff needs no sleeping.

#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <regex>
#include <string>
#include <vector>

#include <gtest/gtest.h>
#include <nlohmann/json.hpp>

#include "bridge/bridge_client.hpp"
#include "bridge/messages.hpp"

namespace robot {
namespace {

using json = nlohmann::json;
using namespace std::chrono_literals;

// Short paths under /tmp: macOS limits a Unix socket path to 104 bytes.
std::string temp_path(const char* suffix) {
  static int counter = 0;
  return "/tmp/rbt-" + std::to_string(::getpid()) + "-" + std::to_string(counter++) + suffix;
}

// The bridge's side: listen, accept one client, read lines.
class FakeBridge {
 public:
  explicit FakeBridge(std::string path) : path_(std::move(path)) {
    ::unlink(path_.c_str());
    listen_fd_ = ::socket(AF_UNIX, SOCK_STREAM, 0);
    sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, path_.c_str(), sizeof(addr.sun_path) - 1);
    EXPECT_EQ(::bind(listen_fd_, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)), 0);
    EXPECT_EQ(::listen(listen_fd_, 4), 0);
  }
  ~FakeBridge() {
    if (client_fd_ >= 0) ::close(client_fd_);
    ::close(listen_fd_);
    ::unlink(path_.c_str());
  }

  bool accept_client(int timeout_ms = 1000) {
    pollfd p{listen_fd_, POLLIN, 0};
    if (::poll(&p, 1, timeout_ms) <= 0) return false;
    client_fd_ = ::accept(listen_fd_, nullptr, nullptr);
    return client_fd_ >= 0;
  }

  void write_text(const std::string& text) {
    ASSERT_EQ(::send(client_fd_, text.data(), text.size(), 0), static_cast<ssize_t>(text.size()));
  }

  // Reads whatever is waiting (non-blocking) and returns the whole lines seen so far.
  std::vector<std::string> read_available() {
    char buf[65536];
    while (true) {
      const ssize_t n = ::recv(client_fd_, buf, sizeof(buf), MSG_DONTWAIT);
      if (n <= 0) break;
      partial_.append(buf, static_cast<std::size_t>(n));
    }
    std::vector<std::string> lines;
    std::size_t nl;
    while ((nl = partial_.find('\n')) != std::string::npos) {
      lines.push_back(partial_.substr(0, nl));
      partial_.erase(0, nl + 1);
    }
    return lines;
  }

  void close_client() {
    ::close(client_fd_);
    client_fd_ = -1;
  }

 private:
  std::string path_;
  int listen_fd_ = -1;
  int client_fd_ = -1;
  std::string partial_;
};

// Polls the client and reads the fake bridge until `want` lines arrived (or 2 s passed).
std::vector<std::string> pump(BridgeClient& client, FakeBridge& bridge, SteadyTime now, std::size_t want) {
  std::vector<std::string> lines;
  const auto deadline = std::chrono::steady_clock::now() + 2s;
  while (lines.size() < want && std::chrono::steady_clock::now() < deadline) {
    client.poll(now);
    for (auto& l : bridge.read_available()) lines.push_back(std::move(l));
  }
  return lines;
}

std::chrono::system_clock::time_point fixed_wall() {
  // 2026-11-08T14:03:12.345Z
  return std::chrono::system_clock::time_point(std::chrono::milliseconds(1794146592345LL));
}

MessageBuilder test_builder() { return MessageBuilder("dog1", fixed_wall, "boot1"); }

bool file_exists(const std::string& path) {
  std::error_code ec;
  return std::filesystem::exists(path, ec);
}

// ---- Messages ----

TEST(Messages, Iso8601IsUtcWithZ) {
  EXPECT_EQ(iso8601_utc(fixed_wall()), "2026-11-08T14:03:12.345Z");
  EXPECT_EQ(iso8601_utc(std::chrono::system_clock::time_point{}), "1970-01-01T00:00:00.000Z");
}

TEST(Messages, EveryMessageHasObservedAtAndIncreasingSeq) {
  MessageBuilder b = test_builder();
  const json h = b.heartbeat("READY", std::nullopt);
  const json p = b.position(PositionFields{32.9, -96.7, false, std::nullopt, 45.0});
  EXPECT_EQ(h["type"], "heartbeat");
  EXPECT_EQ(h["observed_at"], "2026-11-08T14:03:12.345Z");
  EXPECT_EQ(h["seq"], 1);
  EXPECT_EQ(p["seq"], 2);
  EXPECT_EQ(b.last_seq(), 2u);
}

// Field names exactly as robot.md 9.3 (they match the reducer arguments in CONTRACTS.md).
TEST(Messages, FieldNamesMatchTheContract) {
  MessageBuilder b = test_builder();
  auto keys = [](const json& j) {
    std::vector<std::string> out;
    for (auto it = j.begin(); it != j.end(); ++it) out.push_back(it.key());
    return out;  // nlohmann::json sorts object keys
  };
  using V = std::vector<std::string>;
  EXPECT_EQ(keys(b.heartbeat("READY", std::nullopt)), (V{"battery_pct", "observed_at", "robot_id", "seq", "state", "type"}));
  EXPECT_EQ(keys(b.position(PositionFields{})),
            (V{"gps_fix", "heading_deg", "indoor_offset_m", "lat", "lon", "observed_at", "robot_id", "seq", "type"}));
  EXPECT_EQ(keys(b.device("thermal", "OK", "mock")),
            (V{"detail", "device", "observed_at", "robot_id", "seq", "status", "type"}));
  EXPECT_EQ(keys(b.cell(3, "searched", "")), (V{"cell_id", "note", "observed_at", "seq", "status", "type"}));
  EXPECT_EQ(keys(b.mission_progress(7, "active", "")),
            (V{"mission_id", "note", "observed_at", "seq", "status", "type"}));
  EXPECT_EQ(keys(b.detection(DetectionFields{})),
            (V{"breathing_clip_path", "camera_image_path", "client_ref", "gps_fix", "lat", "location_note", "lon",
               "max_temp_c", "mission_id", "observed_at", "robot_id", "seq", "source", "thermal_confidence",
               "thermal_debug", "thermal_image_path", "type"}));
  TerrainFields t;
  t.terrain_class = "flat";
  t.action = "continue";
  EXPECT_EQ(keys(b.terrain(t)), (V{"action", "confidence", "lat", "lon", "observed_at", "robot_id", "seq", "source",
                                   "terrain_class", "type"}));
}

TEST(Messages, DetectionClientRefIsUniqueAndValid) {
  MessageBuilder b = test_builder();
  DetectionFields d;
  d.mission_id = 4;
  d.lat = 32.9;
  d.lon = -96.7;
  d.thermal_confidence = 0.8;
  const json first = b.detection(d);
  const json second = b.detection(d);
  EXPECT_EQ(first["client_ref"], "dog1-boot1-1");
  EXPECT_NE(first["client_ref"], second["client_ref"]);
  // The module accepts ^[A-Za-z0-9_-]{1,40}$ only.
  EXPECT_TRUE(std::regex_match(first["client_ref"].get<std::string>(), std::regex("^[A-Za-z0-9_-]{1,40}$")));
  EXPECT_EQ(first["mission_id"], 4);
  EXPECT_TRUE(first["max_temp_c"].is_null());
  EXPECT_TRUE(first["thermal_image_path"].is_null());
  // The default boot id is the boot time in base 36, still valid.
  MessageBuilder real("dog1");
  EXPECT_TRUE(std::regex_match(real.detection(d)["client_ref"].get<std::string>(),
                               std::regex("^[A-Za-z0-9_-]{1,40}$")));
}

TEST(Messages, ImportantTypes) {
  for (const char* t : {"detection", "cell", "mission_progress", "device"}) EXPECT_TRUE(is_important(t)) << t;
  for (const char* t : {"heartbeat", "position", "terrain"}) EXPECT_FALSE(is_important(t)) << t;
}

TEST(Messages, ParseMission) {
  InboundMessage m;
  std::string why;
  const std::string line =
      R"({"type":"mission","mission":{"id":12,"chain_id":0,"robot_id":"dog1","kind":"search_cells",)"
      R"("target_cell_ids":[3,4],"target_lat":null,"target_lon":null,"status":"leased",)"
      R"("lease_expires_at":"2026-11-08T14:03:42.000Z","created_by":"coordinator","reason":"house 3 first",)"
      R"("created_at":"2026-11-08T14:03:00.000Z","updated_at":"2026-11-08T14:03:12.000Z"}})";
  ASSERT_EQ(parse_inbound(line, &m, &why), ParseStatus::Ok) << why;
  EXPECT_EQ(m.type, InboundType::Mission);
  EXPECT_EQ(m.mission.id, 12u);
  EXPECT_EQ(m.mission.kind, "search_cells");
  EXPECT_EQ(m.mission.target_cell_ids, (std::vector<std::uint64_t>{3, 4}));
  EXPECT_FALSE(m.mission.target_lat.has_value());
  EXPECT_EQ(m.mission.status, "leased");
  EXPECT_EQ(m.mission.reason, "house 3 first");
}

TEST(Messages, ParseCancelSiteAndTerrainHint) {
  InboundMessage m;
  std::string why;
  ASSERT_EQ(parse_inbound(R"({"type":"cancel","mission_id":12})", &m, &why), ParseStatus::Ok) << why;
  EXPECT_EQ(m.type, InboundType::Cancel);
  EXPECT_EQ(m.cancel_mission_id, 12u);

  ASSERT_EQ(parse_inbound(R"({"type":"site","demo_mode":false,"site":{"id":1,"center_lat":32.99,)"
                          R"("center_lon":-96.75,"radius_m":483}})",
                          &m, &why),
            ParseStatus::Ok)
      << why;
  EXPECT_EQ(m.type, InboundType::Site);
  EXPECT_FALSE(m.site.demo_mode);
  EXPECT_EQ(m.site.id, 1u);
  EXPECT_DOUBLE_EQ(m.site.center_lat, 32.99);
  EXPECT_DOUBLE_EQ(m.site.radius_m, 483);

  ASSERT_EQ(parse_inbound(R"({"type":"terrain_hint","terrain_class":"debris","confidence":0.7,)"
                          R"("observed_at":"2026-11-08T14:03:12.000Z"})",
                          &m, &why),
            ParseStatus::Ok)
      << why;
  EXPECT_EQ(m.type, InboundType::TerrainHint);
  EXPECT_EQ(m.terrain_hint.terrain_class, "debris");
  EXPECT_DOUBLE_EQ(m.terrain_hint.confidence, 0.7);
}

TEST(Messages, ParseRejectsBadLines) {
  InboundMessage m;
  std::string why;
  EXPECT_EQ(parse_inbound("not json", &m, &why), ParseStatus::Invalid);
  EXPECT_EQ(parse_inbound(R"({"type":"cancel"})", &m, &why), ParseStatus::Invalid);
  EXPECT_EQ(parse_inbound(R"({"type":"cancel","mission_id":-3})", &m, &why), ParseStatus::Invalid);
  // Doubles at or above 2^64, or not whole, are rejected before any cast to uint64_t.
  EXPECT_EQ(parse_inbound(R"({"type":"cancel","mission_id":1.8446744073709552e19})", &m, &why), ParseStatus::Invalid);
  EXPECT_EQ(parse_inbound(R"({"type":"cancel","mission_id":1e30})", &m, &why), ParseStatus::Invalid);
  EXPECT_EQ(parse_inbound(R"({"type":"cancel","mission_id":2.5})", &m, &why), ParseStatus::Invalid);
  EXPECT_EQ(parse_inbound(R"({"type":"mission","mission":{"id":0,"kind":"hold"}})", &m, &why), ParseStatus::Invalid);
  EXPECT_EQ(parse_inbound(R"({"type":"site"})", &m, &why), ParseStatus::Invalid);
  EXPECT_EQ(parse_inbound(R"({"type":"terrain_hint","terrain_class":"flat","confidence":3})", &m, &why),
            ParseStatus::Invalid);
  EXPECT_EQ(parse_inbound(R"({"type":"motor","duty":1.0})", &m, &why), ParseStatus::UnknownType);
  EXPECT_NE(why.find("motor"), std::string::npos) << why;
}

// ---- BridgeClient ----

TEST(BridgeClient, NonBlockingWriteNeverStalls) {
  const std::string path = temp_path(".sock");
  FakeBridge bridge(path);
  BridgeClient client(BridgeClientConfig{path, ""});
  const SteadyTime t0{};
  ASSERT_TRUE(client.poll(t0).empty());
  ASSERT_TRUE(client.connected());
  ASSERT_TRUE(bridge.accept_client());  // accepted, but the bridge never reads
  // 64 lines of 16 KB each: far more than a Unix socket buffer (8 KB on macOS, about 200 KB on Linux).
  const std::string pad(16000, 'x');
  for (int i = 0; i < 64; ++i) client.send(json{{"type", "heartbeat"}, {"i", i}, {"pad", pad}});

  double worst_ms = 0;
  for (int i = 0; i < 20; ++i) {
    const auto start = std::chrono::steady_clock::now();
    client.poll(t0);
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
    if (ms > worst_ms) worst_ms = ms;
  }
  EXPECT_LT(worst_ms, 1.0);
  EXPECT_GT(client.telemetry_queued(), 0u) << "the peer was not reading, so lines must still be queued";

  // Once the bridge reads, every line arrives whole and in order: partial writes kept the rest.
  const auto lines = pump(client, bridge, t0, 64);
  ASSERT_EQ(lines.size(), 64u);
  for (int i = 0; i < 64; ++i) {
    const json j = json::parse(lines[static_cast<std::size_t>(i)]);
    EXPECT_EQ(j["i"], i);
    EXPECT_EQ(j["pad"].get<std::string>().size(), pad.size());
  }
}

TEST(BridgeClient, TelemetryDropsOldest) {
  const std::string path = temp_path(".sock");
  FakeBridge bridge(path);
  BridgeClient client(BridgeClientConfig{path, ""});
  MessageBuilder b = test_builder();
  SteadyTime t{};
  client.poll(t);
  ASSERT_TRUE(client.connected());
  ASSERT_TRUE(bridge.accept_client());
  // send() only queues; nothing is written until the next poll.
  for (int i = 0; i < 70; ++i) client.send(b.heartbeat("READY", std::nullopt));  // seq 1..70
  EXPECT_EQ(client.telemetry_queued(), 64u);
  EXPECT_EQ(client.telemetry_dropped(), 6u);
  const auto lines = pump(client, bridge, t, 64);
  ASSERT_EQ(lines.size(), 64u);
  EXPECT_EQ(json::parse(lines.front())["seq"], 7);  // 1 to 6 were the oldest, dropped
  EXPECT_EQ(json::parse(lines.back())["seq"], 70);
}

TEST(BridgeClient, TelemetryNotQueuedWhileDisconnected) {
  const std::string path = temp_path(".sock");
  BridgeClient client(BridgeClientConfig{path, ""});
  MessageBuilder b = test_builder();
  SteadyTime t{};
  client.poll(t);  // no bridge yet
  client.send(b.heartbeat("READY", std::nullopt));
  EXPECT_EQ(client.telemetry_queued(), 0u) << "the main loop sends a fresh heartbeat after the connect";

  FakeBridge bridge(path);
  t += 600ms;  // past the first 0.5 s backoff
  client.poll(t);
  ASSERT_TRUE(client.connected());
  ASSERT_TRUE(bridge.accept_client());
  client.send(b.heartbeat("READY", std::nullopt));
  EXPECT_EQ(client.telemetry_queued(), 1u);
  bridge.close_client();
  for (int i = 0; i < 50 && client.connected(); ++i) {
    client.poll(t);
    ::usleep(1000);
  }
  ASSERT_FALSE(client.connected());
  EXPECT_EQ(client.telemetry_queued(), 0u) << "stale telemetry is cleared when the link drops";
}

TEST(BridgeClient, BackoffDoublesToFiveSeconds) {
  BridgeClient client(BridgeClientConfig{temp_path(".sock"), ""});
  SteadyTime t{};
  std::vector<double> waits;
  for (int i = 0; i < 6; ++i) {
    const double before = client.backoff_ms();
    client.poll(t);
    waits.push_back(before);
    client.poll(t + std::chrono::milliseconds(static_cast<int>(before) - 1));  // too early: no new try
    EXPECT_EQ(client.backoff_ms(), std::min(before * 2, 5000.0));
    t += std::chrono::milliseconds(static_cast<int>(before));
  }
  EXPECT_EQ(waits, (std::vector<double>{500, 1000, 2000, 4000, 5000, 5000}));
}

TEST(BridgeClient, OutboxReplaysAfterReconnect) {
  const std::string path = temp_path(".sock");
  const std::string outbox = temp_path(".outbox");
  std::remove(outbox.c_str());
  MessageBuilder b = test_builder();
  SteadyTime t{};
  {
    BridgeClient client(BridgeClientConfig{path, outbox});
    FakeBridge bridge(path);
    client.poll(t);
    ASSERT_TRUE(bridge.accept_client());
    ASSERT_TRUE(client.connected());

    // The bridge crashes. The client notices on its next poll.
    bridge.close_client();
    client.poll(t);
    EXPECT_FALSE(client.connected());

    // While it is down: important lines go to the outbox, telemetry to memory.
    DetectionFields d;
    d.mission_id = 9;
    d.lat = 32.9;
    d.lon = -96.7;
    d.thermal_confidence = 0.8;
    client.send(b.detection(d));                       // seq 1
    client.send(b.heartbeat("ACTIVE", std::nullopt));  // seq 2
    client.send(b.cell(3, "searched", "mock scan"));   // seq 3
    client.send(b.device("thermal", "OK", "mock"));    // seq 4: current state, resent after a connect
    EXPECT_EQ(client.important_queued(), 0u);
    std::ifstream file(outbox);
    std::string l1, l2, l3;
    ASSERT_TRUE(std::getline(file, l1) && std::getline(file, l2));
    EXPECT_FALSE(std::getline(file, l3)) << "device lines are not replayed: " << l3;
    EXPECT_EQ(json::parse(l1)["type"], "detection");
    EXPECT_EQ(json::parse(l2)["type"], "cell");
  }
  // A restarted bridge: the outbox goes first, then what was queued in memory.
  FakeBridge bridge(path);
  BridgeClient client(BridgeClientConfig{path, outbox});  // also covers a robot restart
  client.poll(t);
  ASSERT_TRUE(client.connected());
  ASSERT_TRUE(bridge.accept_client());
  client.send(b.heartbeat("READY", std::nullopt));  // seq 5
  const auto lines = pump(client, bridge, t, 3);
  ASSERT_EQ(lines.size(), 3u);
  EXPECT_EQ(json::parse(lines[0])["seq"], 1);
  EXPECT_EQ(json::parse(lines[0])["observed_at"], "2026-11-08T14:03:12.345Z");  // the original time
  EXPECT_EQ(json::parse(lines[1])["seq"], 3);
  EXPECT_EQ(json::parse(lines[2])["seq"], 5);
  // Replayed once: the outbox and the replay file are gone now.
  std::ifstream after(outbox);
  std::string rest;
  EXPECT_FALSE(std::getline(after, rest));
  EXPECT_FALSE(file_exists(outbox + ".replaying"));
  std::remove(outbox.c_str());
}

// A crash (or a watchdog kill) during the replay must not lose the lines not yet written.
TEST(BridgeClient, ReplayFileKeptUntilEveryLineIsWritten) {
  const std::string path = temp_path(".sock");
  const std::string outbox = temp_path(".outbox");
  const std::string replaying = outbox + ".replaying";
  std::remove(outbox.c_str());
  std::remove(replaying.c_str());
  const std::string pad(16000, 'x');
  {
    std::ofstream file(outbox);
    for (int i = 0; i < 40; ++i) file << json{{"type", "cell"}, {"i", i}, {"pad", pad}}.dump() << "\n";
  }
  BridgeClientConfig config{path, outbox};
  config.important_capacity = 8;  // also the replay batch size
  SteadyTime t{};
  {
    FakeBridge bridge(path);
    BridgeClient client(config);
    client.poll(t);
    ASSERT_TRUE(client.connected());
    ASSERT_TRUE(bridge.accept_client());  // and never reads: the replay stalls part way
    for (int i = 0; i < 5; ++i) client.poll(t);
    EXPECT_FALSE(file_exists(outbox)) << "the outbox was renamed for the replay";
    EXPECT_TRUE(file_exists(replaying)) << "deleted before every line was written";
    EXPECT_LE(client.important_queued(), 8u) << "one batch at a time";
  }  // the robot dies here; the replay file stays
  {
    std::ofstream file(outbox, std::ios::app);  // a newer line, appended after the restart
    file << json{{"type", "cell"}, {"i", 99}}.dump() << "\n";
  }
  FakeBridge bridge(path);
  BridgeClient client(config);
  client.poll(t);
  ASSERT_TRUE(client.connected());
  ASSERT_TRUE(bridge.accept_client());
  const auto lines = pump(client, bridge, t, 41);
  ASSERT_EQ(lines.size(), 41u);
  for (int i = 0; i < 40; ++i) EXPECT_EQ(json::parse(lines[static_cast<std::size_t>(i)])["i"], i);
  EXPECT_EQ(json::parse(lines[40])["i"], 99) << "the older replay first, then the newer outbox";
  client.poll(t);
  EXPECT_FALSE(file_exists(replaying));
  EXPECT_FALSE(file_exists(outbox));
}

// A line written to the socket may sit unread in the kernel buffer when the bridge dies.
TEST(BridgeClient, UncleanDropReplaysRecentlyWrittenLines) {
  const std::string path = temp_path(".sock");
  const std::string outbox = temp_path(".outbox");
  std::remove(outbox.c_str());
  MessageBuilder b = test_builder();
  FakeBridge bridge(path);
  BridgeClient client(BridgeClientConfig{path, outbox});
  SteadyTime t{};
  client.poll(t);
  ASSERT_TRUE(bridge.accept_client());
  client.send(b.cell(3, "searched", "mock scan"));                // seq 1
  client.send(b.mission_progress(9, "active", "started hold"));  // seq 2
  client.send(b.device("thermal", "OK", "mock"));                 // seq 3: current state, not replayed
  ASSERT_EQ(pump(client, bridge, t, 3).size(), 3u);

  bridge.close_client();  // EOF: unclean, the bridge may not have read them
  for (int i = 0; i < 50 && client.connected(); ++i) {
    client.poll(t);
    ::usleep(1000);
  }
  ASSERT_FALSE(client.connected());
  t += 600ms;
  client.poll(t);
  ASSERT_TRUE(client.connected());
  ASSERT_TRUE(bridge.accept_client());
  const auto lines = pump(client, bridge, t, 2);
  ASSERT_EQ(lines.size(), 2u);
  EXPECT_EQ(json::parse(lines[0])["seq"], 1);
  EXPECT_EQ(json::parse(lines[1])["seq"], 2);

  // A clean close() keeps nothing that was already written.
  client.send(b.cell(4, "searched", "mock scan"));
  ASSERT_EQ(pump(client, bridge, t, 1).size(), 1u);
  client.close();
  EXPECT_FALSE(file_exists(outbox));
  EXPECT_FALSE(file_exists(outbox + ".replaying"));
}

// After a failed outbox append, later lines stay in memory too, so the order holds.
TEST(BridgeClient, OutboxAppendFailureKeepsOrder) {
  const std::string path = temp_path(".sock");
  const std::string outbox = temp_path(".outbox");
  MessageBuilder b = test_builder();
  BridgeClient client(BridgeClientConfig{path, outbox});
  SteadyTime t{};
  client.poll(t);  // no bridge yet
  std::filesystem::create_directory(outbox);  // a directory: the append fails
  client.send(b.cell(1, "searched", "a"));     // seq 1, kept in memory
  std::filesystem::remove(outbox);             // the disk works again
  client.send(b.cell(2, "searched", "b"));     // seq 2
  EXPECT_FALSE(file_exists(outbox)) << "a newer line in the outbox would replay before the older one";
  EXPECT_EQ(client.important_queued(), 2u);

  FakeBridge bridge(path);
  t += 600ms;
  client.poll(t);
  ASSERT_TRUE(client.connected());
  ASSERT_TRUE(bridge.accept_client());
  const auto lines = pump(client, bridge, t, 2);
  ASSERT_EQ(lines.size(), 2u);
  EXPECT_EQ(json::parse(lines[0])["seq"], 1);
  EXPECT_EQ(json::parse(lines[1])["seq"], 2);
}

TEST(BridgeClient, UnknownTypeIgnored) {
  const std::string path = temp_path(".sock");
  FakeBridge bridge(path);
  BridgeClient client(BridgeClientConfig{path, ""});
  SteadyTime t{};
  client.poll(t);
  ASSERT_TRUE(bridge.accept_client());
  bridge.write_text("{\"type\":\"warp_drive\",\"level\":9}\nnot json\n{\"type\":\"cancel\",\"mission_id\":7}\n"
                    "{\"type\":\"site\",\"demo_");  // half a line stays buffered
  std::vector<InboundMessage> got;
  for (int i = 0; i < 50 && got.empty(); ++i) {
    for (auto& m : client.poll(t)) got.push_back(m);
    ::usleep(1000);
  }
  ASSERT_EQ(got.size(), 1u);
  EXPECT_EQ(got[0].type, InboundType::Cancel);
  EXPECT_EQ(got[0].cancel_mission_id, 7u);
  EXPECT_TRUE(client.connected()) << "a bad line must not drop the link";

  bridge.write_text("mode\":true}\n");
  got.clear();
  for (int i = 0; i < 50 && got.empty(); ++i) {
    for (auto& m : client.poll(t)) got.push_back(m);
    ::usleep(1000);
  }
  ASSERT_EQ(got.size(), 1u);
  EXPECT_EQ(got[0].type, InboundType::Site);
  EXPECT_TRUE(got[0].site.demo_mode);
}

}  // namespace
}  // namespace robot
