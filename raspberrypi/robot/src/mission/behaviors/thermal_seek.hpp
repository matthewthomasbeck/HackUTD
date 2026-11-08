#pragma once

// ThermalSeekBehavior: find a warm, person-sized shape with the thermal camera and drive up to it,
// on its own (mission kind "seek_thermal", started with `robotctl start seek_thermal`).
// It follows docs/specs/robot.md section 6.4 APPROACH for a candidate found while scanning:
//
//   SCAN      turn in place in steps (rotate, then hold still to look), until a candidate is confirmed
//   TURN      turn toward the target's bearing until it is within center_deg
//   APPROACH  drive forward slowly, steering to keep it centered, until it is standoff_m away
//   ARRIVED   stop; the mission is done and the robot goes back to READY
//   GAVE_UP   nothing found in scan_max_s, or the approach took too long: the mission fails
//
// Which blob: with several confirmed warm shapes it goes to the CLOSEST, by the LD19 (the 360 degree
// lidar on top) at each blob's bearing, or the biggest blob when there is no LD19 scan. Once chosen,
// it stays locked on that one while it stays within lock_deg, so it does not flip between people.
//
// Distance to the target: the LD19 at its bearing, which works before the robot faces it; else the
// TF-Luna once the target is straight ahead; else the blob's size (close_frac).
// Obstacles: while approaching, anything in the LD19's front sector closer than blocked_m that is
// not the target stops forward motion (turning still allowed).
//
// Losing the target for lost_s goes back to SCAN. Like every behavior it only proposes commands:
// the safety gate still clamps speed and acceleration and stops on any fault.

#include <optional>
#include <string>
#include <vector>

#include "mission/behaviors/behavior.hpp"
#include "mission/seek_config.hpp"
#include "perception/ld19_range.hpp"
#include "perception/thermal_detector.hpp"

namespace robot {

class ThermalSeekBehavior : public IBehavior {
 public:
  enum class Phase { Scan, Turn, Approach, Arrived, GaveUp };

  ThermalSeekBehavior(const ThermalConfig& thermal, const SeekConfig& seek)
      : tracker_(thermal), cfg_(seek), mount_{seek.ld19_front_deg, seek.ld19_clockwise} {}

  void start() override;
  BehaviorOutput tick(const WorldSnapshot& world) override;
  void cancel() override {}

  Phase phase() const { return phase_; }
  const std::optional<ThermalCandidate>& target() const { return target_; }
  std::optional<double> target_distance_m() const { return target_distance_; }
  static const char* phase_name(Phase p);

 private:
  void enter(Phase p, SteadyTime now, const std::string& why);
  std::optional<ThermalCandidate> choose(const std::vector<ThermalCandidate>& found, const WorldSnapshot& world) const;
  std::optional<double> distance_to(const ThermalCandidate& c, const WorldSnapshot& world) const;

  ThermalTracker tracker_;
  SeekConfig cfg_;
  Ld19Mount mount_;
  Phase phase_ = Phase::Scan;
  bool started_ = false;
  bool blocked_logged_ = false;
  SteadyTime phase_since_{};
  SteadyTime mission_since_{};
  SteadyTime last_frame_at_{};
  std::optional<ThermalCandidate> target_;
  std::optional<double> target_distance_;
  SteadyTime target_at_{};
};

}  // namespace robot
