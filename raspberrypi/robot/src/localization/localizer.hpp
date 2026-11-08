#pragma once

// Where the robot is (docs/specs/robot.md section 8). The main loop calls update() once per tick
// with what it already has in memory, so the localizer never does I/O and is easy to test.
//
// Modes, checked in this order:
//   demo     site.demo_mode (from the bridge) or location.force_demo: the current demo waypoint,
//            or the demo anchor, plus the dead-reckoned offset since it was set
//   gps      a fresh fix with mode >= 2: the fix itself; it also becomes the "last outdoor fix"
//   indoor   no fresh fix, but there was one: last fix plus the dead-reckoned offset since then
//   unknown  never had a fix and not in demo mode: no lat/lon at all
//
// Dead reckoning (section 8.2) integrates the commanded body velocity (there are no wheel
// encoders), scaled by odometry.scale (TBD), and the heading from the IMU gyro (axis and sign
// TBD per mounting) or, without a fresh IMU sample, from the commanded turn rate. Mecanum wheels
// slip, so the offset is rough and the location note says so.
//
// There is no GPS driver yet (task R2). update() takes an optional fix, so a gpsd reader can
// plug in later by filling LocalizerInput::gps; until then the robot is in demo or unknown mode.

#include <map>
#include <optional>
#include <string>

#include "core/clock.hpp"
#include "core/geo.hpp"

namespace robot {

enum class LocationMode { Demo, Gps, Indoor, Unknown };
const char* to_string(LocationMode m);

// One GPS reading, as gpsd's TPV report gives it (mode 0 unknown, 1 no fix, 2 2D, 3 3D).
struct GpsFix {
  geo::LatLon pos;
  int mode = 0;
  std::optional<double> speed_mps;  // ground speed
  std::optional<double> track_deg;  // course over ground, clockwise from north
};

// A named place from demo_paths.yaml (home, house_3, ...).
struct Waypoint {
  std::string name;
  std::string label;  // for location notes, for example "house 3"; empty means use the name
  geo::LatLon pos;
};

// The demo site from demo_paths.yaml (section 8.4). Coordinates are TBD until copied from backend/sim.
struct DemoPlaces {
  geo::LatLon anchor;
  std::map<std::string, Waypoint> waypoints;
};

// Reads `anchor` and `waypoints` from demo_paths.yaml. Returns false with `error` set; `out` is
// left with whatever was read so far.
bool load_demo_places(const std::string& path, DemoPlaces* out, std::string* error);

struct LocalizerConfig {
  bool force_demo = false;           // location.force_demo
  double initial_heading_deg = 0;    // heading.initial_deg
  double gps_min_speed_mps = 0.5;    // heading.gps_min_speed_mps: trust the GPS track above this
  bool heading_from_imu = true;      // heading.source == imu
  double odometry_scale = 1.0;       // odometry.scale, TBD: drive 2 m and measure
};

struct LocalizerInput {
  SteadyTime now{};
  // The body velocity sent to the movement thread this tick (vx forward, vy left, wz counterclockwise).
  double vx_mps = 0;
  double vy_mps = 0;
  double wz_dps = 0;
  // Heading rate from the IMU, already turned into degrees per second clockwise (the main loop
  // applies heading.gyro_axis and heading.gyro_sign). Empty when the IMU is missing or stale.
  std::optional<double> imu_heading_rate_dps;
  std::optional<GpsFix> gps;  // empty when there is no GPS or the fix is stale
};

struct Location {
  LocationMode mode = LocationMode::Unknown;
  std::optional<double> lat;  // empty in unknown mode
  std::optional<double> lon;
  bool gps_fix = false;
  std::optional<double> indoor_offset_m;  // 0 with a fix, path length since the fix indoors, else empty
  double heading_deg = 0;                 // [0, 360)
  bool heading_from_commands = false;     // no IMU: the heading is a rough guess
  std::string note;                       // section 8.3, at most 80 characters
};

class Localizer {
 public:
  Localizer(LocalizerConfig config, DemoPlaces places);

  // site.demo_mode from the bridge's `site` message (or site.demo_mode_default before one arrives).
  void set_site_demo_mode(bool demo_mode);
  // The robot reached a scripted waypoint (demo mode): positions restart from its coordinates.
  // Returns false if demo_paths.yaml has no waypoint with that name.
  bool set_waypoint(const std::string& name);

  // Integrates the previous tick's command over the time since the last update, then picks the mode.
  const Location& update(const LocalizerInput& input);
  const Location& location() const { return location_; }

  // The location note with the thermal blob bearing appended, for a detection.
  std::string note_with_bearing(std::optional<double> bearing_deg) const;

 private:
  bool demo_active() const { return config_.force_demo || site_demo_mode_; }
  void reset_offset();
  std::string build_note() const;

  LocalizerConfig config_;
  DemoPlaces places_;
  bool site_demo_mode_ = false;
  bool was_demo_ = false;

  // Dead-reckoning state since the current reference point (demo waypoint, anchor, or GPS fix).
  double north_m_ = 0;
  double east_m_ = 0;
  double path_m_ = 0;
  double heading_deg_ = 0;
  bool heading_from_commands_ = false;
  std::optional<Waypoint> waypoint_;     // demo mode: the current scripted waypoint
  std::optional<geo::LatLon> last_fix_;  // the last outdoor fix
  bool fix_now_ = false;                 // the last update had a fresh fix

  bool has_last_update_ = false;
  SteadyTime last_update_{};
  double last_vx_ = 0, last_vy_ = 0, last_wz_ = 0;

  Location location_;
};

}  // namespace robot
