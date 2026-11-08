#pragma once

// ILegIK: turns a LegRequest into servo pulse targets (docs/specs/robot.md section 12.5, task R8).
// Inverse kinematics, not reinforcement learning, and no URDF (docs/ROBOT.md).
//
// leg_ik_2link: each leg is hip (femur) + knee, plus an optional abduction servo (docs/ROBOT.md
// "Legs": the abduction servos were removed on 2026-11-08, so each leg now has 2 servos).
// In the leg's own plane, x is forward and z is down from the hip axis, in metres. The hip and
// knee solve a planar 2-link problem (law of cosines); abduction holds 0 for now.
//
// Joint angles follow the Rubble Dog assembly (3d_parts/Rubble_Dog/README.md):
//   hip 0 = femur straight down, positive swings the femur forward (toward +x)
//   knee 0 = tibia in line with the femur, positive rotates the tibia forward from the femur
//   abduction 0 = leg vertical
// Each servo maps an angle to a pulse with its own calibration (robot_diag legcal):
//   pulse_us = zero_us + direction * us_per_rad * angle
// A target is rejected (never clamped) if the leg cannot reach it or a pulse leaves min_us..max_us.

#include <array>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "core/commands.hpp"

namespace robot {

struct ServoTarget {
  int bus = 0;  // 0 = Maestro A (legs), 1 = Maestro B
  int channel = 0;
  double pulse_us = 0;
};

class ILegIK {
 public:
  virtual ~ILegIK() = default;
  // Fills `out` with one target per joint. Returns false if the request is unreachable;
  // the movement thread then keeps the current pose.
  virtual bool solve(const LegRequest& request, std::vector<ServoTarget>& out) = 0;
};

constexpr int kLegCount = 4;
constexpr int kJointsPerLeg = 3;
enum LegJoint : int { Abduction = 0, Hip = 1, Knee = 2 };
inline const char* const kLegNames[kLegCount] = {"FL", "FR", "BL", "BR"};
inline const char* const kJointNames[kJointsPerLeg] = {"abduction", "hip", "knee"};

// One servo's calibration (legs.joints.<LEG>_<joint> in robot.yaml).
struct JointCal {
  int bus = 0;
  int channel = -1;        // -1 = not wired yet
  double zero_us = 1500;   // pulse at angle 0
  double us_per_rad = 0;   // 0 = not calibrated
  int direction = 1;       // +1 or -1: which way a positive angle turns the servo
  double min_us = 1500;    // mechanical limits, found with robot_diag legcal
  double max_us = 1500;

  bool calibrated() const { return channel >= 0 && us_per_rad > 0 && min_us < max_us; }
  bool fitted() const { return channel >= 0; }  // -1 = no servo on this joint
  double pulse_for(double angle_rad) const { return zero_us + direction * us_per_rad * angle_rad; }
  double angle_for(double pulse_us) const { return (pulse_us - zero_us) / (direction * us_per_rad); }
};

struct LegIkConfig {
  double l1_m = 0;             // hip axis to knee axis (legs.l1_m), 0.110 from the CAD
  double l2_m = 0;             // knee axis to the wheel hub (legs.l2_m)
  double stance_height_m = 0;  // default hub depth below the hip axis
  double stance_x_m = 0;       // hub forward of the hip axis at stance
  int knee_bend = 1;           // +1 or -1: which way the knee folds (legs.knee_bend)
  std::array<std::array<JointCal, kJointsPerLeg>, kLegCount> joints{};  // [leg][abduction, hip, knee]
};

// Planar 2-link IK: hip and knee angles (rad) that put the hub at (x, z). Empty if out of reach.
std::optional<std::array<double, 2>> two_link_angles(double x_m, double z_m, double l1_m, double l2_m, int knee_bend);
// Forward kinematics, the inverse of two_link_angles (used by tests and robot_diag).
std::array<double, 2> two_link_position(double hip_rad, double knee_rad, double l1_m, double l2_m);

// Accepts every request and produces no targets (nothing moves).
std::shared_ptr<ILegIK> make_leg_ik_mock();
// The real solver. Every joint must be calibrated, or solve() returns false and nothing moves.
std::shared_ptr<ILegIK> make_leg_ik_2link(const LegIkConfig& config);

}  // namespace robot
