#include "hal/mcu_snapshot.hpp"

namespace drone {

void copy_mcu_sensors(const McuReadings& r, const std::map<std::string, int>& stale_ms, SteadyTime now,
                      WorldSnapshot& w) {
  auto fresh = [&](const std::string& name, SteadyTime written) {
    const auto it = stale_ms.find(name);
    return it == stale_ms.end() || ms_between(written, now) <= it->second;
  };
  if (const auto s = r.imu.read(); s && fresh("imu", s->written)) {
    w.imu = s->value;
    w.imu_at = s->written;
  }
}

}  // namespace drone
