#include "bridge/messages.hpp"

#include <cmath>
#include <cstdio>
#include <ctime>

namespace drone {

using json = nlohmann::json;

namespace {

std::string base36(std::uint64_t v) {
  static const char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
  if (v == 0) return "0";
  std::string out;
  while (v > 0) {
    out.insert(out.begin(), digits[v % 36]);
    v /= 36;
  }
  return out;
}

template <typename T>
json opt(const std::optional<T>& v) {
  return v ? json(*v) : json(nullptr);
}

// Reads a u64 id that the bridge sent as a JSON number (to_wire.ts keeps ids below 2^53).
bool read_id(const json& j, const char* key, std::uint64_t* out) {
  const auto it = j.find(key);
  if (it == j.end() || !it->is_number()) return false;
  if (it->is_number_unsigned()) {
    *out = it->get<std::uint64_t>();
  } else if (it->is_number_integer()) {
    const auto v = it->get<std::int64_t>();
    if (v < 0) return false;
    *out = static_cast<std::uint64_t>(v);
  } else {
    // Range and integer checks first: casting a double at or above 2^64 to uint64_t is undefined.
    const double v = it->get<double>();
    if (!(v >= 0) || v >= 18446744073709551616.0 || v != std::floor(v)) return false;
    *out = static_cast<std::uint64_t>(v);
  }
  return true;
}

std::optional<double> read_opt_number(const json& j, const char* key) {
  const auto it = j.find(key);
  if (it == j.end() || !it->is_number()) return std::nullopt;
  return it->get<double>();
}

std::string read_string(const json& j, const char* key) {
  const auto it = j.find(key);
  return it != j.end() && it->is_string() ? it->get<std::string>() : "";
}

}  // namespace

std::string iso8601_utc(std::chrono::system_clock::time_point t) {
  using namespace std::chrono;
  const auto ms_total = duration_cast<milliseconds>(t.time_since_epoch()).count();
  std::time_t secs = static_cast<std::time_t>(ms_total / 1000);
  long long ms = ms_total % 1000;
  if (ms < 0) {  // before 1970: keep the milliseconds positive
    ms += 1000;
    secs -= 1;
  }
  std::tm tm{};
  gmtime_r(&secs, &tm);
  char buf[40];
  std::snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d.%03lldZ", tm.tm_year + 1900, tm.tm_mon + 1,
                tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec, ms);
  return buf;
}

MessageBuilder::MessageBuilder(std::string robot_id, WallClock wall, std::string boot_id)
    : robot_id_(std::move(robot_id)), wall_(std::move(wall)), boot_id_(std::move(boot_id)) {
  if (!wall_) wall_ = [] { return std::chrono::system_clock::now(); };
  if (boot_id_.empty()) {
    const auto secs = std::chrono::duration_cast<std::chrono::seconds>(wall_().time_since_epoch()).count();
    boot_id_ = base36(static_cast<std::uint64_t>(secs < 0 ? 0 : secs));
  }
}

// TODO(clock): observed_at is the Pi's wall clock, and the module rejects a time in the future or
// before the active run (checkObservedAt in backend/spacetimedb/src/index.ts). A Pi without NTP or
// an RTC can boot with a wrong clock, so check the clock is synced before relying on it.
json MessageBuilder::start(const char* type) {
  return {{"type", type}, {"observed_at", iso8601_utc(wall_())}, {"seq", ++seq_}};
}

json MessageBuilder::heartbeat(const std::string& state, std::optional<double> battery_pct) {
  json j = start("heartbeat");
  j["robot_id"] = robot_id_;
  j["state"] = state;
  j["battery_pct"] = opt(battery_pct);
  return j;
}

json MessageBuilder::position(const PositionFields& p) {
  json j = start("position");
  j["robot_id"] = robot_id_;
  j["lat"] = p.lat;
  j["lon"] = p.lon;
  j["gps_fix"] = p.gps_fix;
  j["indoor_offset_m"] = opt(p.indoor_offset_m);
  j["heading_deg"] = opt(p.heading_deg);
  return j;
}

json MessageBuilder::device(const std::string& device, const std::string& status, const std::string& detail) {
  json j = start("device");
  j["robot_id"] = robot_id_;
  j["device"] = device;
  j["status"] = status;
  j["detail"] = detail;
  return j;
}

json MessageBuilder::cell(std::uint64_t cell_id, const std::string& status, const std::string& note) {
  json j = start("cell");
  j["cell_id"] = cell_id;
  j["status"] = status;
  j["note"] = note;
  return j;
}

json MessageBuilder::mission_progress(std::uint64_t mission_id, const std::string& status, const std::string& note) {
  json j = start("mission_progress");
  j["mission_id"] = mission_id;
  j["status"] = status;
  j["note"] = note;
  return j;
}

json MessageBuilder::detection(const DetectionFields& d) {
  json j = start("detection");
  j["robot_id"] = robot_id_;
  j["mission_id"] = d.mission_id;
  j["source"] = d.source;
  j["client_ref"] = robot_id_ + "-" + boot_id_ + "-" + std::to_string(seq_);
  j["lat"] = opt(d.lat);
  j["lon"] = opt(d.lon);
  j["gps_fix"] = d.gps_fix;
  j["location_note"] = d.location_note;
  j["max_temp_c"] = opt(d.max_temp_c);
  j["thermal_confidence"] = d.thermal_confidence;
  j["thermal_image_path"] = opt(d.thermal_image_path);
  j["camera_image_path"] = opt(d.camera_image_path);
  j["breathing_clip_path"] = opt(d.breathing_clip_path);
  j["thermal_debug"] = d.thermal_debug;
  return j;
}

