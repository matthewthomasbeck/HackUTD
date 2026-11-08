// Planar 2-link leg IK (docs/specs/robot.md section 12.5). See motion/leg_ik.hpp for the angle
// conventions and the per-servo calibration.

#include <cmath>

#include "motion/leg_ik.hpp"

namespace robot {

std::optional<std::array<double, 2>> two_link_angles(double x, double z, double l1, double l2, int knee_bend) {
  if (l1 <= 0 || l2 <= 0) return std::nullopt;
  const double d2 = x * x + z * z;
  const double d = std::sqrt(d2);
  // Reachable only between fully folded and fully straight. A target right at full stretch is
  // rejected too: the knee would lock straight, with no room left to absorb a bump.
  if (d < std::fabs(l1 - l2) + 1e-4 || d > l1 + l2 - 1e-4) return std::nullopt;
  const double c = (d2 - l1 * l1 - l2 * l2) / (2 * l1 * l2);
  const double knee = (knee_bend >= 0 ? 1 : -1) * std::acos(std::fmax(-1.0, std::fmin(1.0, c)));
  // Angles are measured from straight down (+z), positive toward +x.
  const double hip = std::atan2(x, z) - std::atan2(l2 * std::sin(knee), l1 + l2 * std::cos(knee));
  return std::array<double, 2>{hip, knee};
}

std::array<double, 2> two_link_position(double hip, double knee, double l1, double l2) {
  return {l1 * std::sin(hip) + l2 * std::sin(hip + knee), l1 * std::cos(hip) + l2 * std::cos(hip + knee)};
}

namespace {

class LegIk2Link : public ILegIK {
 public:
  explicit LegIk2Link(LegIkConfig config) : c_(config) {}

  bool solve(const LegRequest& request, std::vector<ServoTarget>& out) override {
    out.clear();
    if (request.move == LegRequest::Move::None) return true;
    // Hip and knee must be calibrated. Abduction is optional: channel -1 means no servo there
    // (removed 2026-11-08), and it is skipped; a fitted one must be calibrated like the rest.
    for (const auto& leg : c_.joints)
      for (int j = 0; j < kJointsPerLeg; ++j) {
        const JointCal& cal = leg[static_cast<std::size_t>(j)];
        if (j == Abduction && !cal.fitted()) continue;
        if (!cal.calibrated()) return false;  // an uncalibrated servo must never move
      }

    double depth[kLegCount];
    for (double& d : depth) d = c_.stance_height_m;
    if (request.move == LegRequest::Move::Stance) {
      if (request.height_m > 0) {
        for (double& d : depth) d = request.height_m;
      }
    } else {  // Lift: one leg's hub comes up by height_m, the others hold stance
      if (request.leg < 0 || request.leg >= kLegCount || request.height_m <= 0) return false;
      depth[request.leg] = c_.stance_height_m - request.height_m;
    }

    std::vector<ServoTarget> targets;
    for (int leg = 0; leg < kLegCount; ++leg) {
      const auto angles = two_link_angles(c_.stance_x_m, depth[leg], c_.l1_m, c_.l2_m, c_.knee_bend);
      if (!angles) return false;
      const double joint_angle[kJointsPerLeg] = {0.0, (*angles)[0], (*angles)[1]};
      for (int j = 0; j < kJointsPerLeg; ++j) {
        const JointCal& cal = c_.joints[static_cast<std::size_t>(leg)][static_cast<std::size_t>(j)];
        if (j == Abduction && !cal.fitted()) continue;
        const double us = cal.pulse_for(joint_angle[j]);
        if (us < cal.min_us || us > cal.max_us) return false;  // past a limit: reject, do not clamp
        targets.push_back(ServoTarget{cal.bus, cal.channel, us});
      }
    }
    out = std::move(targets);
    return true;
  }

 private:
  LegIkConfig c_;
};

}  // namespace

std::shared_ptr<ILegIK> make_leg_ik_2link(const LegIkConfig& config) { return std::make_shared<LegIk2Link>(config); }

}  // namespace robot
