#pragma once

// Terrain recognition on the robot (docs/specs/robot.md section 7b, task R7).
//
// Every tick the main loop runs, in order:
//   1. an ITerrainAssessor (`rules` on the robot, `mock` on a laptop) on the snapshot: the raw class
//   2. TerrainHysteresis: a new class must hold for terrain.hold_ticks, except a stop, which is at once
//   3. apply_hint (terrain_hint.hpp): the optional camera hint, which can only make things more cautious
// and puts the result in snapshot.terrain for the behavior and the safety gate. TerrainReporter
// (terrain_reporter.hpp) decides when a result goes to the bridge.
//
// Nothing here does I/O. The assessors keep a little state (the tilt filter, the gyro window,
// the scripted mock sequence), so assess() is not const, but it reads only the snapshot.

#include <array>
#include <deque>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "core/clock.hpp"
#include "hal/pico_link.hpp"
#include "perception/ld19_range.hpp"

namespace robot {

struct WorldSnapshot;
class MockControls;

enum class TerrainClass { flat, debris, step, gap, blocked, unknown };  // spelled as in CONTRACTS.md
enum class TerrainAction { kContinue, kSlow, kSteer, kStop };          // wire: continue, slow, steer, stop

inline constexpr std::array<TerrainClass, 6> kTerrainClasses = {
    TerrainClass::flat, TerrainClass::debris, TerrainClass::step,
    TerrainClass::gap,  TerrainClass::blocked, TerrainClass::unknown};

const char* to_string(TerrainClass c);
const char* to_string(TerrainAction a);
std::optional<TerrainClass> parse_terrain_class(const std::string& s);
// 0 continue, 1 slow, 2 steer, 3 stop.
int caution(TerrainAction a);

struct TerrainAssessment {
  TerrainClass cls = TerrainClass::unknown;
  TerrainAction action = TerrainAction::kSlow;
  double confidence = 0;         // 0 to 1
  double steer_bearing_deg = 0;  // only for steer: body-relative heading to the clearest sector, positive right
  double speed_scale = 1.0;      // 1.0 for continue and steer, terrain.slow_scale for slow, 0 for stop
  std::string source = "lidar_imu_rules";  // "+camera_model" is added when a hint was applied
  std::string reason;            // short text, for example "ld19: 0.18 m ahead"
  bool safety_stop = false;      // translation must be zero this tick; nothing can clear it
  bool allow_rotation = false;   // with safety_stop: turning in place is allowed (blocked with a clear side)
};

// terrain.* in robot.yaml. Every number is a placeholder to tune on the mock rubble (TBD).
struct TerrainConfig {
  std::string impl = "rules";  // rules | mock
  double front_sector_deg = 60;
  std::string lidar_single_mode = "forward";  // forward | down, TBD mounting
  double ground_range_m = 0;                  // only for down; TBD
  double tilt_lpf_alpha = 0.2;
  bool use_force = false;  // the FSRs are force sensors of unknown meaning, never ground contact
  double missing_input_penalty = 0.2;
  double blocked_m = 0.25;
  double clear_m = 0.6;
  double steer_span_deg = 180;  // side sectors searched for a way around, centered ahead
  double gap_drop_m = 0.05;
  double max_pitch_deg = 20;
  double max_roll_deg = 20;
  double step_rise_m = 0.04;
  double max_step_m = 0;  // what the robot can cross, TBD from Matthew; 0 means every step stops
  double bump_window_s = 1.0;
  double bump_gyro_dps = 30;
  double debris_range_var = 0.01;
  std::array<double, 6> base_confidence{0.6, 0.5, 0.6, 0.6, 0.8, 0.2};  // in kTerrainClasses order
  double agree_bonus = 0.2;
  int hold_ticks = 5;
  double slow_scale = 0.5;
  double report_max_hz = 1;
  double report_keepalive_s = 5;
  std::vector<TerrainClass> mock_sequence;  // terrain.mock_sequence: the mock's script, one class per step
  double mock_step_s = 2;                   // terrain.mock_step_s
  struct CameraHint {
    bool enabled = false;
    double frame_every_s = 1.0;
    double max_age_ms = 1500;
    double weight = 0.3;
  } camera_hint;

  // From other sections, so the rules use the same mounting as the rest of the program.
  Ld19Mount ld19;                 // seek.ld19_front_deg, seek.ld19_clockwise (TBD on the robot)
  std::string gyro_yaw_axis = "z";  // heading.gyro_axis: turning is not bumpiness

  double base(TerrainClass c) const { return base_confidence[static_cast<int>(c)]; }
};

// The inputs one assessment used, for robot_diag terrain and the status reply.
struct TerrainInputs {
  std::optional<double> ld19_front_min_m;   // closest return in the forward sector
  std::optional<double> ld19_front_var;     // variance of the forward-sector ranges
  std::optional<double> single_m;           // single-point LiDAR
  std::optional<double> pitch_deg, roll_deg;  // filtered tilt
  std::optional<double> gyro_rms_dps;       // over terrain.bump_window_s, yaw axis left out
  int missing = 0;                          // of ld19, lidar_single, imu
};

class ITerrainAssessor {
 public:
  virtual ~ITerrainAssessor() = default;
  virtual TerrainAssessment assess(const WorldSnapshot& world) = 0;
  // What the last assess() saw (empty for the mock).
  virtual TerrainInputs last_inputs() const { return {}; }
};

// The rules in robot.md 7b.3, checked in order, first match wins.
std::unique_ptr<ITerrainAssessor> make_terrain_rules(const TerrainConfig& config);
// Scripted: robotctl mock terrain <class> wins; else terrain.mock_sequence, one class per
// terrain.mock_step_s; else flat. The action is what the rules would choose for that class.
std::unique_ptr<ITerrainAssessor> make_terrain_mock(const TerrainConfig& config, std::shared_ptr<MockControls> controls);

// Speed scale and safety flags that follow from an action (shared by the rules, the mock, and the hint).
void set_action(TerrainAssessment& a, TerrainAction action, const TerrainConfig& config);

// Step 2: a new class must be seen terrain.hold_ticks ticks in a row before it replaces the
// current one. A stop action replaces it at once, so hysteresis delays leaving a stop, never entering one.
class TerrainHysteresis {
 public:
  explicit TerrainHysteresis(int hold_ticks) : hold_ticks_(hold_ticks) {}
  const TerrainAssessment& update(const TerrainAssessment& raw);
  const std::optional<TerrainAssessment>& current() const { return current_; }

 private:
  int hold_ticks_;
  std::optional<TerrainAssessment> current_;
  std::optional<TerrainClass> candidate_;
  int candidate_ticks_ = 0;
};

// Helpers the rules use, exposed for tests and robot_diag.
// Robot bearing of an LD19 point (0 ahead, positive right), from the mounting.
double ld19_bearing_deg(const Ld19Scan::Point& p, const Ld19Mount& mount);
// True for a return the LD19 marks as real (5 cm or more, intensity 10 or more).
bool ld19_valid(const Ld19Scan::Point& p);

}  // namespace robot
