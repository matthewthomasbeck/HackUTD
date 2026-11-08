#pragma once

// The local protocol between this program and the Node.js bridge (docs/specs/robot.md sections
// 9.3 and 9.4, CONTRACTS.md "Robot bridge local protocol"). One JSON object per line.
//
// Robot to bridge: MessageBuilder makes each message. Field names match the reducer arguments,
// and every message also carries `observed_at` (ISO 8601 UTC with Z, from the wall clock) and
// `seq` (increasing per boot). The bridge passes observed_at to the reducer and strips seq.
//   {"type":"heartbeat","robot_id":"dog1","state":"READY","battery_pct":null,
//    "observed_at":"2026-11-08T14:03:12.345Z","seq":7}
//
// Bridge to robot: parse_inbound() reads mission, cancel, site, and terrain_hint. Any other type
// is ignored with a log line, so a newer bridge cannot break the robot.

#include <chrono>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace robot {

// ISO 8601 UTC with milliseconds and a Z, for example "2026-11-08T14:03:12.345Z".
std::string iso8601_utc(std::chrono::system_clock::time_point t);

struct PositionFields {
  double lat = 0;
  double lon = 0;
  bool gps_fix = false;
  std::optional<double> indoor_offset_m;
  std::optional<double> heading_deg;
};

struct DetectionFields {
  std::uint64_t mission_id = 0;
  std::string source = "thermal";  // thermal | camera
  std::optional<double> lat;       // the reducer needs both; the bridge decides what to do without them
  std::optional<double> lon;
  bool gps_fix = false;
  std::string location_note;
  std::optional<double> max_temp_c;
  double thermal_confidence = 0;
  std::optional<std::string> thermal_image_path;
  std::optional<std::string> camera_image_path;
  std::optional<std::string> breathing_clip_path;
  nlohmann::json thermal_debug = nlohmann::json::object();  // logged by the bridge only
};

struct TerrainFields {
  std::optional<double> lat;
  std::optional<double> lon;
  std::string terrain_class;  // flat | debris | step | gap | blocked | unknown
  double confidence = 0;
  std::string source = "lidar_imu_rules";
  std::string action;  // continue | slow | steer | stop
  std::optional<std::string> image_path;
};

class MessageBuilder {
 public:
  using WallClock = std::function<std::chrono::system_clock::time_point()>;

  // `boot_id` goes into every client_ref; the default is the boot time in base 36.
  explicit MessageBuilder(std::string robot_id, WallClock wall = nullptr, std::string boot_id = "");

  nlohmann::json heartbeat(const std::string& state, std::optional<double> battery_pct);
  nlohmann::json position(const PositionFields& p);
  nlohmann::json device(const std::string& device, const std::string& status, const std::string& detail);
  nlohmann::json cell(std::uint64_t cell_id, const std::string& status, const std::string& note);
  nlohmann::json mission_progress(std::uint64_t mission_id, const std::string& status, const std::string& note);
  // Also sets client_ref to "<robot_id>-<boot_id>-<seq>" (CONTRACTS.md detection.client_ref).
  nlohmann::json detection(const DetectionFields& d);
  nlohmann::json terrain(const TerrainFields& t);

  std::uint64_t last_seq() const { return seq_; }
  const std::string& boot_id() const { return boot_id_; }

 private:
  nlohmann::json start(const char* type);

  std::string robot_id_;
  WallClock wall_;
  std::string boot_id_;
  std::uint64_t seq_ = 0;
};

// True for messages that must not be lost (they go to the important queue and the outbox).
bool is_important(const std::string& type);

// ---- Bridge to robot ----

// Every mission row field (robot.md 9.4); ids are JSON numbers, optionals null.
struct MissionMsg {
  std::uint64_t id = 0;
  std::uint64_t chain_id = 0;
  std::string robot_id;
  std::string kind;  // search_cells | inspect | return_home | hold
  std::vector<std::uint64_t> target_cell_ids;
  std::optional<double> target_lat;
  std::optional<double> target_lon;
  std::string status;
  std::string created_by;
  std::string reason;
};

struct SiteMsg {
  bool demo_mode = false;
  std::uint64_t id = 0;
  double center_lat = 0;
  double center_lon = 0;
  double radius_m = 0;
};

struct TerrainHintMsg {
  std::string terrain_class;
  double confidence = 0;
  std::string observed_at;
};

enum class InboundType { Mission, Cancel, Site, TerrainHint };

struct InboundMessage {
  InboundType type = InboundType::Cancel;
  MissionMsg mission;              // Mission
  std::uint64_t cancel_mission_id = 0;  // Cancel
  SiteMsg site;                    // Site
  TerrainHintMsg terrain_hint;     // TerrainHint
};

enum class ParseStatus { Ok, UnknownType, Invalid };

// Parses one line. UnknownType and Invalid fill `why` for the log; neither is an error for the robot.
ParseStatus parse_inbound(const std::string& line, InboundMessage* out, std::string* why);

}  // namespace robot
