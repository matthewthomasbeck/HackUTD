#include "core/config.hpp"

#include <algorithm>
#include <stdexcept>

namespace robot {

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
         std::find(kPicoDevices.begin(), kPicoDevices.end(), name) != kPicoDevices.end();
}

Config parse(const YAML::Node& root) {
  Config c;
  c.robot_id = get_string(root, "robot.robot_id");
  c.robot_name = get_string(root, "robot.name");
  require(!c.robot_id.empty(), "robot.robot_id must not be empty");

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

  // Pi devices have their own `mock` key; the light uses `impl`; Pico devices follow `pico.mock`.
  for (const auto& name : kPiDevices) {
    c.mock[name] = (name == "light") ? get_string(root, "light.impl") == "mock" : get_bool(root, name + ".mock");
  }
  for (const auto& name : kPicoDevices) c.mock[name] = c.mock["pico"];

  c.pico_heartbeat_hz = get_int(root, "pico.heartbeat_hz");
  c.pico_link_timeout_ms = get_int(root, "pico.link_timeout_ms");
  require(c.pico_heartbeat_hz > 0, "pico.heartbeat_hz must be > 0");
  require(c.pico_link_timeout_ms > 0, "pico.link_timeout_ms must be > 0");

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
  c.safe_stop_servo_action = get_string(root, "safe_stop.servo_action");
  require(c.safe_stop_servo_action == "hold" || c.safe_stop_servo_action == "release",
          "safe_stop.servo_action must be hold or release");

  c.terrain_slow_scale = get_number(root, "terrain.slow_scale");
  require(c.terrain_slow_scale > 0 && c.terrain_slow_scale <= 1, "terrain.slow_scale must be in (0, 1]");

  c.missions_auto_start = get_bool(root, "missions.auto_start");

  c.breathing_clip_s = get_int(root, "breathing.clip_s");
  require(c.breathing_clip_s >= 15, "breathing.clip_s must be >= 15 (the breathing check needs at least 15 s)");

  c.control_socket = get_string(root, "control.socket");
  require(!c.control_socket.empty(), "control.socket must not be empty");

  for (const auto& name : {"maestro_a", "maestro_b", "dc_driver_a", "dc_driver_b"}) {
    c.device_path[name] = get_string(root, std::string(name) + ".path");
    c.device_baud[name] = get_int(root, std::string(name) + ".baud");
  }
  c.device_path["pico"] = get_string(root, "pico.path");
  c.camera_width = get_int(root, "camera.width");
  c.camera_height = get_int(root, "camera.height");
  c.camera_fps = get_number(root, "camera.clip_fps");
  require(c.camera_width > 0 && c.camera_height > 0, "camera.width and camera.height must be > 0");
  require(c.camera_fps > 0, "camera.clip_fps must be > 0");

  c.movement_rate_hz = get_number(root, "movement.rate_hz");
  c.movement_command_timeout_ms = get_number(root, "movement.command_timeout_ms");
  require(c.movement_rate_hz > 0 && c.movement_rate_hz <= 1000, "movement.rate_hz must be in (0, 1000]");
  // The dead-man must outlast a few main ticks, or a normal tick would trip it.
  require(c.movement_command_timeout_ms >= 2 * 1000.0 / c.loop.rate_hz,
          "movement.command_timeout_ms must be at least 2 main loop periods");
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
  for (const auto* group : {&kPiDevices, &kPicoDevices}) {
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

}  // namespace robot
