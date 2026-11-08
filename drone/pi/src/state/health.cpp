#include "state/health.hpp"

namespace drone {

namespace {

std::string ms_text(double ms) { return std::to_string(static_cast<long long>(ms)) + " ms"; }

}  // namespace

std::optional<std::string> mcu_link_problem(const WorldSnapshot& world) {
  const DeviceView* mcu = world.device("mcu");
  if (mcu == nullptr || !mcu->required) return std::nullopt;
  if (!world.mcu_heartbeat_age_ms) return std::string("no MCU heartbeat yet");
  if (*world.mcu_heartbeat_age_ms > world.mcu_link_timeout_ms) {
    return "MCU heartbeat " + ms_text(*world.mcu_heartbeat_age_ms) + " old (limit " +
           ms_text(world.mcu_link_timeout_ms) + ")";
  }
  return std::nullopt;
}

std::optional<std::string> stale_sensor_problem(const WorldSnapshot& world) {
  for (const auto& d : world.devices) {
    if (!d.required || d.stale_ms <= 0) continue;
    if (!d.age_ms) return d.name + " has no data";
    if (*d.age_ms > d.stale_ms) {
      return d.name + " data " + ms_text(*d.age_ms) + " old (limit " + ms_text(d.stale_ms) + ")";
    }
  }
  return std::nullopt;
}

Health assess_health(const WorldSnapshot& world, bool latched) {
  if (latched) return {false, "latched until a human resets it"};
  for (const auto& d : world.devices) {
    if (d.required && d.status != DeviceStatus::OK) return {false, d.name + " " + to_string(d.status)};
  }
  if (auto problem = mcu_link_problem(world)) return {false, *problem};
  if (auto problem = stale_sensor_problem(world)) return {false, *problem};
  return {};
}

}  // namespace drone