bool is_important(const std::string& type) {
  return type == "detection" || type == "cell" || type == "mission_progress" || type == "device";
}

bool is_important_message(const json& message) {
  const std::string type = read_string(message, "type");
  return is_important(type);
}

std::optional<std::chrono::system_clock::time_point> parse_iso8601_utc(const std::string& s) {
  int y = 0, mo = 0, d = 0, h = 0, mi = 0, sec = 0, used = 0;
  if (std::sscanf(s.c_str(), "%4d-%2d-%2dT%2d:%2d:%2d%n", &y, &mo, &d, &h, &mi, &sec, &used) != 6 || used != 19) {
    return std::nullopt;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 60) return std::nullopt;
  std::size_t i = 19;
  long long micros = 0;
  if (i < s.size() && s[i] == '.') {
    long long scale = 100000;
    ++i;
    const std::size_t digits_from = i;
    for (; i < s.size() && s[i] >= '0' && s[i] <= '9'; ++i) {
      micros += (s[i] - '0') * scale;
      scale /= 10;
    }
    if (i == digits_from) return std::nullopt;
  }
  const std::string zone = s.substr(i);
  if (zone != "Z" && zone != "+00:00") return std::nullopt;
  std::tm tm{};
  tm.tm_year = y - 1900;
  tm.tm_mon = mo - 1;
  tm.tm_mday = d;
  tm.tm_hour = h;
  tm.tm_min = mi;
  tm.tm_sec = sec;
  const std::time_t secs = timegm(&tm);
  return std::chrono::system_clock::time_point(std::chrono::seconds(secs)) +
         std::chrono::duration_cast<std::chrono::system_clock::duration>(std::chrono::microseconds(micros));
}

ParseStatus parse_inbound(const std::string& line, InboundMessage* out, std::string* why) {
  const json j = json::parse(line, nullptr, false);
  if (j.is_discarded() || !j.is_object()) {
    *why = "not a JSON object";
    return ParseStatus::Invalid;
  }
  const std::string type = read_string(j, "type");
  if (type == "mission") {
    const auto it = j.find("mission");
    if (it == j.end() || !it->is_object()) {
      *why = "mission without a mission object";
      return ParseStatus::Invalid;
    }
    const json& m = *it;
    MissionMsg& mission = out->mission;
    mission = MissionMsg{};
    if (!read_id(m, "id", &mission.id) || mission.id == 0) {
      *why = "mission without a valid id";
      return ParseStatus::Invalid;
    }
    read_id(m, "chain_id", &mission.chain_id);
    mission.robot_id = read_string(m, "robot_id");
    mission.kind = read_string(m, "kind");
    mission.status = read_string(m, "status");
    mission.created_by = read_string(m, "created_by");
    mission.reason = read_string(m, "reason");
    mission.target_lat = read_opt_number(m, "target_lat");
    mission.target_lon = read_opt_number(m, "target_lon");
    const auto cells = m.find("target_cell_ids");
    if (cells != m.end() && cells->is_array()) {
      for (const auto& c : *cells) {
        const json holder = {{"v", c}};
        std::uint64_t id = 0;
        if (!read_id(holder, "v", &id)) {
          *why = "mission " + std::to_string(mission.id) + " has a bad target_cell_ids entry";
          return ParseStatus::Invalid;
        }
        mission.target_cell_ids.push_back(id);
      }
    }
    if (mission.kind.empty()) {
      *why = "mission " + std::to_string(mission.id) + " has no kind";
      return ParseStatus::Invalid;
    }
    out->type = InboundType::Mission;
    return ParseStatus::Ok;
  }
  if (type == "cancel") {
    if (!read_id(j, "mission_id", &out->cancel_mission_id)) {
      *why = "cancel without a valid mission_id";
      return ParseStatus::Invalid;
    }
    out->type = InboundType::Cancel;
    return ParseStatus::Ok;
  }
  if (type == "site") {
    const auto demo = j.find("demo_mode");
    if (demo == j.end() || !demo->is_boolean()) {
      *why = "site without a demo_mode true or false";
      return ParseStatus::Invalid;
    }
    SiteMsg& site = out->site;
    site = SiteMsg{};
    site.demo_mode = demo->get<bool>();
    const auto s = j.find("site");
    if (s != j.end() && s->is_object()) {
      read_id(*s, "id", &site.id);
      site.center_lat = read_opt_number(*s, "center_lat").value_or(0.0);
      site.center_lon = read_opt_number(*s, "center_lon").value_or(0.0);
      site.radius_m = read_opt_number(*s, "radius_m").value_or(0.0);
    }
    out->type = InboundType::Site;
    return ParseStatus::Ok;
  }
  if (type == "teleop") {
    TeleopMsg& t = out->teleop;
    t = TeleopMsg{};
    const auto vx = read_opt_number(j, "vx"), vy = read_opt_number(j, "vy"), wz = read_opt_number(j, "wz");
    if (!vx || !vy || !wz || !std::isfinite(*vx) || !std::isfinite(*vy) || !std::isfinite(*wz)) {
      *why = "teleop needs numbers vx, vy and wz";
      return ParseStatus::Invalid;
    }
    t.vx_mps = *vx;
    t.vy_mps = *vy;
    t.wz_dps = *wz;
    read_id(j, "seq", &t.seq);
    out->type = InboundType::Teleop;
    return ParseStatus::Ok;
  }
  *why = type.empty() ? "message without a type" : "unknown type '" + type + "'";
  return ParseStatus::UnknownType;
}

}  // namespace drone
