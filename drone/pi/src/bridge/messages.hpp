#pragma once

// The local protocol between this program and the Node.js bridge (docs/specs/robot.md sections
// 9.3 and 9.4, CONTRACTS.md "Robot bridge local protocol"). One JSON object per line.
//
// Robot to bridge: MessageBuilder makes each message. Field names match the reducer arguments,
// and every message also carries `observed_at` (ISO 8601 UTC with Z, from the wall clock) and
// `seq` (increasing per boot). The bridge passes observed_at to the reducer and strips seq.
// The drone uses the dog's protocol unchanged, minus terrain (it has no terrain rules):
//   {"type":"heartbeat","robot_id":"drone1","state":"READY","battery_pct":null,
//    "observed_at":"2026-11-08T14:03:12.345Z","seq":7}
//
// Bridge to drone: parse_inbound() reads mission, cancel, site, and teleop. Any other type
// (terrain_hint included) is ignored with a log line, so a newer bridge cannot break the drone.

#include <chrono>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace drone {

// ISO 8601 UTC with milliseconds and a Z, for example "2026-11-08T14:03:12.345Z".
std::string iso8601_utc(std::chrono::system_clock::time_point t);
// The reverse: "YYYY-MM-DDTHH:MM:SS[.fff...](Z|+00:00)". Empty for anything else.
std::optional<std::chrono::system_clock::time_point> parse_iso8601_utc(const std::string& s);

struct PositionFields {
  double lat = 0;
  double lon = 0;
  bool gps_fix = false;
  std::optional<double> indoor_offset_m;
  std::optional<double> heading_deg;
};

struct DetectionFields {
  std::uint64_t mission_id = 0;
  std::string source = "camera";   // thermal | camera; the drone has only the camera
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
// The same for a whole message (the dog also counts a terrain stop; the drone sends no terrain).
bool is_important_message(const nlohmann::json& message);

// ---- Bridge to drone ----

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

enum class InboundType { Mission, Cancel, Site, Teleop };

// {"type":"teleop","vx":0.1,"vy":0,"wz":0,"seq":42}: one remote driving command from the website
// (PROPOSED contract change, docs/specs/robot.md 9.4). Units as MotionCommand.
struct TeleopMsg {
  double vx_mps = 0, vy_mps = 0, wz_dps = 0;
  std::uint64_t seq = 0;
};

struct InboundMessage {
  InboundType type = InboundType::Cancel;
  MissionMsg mission;              // Mission
  std::uint64_t cancel_mission_id = 0;  // Cancel
  SiteMsg site;                    // Site
  TeleopMsg teleop;                // Teleop
};

enum class ParseStatus { Ok, UnknownType, Invalid };

// Parses one line. UnknownType and Invalid fill `why` for the log; neither is an error for the drone.
ParseStatus parse_inbound(const std::string& line, InboundMessage* out, std::string* why);

}  // namespace drone
