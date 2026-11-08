#include "core/config.hpp"

#include <sys/un.h>

#include <algorithm>
#include <set>
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
  c.pico_firmware_version = get_string(root, "pico.firmware_version");
  require(!c.pico_firmware_version.empty(), "pico.firmware_version must not be empty");
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

  c.missions_auto_start = get_bool(root, "missions.auto_start");

  c.breathing_clip_s = get_int(root, "breathing.clip_s");
  require(c.breathing_clip_s >= 15, "breathing.clip_s must be >= 15 (the breathing check needs at least 15 s)");

  c.control_socket = get_string(root, "control.socket");
  c.media_dir = get_string(root, "media_dir");
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

  for (const auto& name : {"maestro_a", "maestro_b"}) {
    c.device_path[name] = get_string(root, std::string(name) + ".path");
    c.device_baud[name] = get_int(root, std::string(name) + ".baud");
  }
  std::set<int> motor_pins;
  for (const std::string name : {"dc_driver_a", "dc_driver_b"}) {
    DcDriverSettings d;
    d.pwm_hz = get_int(root, name + ".pwm_hz");
    d.min_duty = get_number(root, name + ".min_duty");
    require(d.pwm_hz > 0, name + ".pwm_hz must be > 0");
    require(d.min_duty >= 0 && d.min_duty < 1, name + ".min_duty must be in [0, 1)");
    for (int ch = 0; ch < 2; ++ch) {
      const std::string key = name + ".ch" + std::to_string(ch) + "_pins";
      const auto pins = get<std::vector<int>>(root, key, "a list of 2 GPIO numbers");
      require(pins.size() == 2, key + " must list 2 GPIO numbers [IN1, IN2]");
      for (std::size_t i = 0; i < 2; ++i) {
        require(pins[i] >= 2 && pins[i] <= 27, key + " pins must be BCM GPIO 2 to 27");
        require(motor_pins.insert(pins[i]).second, key + " reuses GPIO " + std::to_string(pins[i]));
        d.pins[static_cast<std::size_t>(ch)][i] = pins[i];
      }
    }
    c.dc_driver[name] = d;
  }

  ThermalConfig& th = c.thermal;
  th.fov_h_deg = get_number(root, "thermal.fov_h_deg");
  th.yaw_offset_deg = get_number(root, "thermal.yaw_offset_deg");
  th.flip_x = get_bool(root, "thermal.flip_x");
  th.delta_c = get_number(root, "thermal.delta_c");
  th.min_c = get_number(root, "thermal.min_c");
  th.max_c = get_number(root, "thermal.max_c");
  th.min_blob_px = get_int(root, "thermal.min_blob_px");
  th.max_blob_frac = get_number(root, "thermal.max_blob_frac");
  th.persist_frames = get_int(root, "thermal.persist_frames");
  th.persist_window = get_int(root, "thermal.persist_window");
  th.persist_px = get_number(root, "thermal.persist_px");
  th.contrast_full_c = get_number(root, "thermal.contrast_full_c");
  for (const auto& m : get<std::vector<std::vector<int>>>(root, "thermal.mask", "a list of [col0, row0, col1, row1]")) {
    require(m.size() == 4, "thermal.mask entries must be [col0, row0, col1, row1]");
    th.mask.push_back({m[0], m[1], m[2], m[3]});
  }
  require(th.fov_h_deg > 0 && th.delta_c > 0 && th.min_c < th.max_c, "thermal.fov_h_deg, delta_c, min_c < max_c");
  require(th.persist_frames >= 1 && th.persist_frames <= th.persist_window, "thermal.persist_frames must be 1..persist_window");

  SeekConfig& sk = c.seek;
  sk.scan_wz_dps = get_number(root, "scan.rotate_wz_dps");
  sk.standoff_m = get_number(root, "inspect.standoff_m");
  sk.scan_step_s = get_number(root, "seek.scan_step_s");
  sk.scan_dwell_s = get_number(root, "seek.scan_dwell_s");
  sk.scan_max_s = get_number(root, "seek.scan_max_s");
  sk.turn_gain = get_number(root, "seek.turn_gain");
  sk.max_turn_dps = get_number(root, "seek.max_turn_dps");
  sk.center_deg = get_number(root, "seek.center_deg");
  sk.approach_mps = get_number(root, "seek.approach_mps");
  sk.close_frac = get_number(root, "seek.close_frac");
  sk.lost_s = get_number(root, "seek.lost_s");
  sk.approach_timeout_s = get_number(root, "seek.approach_timeout_s");
  sk.ld19_front_deg = get_number(root, "seek.ld19_front_deg");
  sk.ld19_clockwise = get_bool(root, "seek.ld19_clockwise");
  sk.ld19_window_deg = get_number(root, "seek.ld19_window_deg");
  sk.blocked_m = get_number(root, "seek.blocked_m");
  sk.front_sector_deg = get_number(root, "seek.front_sector_deg");
  sk.lock_deg = get_number(root, "seek.lock_deg");
  require(sk.standoff_m > 0 && sk.approach_mps > 0 && sk.scan_step_s > 0 && sk.center_deg > 0,
          "inspect.standoff_m, seek.approach_mps, seek.scan_step_s and seek.center_deg must be > 0");

  // terrain.* (docs/specs/robot.md section 7b). It shares the LD19 mounting with seek.* and the
  // yaw axis with heading.*, so the same sensor is never described twice.
  TerrainConfig& tr = c.terrain;
  tr.impl = get_string(root, "terrain.impl");
  require(tr.impl == "rules" || tr.impl == "mock", "terrain.impl must be rules or mock");
  tr.front_sector_deg = get_number(root, "terrain.front_sector_deg");
  tr.lidar_single_mode = get_string(root, "terrain.lidar_single_mode");
  require(tr.lidar_single_mode == "forward" || tr.lidar_single_mode == "down",
          "terrain.lidar_single_mode must be forward or down");
  tr.ground_range_m = get_number(root, "terrain.ground_range_m");
  require(tr.lidar_single_mode != "down" || tr.ground_range_m > 0,
          "terrain.ground_range_m must be > 0 when terrain.lidar_single_mode is down (TBD from Matthew)");
  tr.tilt_lpf_alpha = get_number(root, "terrain.tilt_lpf_alpha");
  require(tr.tilt_lpf_alpha > 0 && tr.tilt_lpf_alpha <= 1, "terrain.tilt_lpf_alpha must be in (0, 1]");
  tr.use_force = get_bool(root, "terrain.use_force");
  // The FSRs' meaning is TBD and there is no force rule format yet, so they cannot be turned on.
  require(!tr.use_force, "terrain.use_force must stay false until Matthew says what each force sensor measures");
  tr.missing_input_penalty = get_number(root, "terrain.missing_input_penalty");
  tr.blocked_m = get_number(root, "terrain.blocked_m");
  tr.clear_m = get_number(root, "terrain.clear_m");
  tr.steer_span_deg = get_number(root, "terrain.steer_span_deg");
  tr.gap_drop_m = get_number(root, "terrain.gap_drop_m");
  tr.max_pitch_deg = get_number(root, "terrain.max_pitch_deg");
  tr.max_roll_deg = get_number(root, "terrain.max_roll_deg");
  tr.step_rise_m = get_number(root, "terrain.step_rise_m");
  tr.max_step_m = get_number(root, "terrain.max_step_m");
  tr.bump_window_s = get_number(root, "terrain.bump_window_s");
  tr.bump_gyro_dps = get_number(root, "terrain.bump_gyro_dps");
  tr.debris_range_var = get_number(root, "terrain.debris_range_var");
  for (std::size_t i = 0; i < kTerrainClasses.size(); ++i) {
    const std::string key = std::string("terrain.base_confidence.") + to_string(kTerrainClasses[i]);
    tr.base_confidence[i] = get_number(root, key);
    require(tr.base_confidence[i] >= 0 && tr.base_confidence[i] <= 1, key + " must be in [0, 1]");
  }
  tr.agree_bonus = get_number(root, "terrain.agree_bonus");
  tr.hold_ticks = get_int(root, "terrain.hold_ticks");
  tr.slow_scale = get_number(root, "terrain.slow_scale");
  require(tr.slow_scale > 0 && tr.slow_scale <= 1, "terrain.slow_scale must be in (0, 1]");
  tr.report_max_hz = get_number(root, "terrain.report_max_hz");
  tr.report_keepalive_s = get_number(root, "terrain.report_keepalive_s");
  for (const auto& name : get_strings(root, "terrain.mock_sequence")) {
    const auto cls = parse_terrain_class(name);
    require(cls.has_value(), "terrain.mock_sequence: unknown class " + name);
    tr.mock_sequence.push_back(*cls);
  }
  tr.mock_step_s = get_number(root, "terrain.mock_step_s");
  tr.camera_hint.enabled = get_bool(root, "terrain.camera_hint.enabled");
  tr.camera_hint.frame_every_s = get_number(root, "terrain.camera_hint.frame_every_s");
  tr.camera_hint.max_age_ms = get_number(root, "terrain.camera_hint.max_age_ms");
  tr.camera_hint.weight = get_number(root, "terrain.camera_hint.weight");
  require(tr.front_sector_deg > 0 && tr.front_sector_deg <= 360 && tr.steer_span_deg >= 15 && tr.steer_span_deg <= 360,
          "terrain.front_sector_deg must be in (0, 360] and terrain.steer_span_deg in [15, 360]");
  require(tr.blocked_m > 0 && tr.clear_m > tr.blocked_m, "terrain.clear_m must be greater than terrain.blocked_m > 0");
  require(tr.hold_ticks >= 1 && tr.bump_window_s > 0 && tr.report_max_hz > 0 && tr.report_keepalive_s >= 0,
          "terrain.hold_ticks >= 1, terrain.bump_window_s > 0, terrain.report_max_hz > 0, keepalive >= 0");
  require(tr.camera_hint.frame_every_s > 0 && tr.camera_hint.max_age_ms > 0 && tr.camera_hint.weight >= 0 &&
              tr.camera_hint.weight <= 1,
          "terrain.camera_hint: frame_every_s and max_age_ms > 0, weight in [0, 1]");
  tr.ld19 = Ld19Mount{sk.ld19_front_deg, sk.ld19_clockwise};
  tr.gyro_yaw_axis = c.location.heading_gyro_axis;

  LegsSettings& legs = c.legs;
  legs.impl = get_string(root, "legs.impl");
  require(legs.impl == "mock" || legs.impl == "two_link", "legs.impl must be mock or two_link");
  legs.l1_m = get_number(root, "legs.l1_m");
  legs.l2_m = get_number(root, "legs.l2_m");
  legs.stance_height_m = get_number(root, "legs.stance_height_m");
  legs.stance_x_m = get_number(root, "legs.stance_x_m");
  legs.knee_bend = get_int(root, "legs.knee_bend");
  legs.max_rate_us_per_s = get_number(root, "servos.max_rate_us_per_s");
  require(legs.knee_bend == 1 || legs.knee_bend == -1, "legs.knee_bend must be 1 or -1");
  static const char* const leg_names[4] = {"FL", "FR", "BL", "BR"};
  static const char* const joint_names[3] = {"abduction", "hip", "knee"};
  std::set<std::pair<int, int>> servo_channels;
  for (int l = 0; l < 4; ++l) {
    for (int j = 0; j < 3; ++j) {
      const std::string key = std::string("legs.joints.") + leg_names[l] + "_" + joint_names[j];
      JointSettings& s = legs.joints[static_cast<std::size_t>(l)][static_cast<std::size_t>(j)];
      s.bus = get_int(root, key + ".bus");
      s.channel = get_int(root, key + ".channel");
      s.zero_us = get_number(root, key + ".zero_us");
      s.us_per_rad = get_number(root, key + ".us_per_rad");
      s.direction = get_int(root, key + ".direction");
      s.min_us = get_number(root, key + ".min_us");
      s.max_us = get_number(root, key + ".max_us");
      require(s.bus == 0 || s.bus == 1, key + ".bus must be 0 (Maestro A) or 1 (Maestro B)");
      require(s.channel >= -1 && s.channel <= 23, key + ".channel must be -1 (not wired) or 0 to 23");
      require(s.direction == 1 || s.direction == -1, key + ".direction must be 1 or -1");
      require(s.us_per_rad >= 0, key + ".us_per_rad must be >= 0 (0 means not calibrated)");
      require(s.min_us >= 500 && s.max_us <= 2500 && s.min_us <= s.max_us,
              key + ".min_us and max_us must be within 500..2500 us, min <= max");
      if (s.channel >= 0) {
        require(servo_channels.insert({s.bus, s.channel}).second,
                key + " reuses Maestro " + std::to_string(s.bus) + " channel " + std::to_string(s.channel));
      }
    }
  }
  if (legs.impl == "two_link") {
    require(legs.l1_m > 0 && legs.l2_m > 0, "legs.l1_m and legs.l2_m must be > 0 for two_link");
    require(legs.stance_height_m > 0, "legs.stance_height_m must be > 0 for two_link");
    require(legs.max_rate_us_per_s > 0, "servos.max_rate_us_per_s must be > 0 for two_link, so legs never jump");
  }

  MecanumSettings& m = c.mecanum;
  m.wheel_radius_m = get_number(root, "motion.mecanum.wheel_radius_m");
  m.half_track_lx_m = get_number(root, "motion.mecanum.half_track_lx_m");
  m.half_base_ly_m = get_number(root, "motion.mecanum.half_base_ly_m");
  m.max_wheel_rad_s = get_number(root, "motion.mecanum.max_wheel_rad_s");
  require(m.wheel_radius_m >= 0 && m.half_track_lx_m >= 0 && m.half_base_ly_m >= 0 && m.max_wheel_rad_s >= 0,
          "motion.mecanum dimensions must be >= 0 (0 means TBD)");
  const auto order = get<std::vector<int>>(root, "motion.mecanum.wheel_order", "a list of 4 integers");
  const auto invert = get<std::vector<bool>>(root, "motion.mecanum.invert", "a list of 4 true/false");
  require(order.size() == 4 && invert.size() == 4, "motion.mecanum.wheel_order and invert must list 4 values");
  const std::set<int> order_set(order.begin(), order.end());
  require(order_set == std::set<int>{1, 2, 3, 4}, "motion.mecanum.wheel_order must use each of 1, 2, 3, 4 once");
  for (std::size_t i = 0; i < 4; ++i) {
    m.wheel_order[i] = order[i];
    m.invert[i] = invert[i];
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
