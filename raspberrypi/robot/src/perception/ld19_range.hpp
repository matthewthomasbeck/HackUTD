#pragma once

// Distance from one LD19 revolution in a given direction (docs/specs/robot.md section 7b, LD19 on top).
// Bearing is the robot's: 0 straight ahead, positive to the right. Where the LD19's own 0 degrees
// points and which way its angles run depend on how it is mounted (seek.ld19_front_deg and
// seek.ld19_clockwise, TBD on the robot).

#include <cmath>
#include <optional>

#include "hal/pico_link.hpp"

namespace robot {

struct Ld19Mount {
  double front_deg = 0;    // LD19 angle that points straight ahead
  bool clockwise = true;   // LD19 angles grow clockwise seen from above (to the right)
};

// Closest return within half_width_deg of `bearing_deg`, in metres; empty if nothing valid there.
// Returns under 5 cm or with intensity under 10 are the LD19's "no echo" and are skipped.
inline std::optional<double> ld19_range_at(const Ld19Scan& scan, double bearing_deg, double half_width_deg,
                                           const Ld19Mount& mount) {
  const double sign = mount.clockwise ? 1.0 : -1.0;
  const double center = mount.front_deg + sign * bearing_deg;
  std::optional<double> best;
  for (const auto& p : scan.points) {
    if (p.dist_mm < 50 || p.intensity < 10) continue;
    double diff = std::fmod(p.angle_cdeg / 100.0 - center + 540.0, 360.0) - 180.0;  // -180..180
    if (std::fabs(diff) > half_width_deg) continue;
    const double m = p.dist_mm / 1000.0;
    if (!best || m < *best) best = m;
  }
  return best;
}

}  // namespace robot
