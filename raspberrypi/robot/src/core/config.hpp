#pragma once

// Robot config (docs/specs/robot.md section 15).
// load_config() is the BOOT step: it reads the YAML file, checks types and ranges, and either
// returns a Config or an error that names the bad key. An invalid config sends BOOT to SHUTDOWN.
//
// Only the keys the program uses so far are copied into the struct. The YAML file keeps every
// key from section 15 so later tasks (R2 to R9) can read theirs without changing the file.

#include <array>
#include <cstdint>
#include <map>
#include <set>
#include <string>
#include <vector>

#include <yaml-cpp/yaml.h>

#include "mission/seek_config.hpp"
#include "perception/thermal_detector.hpp"

namespace robot {

// Devices on the Pi, in init order (docs/specs/robot.md section 4.1), then the light.
// "coral" is the Edge TPU with the vision model loaded on it.
inline const std::vector<std::string> kPiDevices = {
    "maestro_a", "maestro_b", "dc_driver_a", "dc_driver_b", "pico", "camera", "coral", "gps", "light"};

// Devices behind the Pico. They are brought up only after the Pico link is OK.
inline const std::vector<std::string> kPicoDevices = {"imu", "thermal", "ads1115", "lidar_single", "ld19"};

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

// dc_driver_a / dc_driver_b: dual H-bridge on GPIO PWM (docs/ROBOT.md "Pi 4B GPIO").
struct DcDriverSettings {
  int pwm_hz = 0;
  std::array<std::array<int, 2>, 2> pins{};  // [channel][IN1, IN2], BCM GPIO numbers
  double min_duty = 0;                        // smallest duty that turns a wheel, TBD
};

// motion.mecanum.* (docs/specs/robot.md section 12.4); 0 means TBD.
struct MecanumSettings {
  double wheel_radius_m = 0;
  double half_track_lx_m = 0;
  double half_base_ly_m = 0;
  double max_wheel_rad_s = 0;
  std::array<int, 4> wheel_order{1, 2, 3, 4};
  std::array<bool, 4> invert{false, false, false, false};
};

// legs.joints.<LEG>_<joint>: one leg servo's calibration (robot_diag legcal).
struct JointSettings {
  int bus = 0;
  int channel = -1;
  double zero_us = 1500;
  double us_per_rad = 0;
  int direction = 1;
  double min_us = 1500;
  double max_us = 1500;
};

// legs.* (docs/specs/robot.md section 12.5).
struct LegsSettings {
  std::string impl;  // mock | two_link
  double l1_m = 0, l2_m = 0, stance_height_m = 0, stance_x_m = 0;
  int knee_bend = 1;
  std::array<std::array<JointSettings, 3>, 4> joints{};  // [FL FR BL BR][abduction hip knee]
  double max_rate_us_per_s = 0;                           // servos.max_rate_us_per_s
};

// bridge.* (docs/specs/robot.md sections 4.3 and 10.2).
struct BridgeSettings {
  std::string socket;               // Unix socket the Node.js bridge listens on
  double heartbeat_hz = 0;          // heartbeat rate; the module marks the robot offline after 5 s
  double position_hz = 0;           // position rate
  std::string outbox;               // important lines saved while the bridge is gone; empty disables
  std::uint64_t test_mission_id = 0;  // TEST HOOK: `robotctl test_detection` uses it with no mission running
};

// site.* until the bridge's first `site` message (robot.md 9.4).
struct SiteSettings {
  bool demo_mode_default = true;
  double center_lat = 0, center_lon = 0;  // TBD demo coordinates
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
  double odometry_scale = 0;        // TBD: drive 2 m and measure
  std::string paths_file;           // demo_paths.yaml (anchor and waypoints)
};

struct Config {
  std::string robot_id;
  std::string robot_name;
  LoopConfig loop;
  int init_device_timeout_ms = 0;
  int fault_max_retries = 0;
  int shutdown_timeout_ms = 0;
  std::vector<std::string> devices_required;
  std::vector<std::string> devices_optional;
  std::map<std::string, bool> mock;  // device name -> uses the mock implementation
  int pico_heartbeat_hz = 0;
  int pico_link_timeout_ms = 0;
  std::string pico_firmware_version;  // PONG must match, else the Pico is FAILED
  std::map<std::string, int> stale_ms;  // device name -> data older than this is stale
  LimitsConfig limits;
  std::string estop_sense;  // "none" until a sense line is wired
  std::string safe_stop_servo_action;
  double terrain_slow_scale = 0;
  bool missions_auto_start = false;
  int breathing_clip_s = 0;
  std::string control_socket;
  BridgeSettings bridge;
  SiteSettings site;
  LocationSettings location;

  // Serial ports for the devices that have one (maestro_a/b, pico); baud 0 is TBD.
  std::map<std::string, std::string> device_path;
  std::map<std::string, int> device_baud;
  std::map<std::string, DcDriverSettings> dc_driver;  // dc_driver_a, dc_driver_b
  MecanumSettings mecanum;
  LegsSettings legs;
  ThermalConfig thermal;  // thermal.* (docs/specs/robot.md section 7)
  SeekConfig seek;
  double teleop_deadman_ms = 300;  // teleop.deadman_ms: no command this long, the robot stops        // seek.*, inspect.standoff_m, scan.rotate_wz_dps
  int camera_width = 0;
  int camera_height = 0;
  double camera_fps = 0;

  // Threads (docs/specs/robot.md section 4.2).
  double movement_rate_hz = 0;             // movement thread rate
  double movement_command_timeout_ms = 0;  // dead-man: stop if main sends nothing for this long
  double vision_rate_hz = 0;               // vision thread: how often it looks for a new frame
  std::string vision_model_path;           // Edge TPU compiled .tflite, TBD
  std::string vision_labels_path;          // TBD
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

}  // namespace robot
