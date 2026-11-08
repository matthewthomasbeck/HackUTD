#include "hal/pico_snapshot.hpp"

namespace robot {

void copy_pico_sensors(const PicoReadings& r, const std::map<std::string, int>& stale_ms, SteadyTime now,
                       WorldSnapshot& w) {
  auto fresh = [&](const std::string& name, SteadyTime written) {
    const auto it = stale_ms.find(name);
    return it == stale_ms.end() || ms_between(written, now) <= it->second;
  };
  if (const auto t = r.thermal.read(); t && fresh("thermal", t->written)) {
    w.thermal = t->value;
    w.thermal_at = t->written;
  }
  if (const auto s = r.lidar_single.read();
      s && fresh("lidar_single", s->written) && s->value.strength >= 100 && s->value.strength < 65535 && s->value.dist_mm > 0) {
    w.range_m = s->value.dist_mm / 1000.0;
  }
  if (const auto s = r.ld19.read(); s && fresh("ld19", s->written) && !s->value.points.empty()) w.ld19 = s->value;
  if (const auto s = r.imu.read(); s && fresh("imu", s->written)) {
    w.imu = s->value;
    w.imu_at = s->written;
  }
}

}  // namespace robot
