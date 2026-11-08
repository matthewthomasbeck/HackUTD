#include "core/config.hpp"

#include <sys/un.h>

#include <algorithm>
#include <set>
#include <stdexcept>

namespace drone {

namespace {

// Thrown inside this file only; load_config_node turns it into ConfigResult.error.
struct ConfigError : std::runtime_error {
  using std::runtime_error::runtime_error;
};

// Walks a dotted key like "loop.rate_hz" one part at a time (iterative, no recursion).
// yaml-cpp gotcha: `node = other` copies the value INTO node's tree, so we rebind with reset().
YAML::Node find(const YAML::Node& root, const std::string& dotted) {
  YAML::Node current;
  current.reset(root);
  std::size_t start = 0;
  while (start <= dotted.size()) {
    const std::size_t dot = dotted.find('.', start);
    const std::string part = dotted.substr(start, dot == std::string::npos ? std::string::npos : dot - start);
    const YAML::Node& as_const = current;
    if (!as_const.IsMap() || !as_const[part]) throw ConfigError("missing key " + dotted);
    YAML::Node next = as_const[part];
    current.reset(next);
    if (dot == std::string::npos) break;
    start = dot + 1;
  }
  return current;
}

template <typename T>
T get(const YAML::Node& root, const std::string& key, const char* type_name) {
  const YAML::Node node = find(root, key);
  try {
    return node.as<T>();
  } catch (const YAML::Exception&) {
    throw ConfigError(key + " must be " + type_name);
  }
}

double get_number(const YAML::Node& root, const std::string& key) { return get<double>(root, key, "a number"); }
int get_int(const YAML::Node& root, const std::string& key) { return get<int>(root, key, "an integer"); }
bool get_bool(const YAML::Node& root, const std::string& key) { return get<bool>(root, key, "true or false"); }
std::string get_string(const YAML::Node& root, const std::string& key) { return get<std::string>(root, key, "a string"); }
std::vector<std::string> get_strings(const YAML::Node& root, const std::string& key) {
  return get<std::vector<std::string>>(root, key, "a list of names");
}

void require(bool condition, const std::string& message) {
  if (!condition) throw ConfigError(message);
}

bool is_known_device(const std::string& name) {
  return std::find(kPiDevices.begin(), kPiDevices.end(), name) != kPiDevices.end() ||
         std::find(kMcuDevices.begin(), kMcuDevices.end(), name) != kMcuDevices.end();
}

Config parse(const YAML::Node& root) {
  Config c;
  c.robot_id = get_string(root, "drone.robot_id");
  c.name = get_string(root, "drone.name");
  require(!c.robot_id.empty(), "drone.robot_id must not be empty");

  c.loop.rate_hz = get_number(root, "loop.rate_hz");
  c.loop.overrun_factor = get_number(root, "loop.overrun_factor");
  c.loop.overrun_ticks = get_int(root, "loop.overrun_ticks");
  require(c.loop.rate_hz > 0 && c.loop.rate_hz <= 1000, "loop.rate_hz must be in (0, 1000]");
  require(c.loop.overrun_factor >= 1.0, "loop.overrun_factor must be >= 1");
  require(c.loop.overrun_ticks >= 1, "loop.overrun_ticks must be >= 1");

  c.init_device_timeout_ms = get_int(root, "init.device_timeout_ms");
  c.fault_max_retries = get_int(root, "fault.max_retries");
  c.shutdown_timeout_ms = get_int(root, "shutdown.timeout_ms");
  require(c.init_device_timeout_ms > 0, "init.device_timeout_ms must be > 0");
  require(c.fault_max_retries >= 0, "fault.max_retries must be >= 0");
  require(c.shutdown_timeout_ms > 0, "shutdown.timeout_ms must be > 0");

  c.devices_required = get_strings(root, "devices.required");
  c.devices_optional = get_strings(root, "devices.optional");
  std::set<std::string> seen;
  for (const auto* list : {&c.devices_required, &c.devices_optional}) {
    for (const auto& name : *list) {
      require(is_known_device(name), "unknown device '" + name + "' in devices.required or devices.optional");
      require(seen.insert(name).second, "device '" + name + "' is listed twice in devices.required/optional");
    }
  }

  // Pi devices have their own `mock` key; MCU devices follow `mcu.mock`.
  for (const auto& name : kPiDevices) c.mock[name] = get_bool(root, name + ".mock");
  for (const auto& name : kMcuDevices) c.mock[name] = c.mock["mcu"];

  c.mcu_path = get_string(root, "mcu.path");
  c.mcu_heartbeat_hz = get_int(root, "mcu.heartbeat_hz");
  c.mcu_link_timeout_ms = get_int(root, "mcu.link_timeout_ms");
  c.mcu_firmware_version = get_string(root, "mcu.firmware_version");
  require(!c.mcu_firmware_version.empty(), "mcu.firmware_version must not be empty");
  require(c.mcu_heartbeat_hz > 0, "mcu.heartbeat_hz must be > 0");
  require(c.mcu_link_timeout_ms > 0, "mcu.link_timeout_ms must be > 0");

  const YAML::Node stale = find(root, "stale_ms");
  require(stale.IsMap(), "stale_ms must be a map of device name to milliseconds");
  for (const auto& entry : stale) {
    const std::string name = entry.first.as<std::string>();
    require(is_known_device(name), "unknown device '" + name + "' in stale_ms");
    c.stale_ms[name] = get_int(root, "stale_ms." + name);
    require(c.stale_ms[name] > 0, "stale_ms." + name + " must be > 0");
  }

  c.limits.max_lin_mps = get_number(root, "limits.max_lin_mps");
  c.limits.max_ang_dps = get_number(root, "limits.max_ang_dps");
  c.limits.max_lin_accel = get_number(root, "limits.max_lin_accel");
  c.limits.max_ang_accel = get_number(root, "limits.max_ang_accel");
  c.limits.reject_factor = get_number(root, "limits.reject_factor");
  require(c.limits.max_lin_mps > 0, "limits.max_lin_mps must be > 0");
  require(c.limits.max_ang_dps > 0, "limits.max_ang_dps must be > 0");
  require(c.limits.max_lin_accel > 0, "limits.max_lin_accel must be > 0");
  require(c.limits.max_ang_accel > 0, "limits.max_ang_accel must be > 0");
  require(c.limits.reject_factor > 1, "limits.reject_factor must be > 1");

  c.estop_sense = get_string(root, "estop.sense");
  c.missions_auto_start = get_bool(root, "missions.auto_start");
  c.teleop_deadman_ms = get_number(root, "teleop.deadman_ms");
  require(c.teleop_deadman_ms >= 100 && c.teleop_deadman_ms <= 2000, "teleop.deadman_ms must be 100..2000");

  c.control_socket = get_string(root, "control.socket");
  require(!c.control_socket.empty(), "control.socket must not be empty");
  require(c.control_socket.size() < sizeof(sockaddr_un{}.sun_path), "control.socket path is too long for a Unix socket");

  BridgeSettings& b = c.bridge;
  b.socket = get_string(root, "bridge.socket");
  b.heartbeat_hz = get_number(root, "bridge.heartbeat_hz");
  b.position_hz = get_number(root, "bridge.position_hz");
  b.outbox = get_string(root, "bridge.outbox");
  const int test_mission = get_int(root, "bridge.test_mission_id");
  require(!b.socket.empty(), "bridge.socket must not be empty");
  require(b.socket.size() < sizeof(sockaddr_un{}.sun_path), "bridge.socket path is too long for a Unix socket");
  // The module marks the robot offline after 5 s without a heartbeat, so stay well inside that.
  require(b.heartbeat_hz >= 0.5 && b.heartbeat_hz <= c.loop.rate_hz,
          "bridge.heartbeat_hz must be in [0.5, loop.rate_hz] (the module's offline rule is 5 s)");
  require(b.position_hz > 0 && b.position_hz <= c.loop.rate_hz, "bridge.position_hz must be in (0, loop.rate_hz]");
  require(test_mission >= 0, "bridge.test_mission_id must be >= 0 (0: no test mission)");
  b.test_mission_id = static_cast<std::uint64_t>(test_mission);

  SiteSettings& site = c.site;
  site.demo_mode_default = get_bool(root, "site.demo_mode_default");
  site.center_lat = get_number(root, "site.center_lat");
  site.center_lon = get_number(root, "site.center_lon");
  site.radius_m = get_number(root, "site.radius_m");
  require(site.center_lat >= -90 && site.center_lat <= 90, "site.center_lat must be in [-90, 90]");
  require(site.center_lon >= -180 && site.center_lon <= 180, "site.center_lon must be in [-180, 180]");
  require(site.radius_m > 0, "site.radius_m must be > 0");

  LocationSettings& loc = c.location;
  loc.force_demo = get_bool(root, "location.force_demo");
  loc.home_lat = get_number(root, "home.lat");
  loc.home_lon = get_number(root, "home.lon");
  require(loc.home_lat >= -90 && loc.home_lat <= 90, "home.lat must be in [-90, 90]");
  require(loc.home_lon >= -180 && loc.home_lon <= 180, "home.lon must be in [-180, 180]");
  loc.heading_initial_deg = get_number(root, "heading.initial_deg");
  loc.heading_gps_min_speed_mps = get_number(root, "heading.gps_min_speed_mps");
  loc.heading_source = get_string(root, "heading.source");
  loc.heading_gyro_axis = get_string(root, "heading.gyro_axis");
  loc.heading_gyro_sign = get_int(root, "heading.gyro_sign");
  require(loc.heading_initial_deg >= 0 && loc.heading_initial_deg < 360, "heading.initial_deg must be in [0, 360)");
  require(loc.heading_gps_min_speed_mps >= 0, "heading.gps_min_speed_mps must be >= 0");
  require(loc.heading_source == "imu" || loc.heading_source == "commanded", "heading.source must be imu or commanded");
  require(loc.heading_gyro_axis == "x" || loc.heading_gyro_axis == "y" || loc.heading_gyro_axis == "z",
          "heading.gyro_axis must be x, y, or z");
  require(loc.heading_gyro_sign == 1 || loc.heading_gyro_sign == -1, "heading.gyro_sign must be 1 or -1");
  loc.odometry_scale = get_number(root, "odometry.scale");
  require(loc.odometry_scale > 0 && loc.odometry_scale <= 10, "odometry.scale must be in (0, 10]");
  loc.paths_file = get_string(root, "paths_file");

  c.camera_width = get_int(root, "camera.width");
  c.camera_height = get_int(root, "camera.height");
  c.camera_fps = get_number(root, "camera.fps");
  require(c.camera_width > 0 && c.camera_height > 0, "camera.width and camera.height must be > 0");
  require(c.camera_fps > 0, "camera.fps must be > 0");

  c.flight_rate_hz = get_number(root, "flight.rate_hz");
  c.flight_command_timeout_ms = get_number(root, "flight.command_timeout_ms");
  require(c.flight_rate_hz > 0 && c.flight_rate_hz <= 1000, "flight.rate_hz must be in (0, 1000]");
  // The dead-man must outlast a few main ticks, or a normal tick would trip it.
  require(c.flight_command_timeout_ms >= 2 * 1000.0 / c.loop.rate_hz,
          "flight.command_timeout_ms must be at least 2 main loop periods");
  c.vision_rate_hz = get_number(root, "vision.rate_hz");
  c.vision_model_path = get_string(root, "vision.model_path");
  c.vision_labels_path = get_string(root, "vision.labels_path");
  c.vision_min_score = get_number(root, "vision.min_score");
  require(c.vision_rate_hz > 0, "vision.rate_hz must be > 0");
  require(c.vision_min_score >= 0 && c.vision_min_score <= 1, "vision.min_score must be in [0, 1]");
  c.workers_stall_ms = get_number(root, "workers.stall_ms");
  require(c.workers_stall_ms > 0, "workers.stall_ms must be > 0");
  return c;
}

}  // namespace

bool Config::is_required(const std::string& device) const {
  return std::find(devices_required.begin(), devices_required.end(), device) != devices_required.end();
}

bool Config::is_mock(const std::string& device) const {
  const auto it = mock.find(device);
  return it != mock.end() && it->second;
}

std::vector<std::string> Config::devices_in_init_order() const {
  std::vector<std::string> out;
  for (const auto* group : {&kPiDevices, &kMcuDevices}) {
    for (const auto& name : *group) {
      const bool listed = is_required(name) ||
                          std::find(devices_optional.begin(), devices_optional.end(), name) != devices_optional.end();
      if (listed) out.push_back(name);
    }
  }
  return out;
}

ConfigResult load_config_node(const YAML::Node& root) {
  ConfigResult result;
  try {
    result.config = parse(root);
    result.ok = true;
  } catch (const ConfigError& e) {
    result.error = e.what();
  }
  return result;
}

ConfigResult load_config_file(const std::string& path) {
  try {
    return load_config_node(YAML::LoadFile(path));
  } catch (const YAML::Exception& e) {
    ConfigResult result;
    result.error = "cannot read " + path + ": " + e.what();
    return result;
  }
}

}  // namespace drone
