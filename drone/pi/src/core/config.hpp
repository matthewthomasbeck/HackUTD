#pragma once

// Drone config (docs/specs/drone.md section "Config"; the dog's is docs/specs/robot.md section 15).
// load_config() is the BOOT step: it reads the YAML file, checks types and ranges, and either
// returns a Config or an error that names the bad key. An invalid config sends BOOT to SHUTDOWN.
//
// The drone hardware is not confirmed, so every device key in drone.yaml is TBD. Only the keys the
// program uses are here; a key the dog has for hardware the drone lacks (legs, wheels, thermal,
// terrain, breathing clips) is left out rather than invented.

#include <cstdint>
#include <map>
#include <string>
#include <vector>

#include <yaml-cpp/yaml.h>

namespace drone {

// Devices on the Pi, in init order. "flight_output" stands where the dog's motor drivers stand
// (hal/flight_output.hpp); "detector" is the vision model (the dog calls it "coral"); "gps" is a
// placeholder, as on the dog.
inline const std::vector<std::string> kPiDevices = {"flight_output", "mcu", "camera", "detector", "gps"};

// Devices behind the MCU. They are brought up only after the MCU link is OK.
// Only the IMU, mirroring the dog's; which sensors the drone MCU really has is TBD.
inline const std::vector<std::string> kMcuDevices = {"imu"};

struct LoopConfig {
  double rate_hz = 0;         // fixed main loop rate
  double overrun_factor = 0;  // a tick longer than factor x period counts as overrun
  int overrun_ticks = 0;      // this many overruns in a row raise loop_overrun
};

struct LimitsConfig {
  double max_lin_mps = 0;    // per axis, vx and vy
  double max_ang_dps = 0;    // wz, degrees per second
  double max_lin_accel = 0;  // m/s^2
  double max_ang_accel = 0;  // deg/s^2
  double reject_factor = 0;  // a command above factor x limit is a bug: reject, do not clamp
};

// bridge.* (same keys as the dog, docs/specs/robot.md sections 4.3 and 10.2).
struct BridgeSettings {
  std::string socket;               // Unix socket the Node.js bridge listens on
  double heartbeat_hz = 0;          // heartbeat rate; the module marks the robot offline after 5 s
  double position_hz = 0;           // position rate
  std::string outbox;               // important lines saved while the bridge is gone; empty disables
  std::uint64_t test_mission_id = 0;  // TEST HOOK: `dronectl test_detection` uses it with no mission running
};

// site.* until the bridge's first `site` message (robot.md 9.4).
struct SiteSettings {
  bool demo_mode_default = true;
  double center_lat = 0, center_lon = 0;
  double radius_m = 0;
};

// location.*, home.*, heading.*, odometry.* (robot.md section 8).
struct LocationSettings {
  bool force_demo = false;
  double home_lat = 0, home_lon = 0;  // TBD demo coordinates
  double heading_initial_deg = 0;
  double heading_gps_min_speed_mps = 0;
  std::string heading_source;       // imu | commanded (commanded: integrate the commanded turn rate)
  std::string heading_gyro_axis;    // x | y | z, TBD per IMU mounting
  int heading_gyro_sign = 1;        // 1 | -1, TBD: +1 if a positive gyro reading is a clockwise turn
  double odometry_scale = 0;        // TBD
  std::string paths_file;           // demo_paths.yaml (anchor and waypoints)
};

struct Config {
  std::string robot_id;  // the SpacetimeDB robot.robot_id, drone1
  std::string name;
  LoopConfig loop;
  int init_device_timeout_ms = 0;
  int fault_max_retries = 0;
  int shutdown_timeout_ms = 0;
  std::vector<std::string> devices_required;
  std::vector<std::string> devices_optional;
  std::map<std::string, bool> mock;  // device name -> uses the mock implementation
  std::string mcu_path;              // mcu.path, TBD (no udev rule yet)
  int mcu_heartbeat_hz = 0;
  int mcu_link_timeout_ms = 0;
  std::string mcu_firmware_version;  // PONG must match, else the MCU is FAILED
  std::map<std::string, int> stale_ms;  // device name -> data older than this is stale
  LimitsConfig limits;
  std::string estop_sense;  // "none" until a sense line is wired
  bool missions_auto_start = false;
  double teleop_deadman_ms = 300;  // teleop.deadman_ms: no command this long, the drone stops
  std::string control_socket;
  BridgeSettings bridge;
  SiteSettings site;
  LocationSettings location;

  int camera_width = 0;
  int camera_height = 0;
  double camera_fps = 0;

  // Threads (same as the dog, docs/specs/robot.md section 4.2, with movement renamed flight).
  double flight_rate_hz = 0;             // flight thread rate
  double flight_command_timeout_ms = 0;  // dead-man: stop if main sends nothing for this long
  double vision_rate_hz = 0;             // vision thread: how often it looks for a new frame
  std::string vision_model_path;         // TBD
  std::string vision_labels_path;        // TBD
  double vision_min_score = 0;
  double workers_stall_ms = 0;  // a worker whose heartbeat is older than this is stuck

  bool is_required(const std::string& device) const;
  bool is_mock(const std::string& device) const;
  // Every device named in devices.required or devices.optional, in init order.
  std::vector<std::string> devices_in_init_order() const;
};

struct ConfigResult {
  bool ok = false;
  Config config;
  std::string error;  // set when ok is false; names the key
};

ConfigResult load_config_file(const std::string& path);
ConfigResult load_config_node(const YAML::Node& root);

}  // namespace drone
