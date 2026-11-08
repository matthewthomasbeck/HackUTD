// Rule-based terrain assessor (docs/specs/robot.md section 7b.3).
//
// Example trace: an LD19 scan with a box 0.20 m dead ahead and a wall 2 m away on the right.
// The forward sector (+-30 degrees) has its closest return at 0.20 m < blocked_m 0.25, so rule 1
// matches. The 15 degree bins across +-90 degrees are searched: the bins ahead read 0.20 m, the
// bin at +75 degrees reads 2 m > clear_m 0.6, and it is the largest minimum, so the result is
// blocked, steer to +82.5 degrees (safety_stop with rotation allowed). The safety gate then zeroes
// translation and lets the behavior turn right.

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "core/world.hpp"
#include "terrain/terrain.hpp"

namespace robot {

namespace {

constexpr double kBinDeg = 15;
constexpr double kRadToDeg = 57.29577951308232;

std::string metres(const char* what, double m, const char* where) {
  char buf[96];
  std::snprintf(buf, sizeof(buf), "%s: %.2f m %s", what, m, where);
  return buf;
}

class RulesAssessor : public ITerrainAssessor {
 public:
  explicit RulesAssessor(const TerrainConfig& config) : cfg_(config) {}

  TerrainAssessment assess(const WorldSnapshot& w) override {
    TerrainInputs in;
    const bool down = cfg_.lidar_single_mode == "down";

    // LD19: the forward sector, plus the 15 degree side bins for a way around.
    const int bins = std::max(1, static_cast<int>(cfg_.steer_span_deg / kBinDeg));
    std::vector<std::optional<double>> bin_min(static_cast<std::size_t>(bins));
    if (w.ld19) {
      std::vector<double> front;
      for (const auto& p : w.ld19->points) {
        if (!ld19_valid(p)) continue;
        const double b = ld19_bearing_deg(p, cfg_.ld19);
        const double m = p.dist_mm / 1000.0;
        if (std::fabs(b) <= cfg_.front_sector_deg / 2) front.push_back(m);
        const double from_left = b + cfg_.steer_span_deg / 2;
        if (from_left >= 0 && from_left < bins * kBinDeg) {
          auto& slot = bin_min[static_cast<std::size_t>(from_left / kBinDeg)];
          if (!slot || m < *slot) slot = m;
        }
      }
      if (!front.empty()) in.ld19_front_min_m = *std::min_element(front.begin(), front.end());
      if (front.size() >= 3) {
        double mean = 0;
        for (double m : front) mean += m;
        mean /= static_cast<double>(front.size());
        double var = 0;
        for (double m : front) var += (m - mean) * (m - mean);
        in.ld19_front_var = var / static_cast<double>(front.size());
      }
    } else {
      ++in.missing;
    }

    if (w.range_m) {
      in.single_m = *w.range_m;
    } else {
      ++in.missing;
    }

    // IMU: tilt from the gravity direction (low-pass), bumpiness from the gyro over a window.
    if (w.imu) {
      if (!imu_seen_ || w.imu_at != last_imu_at_) {
        const ImuSample& s = *w.imu;
        // Axes TBD by IMU model and mounting: x forward, y left, z up, so at rest az is +g.
        const double pitch = std::atan2(-s.ax, std::sqrt(s.ay * s.ay + s.az * s.az)) * kRadToDeg;
        const double roll = std::atan2(s.ay, s.az) * kRadToDeg;
        const double a = cfg_.tilt_lpf_alpha;
        pitch_ = imu_seen_ ? *pitch_ + a * (pitch - *pitch_) : pitch;
        roll_ = imu_seen_ ? *roll_ + a * (roll - *roll_) : roll;
        // Leave out the yaw axis, so the robot's own turning is not read as rough ground.
        const char yaw = cfg_.gyro_yaw_axis.empty() ? 'z' : cfg_.gyro_yaw_axis[0];
        const double gx = yaw == 'x' ? 0 : s.gx, gy = yaw == 'y' ? 0 : s.gy, gz = yaw == 'z' ? 0 : s.gz;
        gyro_.emplace_back(w.imu_at, gx * gx + gy * gy + gz * gz);
        last_imu_at_ = w.imu_at;
        imu_seen_ = true;
      }
      while (!gyro_.empty() && ms_between(gyro_.front().first, w.now) > cfg_.bump_window_s * 1000.0) gyro_.pop_front();
      in.pitch_deg = pitch_;
      in.roll_deg = roll_;
      if (gyro_.size() >= 2) {
        double sum = 0;
        for (const auto& g : gyro_) sum += g.second;
        in.gyro_rms_dps = std::sqrt(sum / static_cast<double>(gyro_.size()));
      }
    } else {
      // Stale or missing: start the filter and the window again when it comes back.
      ++in.missing;
      imu_seen_ = false;
      pitch_.reset();
      roll_.reset();
      gyro_.clear();
    }
    inputs_ = in;

    TerrainAssessment a;
    auto finish = [&](TerrainClass cls, TerrainAction action, std::string reason, bool agree) {
      a.cls = cls;
      set_action(a, action, cfg_);
      a.confidence = std::clamp(cfg_.base(cls) - cfg_.missing_input_penalty * in.missing + (agree ? cfg_.agree_bonus : 0),
                                0.0, 1.0);
      a.reason = std::move(reason);
      return a;
    };

    if (in.missing == 3) return finish(TerrainClass::unknown, TerrainAction::kSlow, "every input missing", false);

    // 1. Blocked ahead: steer to the clearest side bin, or stop if none is clear.
    const bool ld19_blocked = in.ld19_front_min_m && *in.ld19_front_min_m < cfg_.blocked_m;
    const bool single_blocked = !down && in.single_m && *in.single_m < cfg_.blocked_m;
    if (ld19_blocked || single_blocked) {
      const std::string reason = ld19_blocked ? metres("ld19", *in.ld19_front_min_m, "ahead")
                                              : metres("lidar_single", *in.single_m, "ahead");
      std::optional<int> best;
      for (int i = 0; i < bins; ++i) {
        const auto& m = bin_min[static_cast<std::size_t>(i)];
        if (m && *m > cfg_.clear_m && (!best || *m > *bin_min[static_cast<std::size_t>(*best)])) best = i;
      }
      if (best) {
        finish(TerrainClass::blocked, TerrainAction::kSteer, reason, ld19_blocked && single_blocked);
        a.steer_bearing_deg = -cfg_.steer_span_deg / 2 + (*best + 0.5) * kBinDeg;
        return a;
      }
      return finish(TerrainClass::blocked, TerrainAction::kStop, reason + ", no clear side", ld19_blocked && single_blocked);
    }

    // 2. Gap: the down-pointing LiDAR sees the ground drop away.
    if (down && in.single_m && *in.single_m > cfg_.ground_range_m + cfg_.gap_drop_m) {
      return finish(TerrainClass::gap, TerrainAction::kStop, metres("lidar_single", *in.single_m, "to the ground"), false);
    }

    // 3. Tilt over the limit: the robot is already on something it may tip off.
    if (in.pitch_deg && in.roll_deg &&
        (std::fabs(*in.pitch_deg) > cfg_.max_pitch_deg || std::fabs(*in.roll_deg) > cfg_.max_roll_deg)) {
      char buf[80];
      std::snprintf(buf, sizeof(buf), "imu: pitch %.0f, roll %.0f degrees", *in.pitch_deg, *in.roll_deg);
      return finish(TerrainClass::step, TerrainAction::kStop, buf, false);
    }

    // 4. Step: the ground ahead rises. The LD19 low-obstacle check waits for its mounting height (TBD).
    if (down && in.single_m && *in.single_m < cfg_.ground_range_m - cfg_.step_rise_m) {
      const double rise = cfg_.ground_range_m - *in.single_m;
      const bool too_high = rise > cfg_.max_step_m;
      return finish(TerrainClass::step, too_high ? TerrainAction::kStop : TerrainAction::kSlow,
                    metres("lidar_single", rise, too_high ? "rise, over terrain.max_step_m" : "rise"), false);
    }

    // 5. Debris: a bumpy ride, or a ragged forward scan.
    const bool bumpy = in.gyro_rms_dps && *in.gyro_rms_dps > cfg_.bump_gyro_dps;
    const bool ragged = in.ld19_front_var && *in.ld19_front_var > cfg_.debris_range_var;
    if (bumpy || ragged) {
      char buf[96];
      if (bumpy) std::snprintf(buf, sizeof(buf), "imu: gyro rms %.0f deg/s", *in.gyro_rms_dps);
      else std::snprintf(buf, sizeof(buf), "ld19: forward range variance %.3f", *in.ld19_front_var);
      return finish(TerrainClass::debris, TerrainAction::kSlow, buf, bumpy && ragged);
    }

    // 6. Flat needs at least two fresh inputs; 7. otherwise unknown.
    if (3 - in.missing >= 2) return finish(TerrainClass::flat, TerrainAction::kContinue, "clear", false);
    return finish(TerrainClass::unknown, TerrainAction::kSlow, "only one input fresh", false);
  }

  TerrainInputs last_inputs() const override { return inputs_; }

 private:
  TerrainConfig cfg_;
  bool imu_seen_ = false;
  SteadyTime last_imu_at_{};
  std::optional<double> pitch_, roll_;
  std::deque<std::pair<SteadyTime, double>> gyro_;  // (time, squared rate without the yaw axis)
  TerrainInputs inputs_;
};

}  // namespace

std::unique_ptr<ITerrainAssessor> make_terrain_rules(const TerrainConfig& config) {
  return std::make_unique<RulesAssessor>(config);
}

}  // namespace robot
