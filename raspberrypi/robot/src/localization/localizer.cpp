#include "localization/localizer.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include <yaml-cpp/yaml.h>

namespace robot {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr std::size_t kMaxNote = 80;  // section 8.3
// A tick gap longer than this (a paused process, a debugger) is not integrated as motion.
constexpr double kMaxStepS = 1.0;

std::string fit(std::string text) {
  if (text.size() > kMaxNote) text.resize(kMaxNote);
  return text;
}

std::string meters(double m) {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "%.0f m", m);
  return buf;
}

}  // namespace

const char* to_string(LocationMode m) {
  switch (m) {
    case LocationMode::Demo: return "demo";
    case LocationMode::Gps: return "gps";
    case LocationMode::Indoor: return "indoor";
    case LocationMode::Unknown: return "unknown";
  }
  return "?";
}

bool load_demo_places(const std::string& path, DemoPlaces* out, std::string* error) {
  try {
    const YAML::Node root = YAML::LoadFile(path);
    const YAML::Node anchor = root["anchor"];
    if (!anchor || !anchor["lat"] || !anchor["lon"]) {
      *error = path + ": missing anchor.lat or anchor.lon";
      return false;
    }
    out->anchor = {anchor["lat"].as<double>(), anchor["lon"].as<double>()};
    const YAML::Node waypoints = root["waypoints"];
    if (waypoints && waypoints.IsMap()) {
      for (const auto& entry : waypoints) {
        Waypoint w;
        w.name = entry.first.as<std::string>();
        const YAML::Node v = entry.second;
        if (!v["lat"] || !v["lon"]) {
          *error = path + ": waypoint " + w.name + " needs lat and lon";
          return false;
        }
        w.pos = {v["lat"].as<double>(), v["lon"].as<double>()};
        w.label = v["label"] ? v["label"].as<std::string>() : "";
        out->waypoints[w.name] = w;
      }
    }
    return true;
  } catch (const YAML::Exception& e) {
    *error = "cannot read " + path + ": " + e.what();
    return false;
  }
}

Localizer::Localizer(LocalizerConfig config, DemoPlaces places)
    : config_(config), places_(std::move(places)), heading_deg_(geo::wrap_360(config.initial_heading_deg)) {
  location_.heading_deg = heading_deg_;
  location_.note = build_note();
}

void Localizer::set_site_demo_mode(bool demo_mode) { site_demo_mode_ = demo_mode; }

bool Localizer::set_waypoint(const std::string& name) {
  const auto it = places_.waypoints.find(name);
  if (it == places_.waypoints.end()) return false;
  waypoint_ = it->second;
  reset_offset();
  return true;
}

void Localizer::reset_offset() {
  north_m_ = 0;
  east_m_ = 0;
  path_m_ = 0;
}

const Location& Localizer::update(const LocalizerInput& in) {
  // 1. Dead reckoning: the command sent last tick was in force from then until now.
  double dt = has_last_update_ ? ms_between(last_update_, in.now) / 1000.0 : 0.0;
  dt = std::clamp(dt, 0.0, kMaxStepS);
  // Commanded wz is counterclockwise; heading is clockwise from north, hence the minus.
  const bool use_imu = config_.heading_from_imu && in.imu_heading_rate_dps.has_value();
  const double rate_dps = use_imu ? *in.imu_heading_rate_dps : -last_wz_;
  heading_from_commands_ = !use_imu;
  const double mid_heading = (heading_deg_ + rate_dps * dt / 2.0) * kPi / 180.0;
  heading_deg_ = geo::wrap_360(heading_deg_ + rate_dps * dt);
  // Body frame (vx forward, vy left) to north/east at the mid-step heading.
  const double scale = config_.odometry_scale * dt;
  const double c = std::cos(mid_heading), s = std::sin(mid_heading);
  north_m_ += (last_vx_ * c + last_vy_ * s) * scale;
  east_m_ += (last_vx_ * s - last_vy_ * c) * scale;
  path_m_ += std::hypot(last_vx_, last_vy_) * scale;
  last_vx_ = in.vx_mps;
  last_vy_ = in.vy_mps;
  last_wz_ = in.wz_dps;
  last_update_ = in.now;
  has_last_update_ = true;

  // 2. Mode. Switching demo mode on or off restarts the offset, since the reference point changes.
  const bool demo = demo_active();
  if (demo != was_demo_) reset_offset();
  was_demo_ = demo;

  fix_now_ = false;
  if (!demo && in.gps && in.gps->mode >= 2) {
    fix_now_ = true;
    last_fix_ = in.gps->pos;
    reset_offset();
    if (in.gps->speed_mps && in.gps->track_deg && *in.gps->speed_mps > config_.gps_min_speed_mps) {
      heading_deg_ = geo::wrap_360(*in.gps->track_deg);
    }
  }

  Location loc;
  loc.heading_deg = heading_deg_;
  loc.heading_from_commands = heading_from_commands_;
  if (demo) {
    loc.mode = LocationMode::Demo;
    const geo::LatLon ref = waypoint_ ? waypoint_->pos : places_.anchor;
    const geo::LatLon p = geo::offset(ref, north_m_, east_m_);
    loc.lat = p.lat;
    loc.lon = p.lon;
  } else if (fix_now_) {
    loc.mode = LocationMode::Gps;
    loc.lat = last_fix_->lat;
    loc.lon = last_fix_->lon;
    loc.gps_fix = true;
    loc.indoor_offset_m = 0.0;
  } else if (last_fix_) {
    loc.mode = LocationMode::Indoor;
    const geo::LatLon p = geo::offset(*last_fix_, north_m_, east_m_);
    loc.lat = p.lat;
    loc.lon = p.lon;
    loc.indoor_offset_m = path_m_;
  } else {
    loc.mode = LocationMode::Unknown;
  }
  location_ = loc;
  location_.note = build_note();
  return location_;
}

std::string Localizer::build_note() const {
  std::string note;
  switch (location_.mode) {
    case LocationMode::Demo: {
      const std::string place = waypoint_ ? (waypoint_->label.empty() ? waypoint_->name : waypoint_->label)
                                          : std::string("demo site");
      note = place + ", " + meters(path_m_) + (waypoint_ ? " from waypoint" : " from anchor");
      if (heading_from_commands_) note += ", heading rough";
      break;
    }
    case LocationMode::Gps:
      note = "GPS fix";
      break;
    case LocationMode::Indoor:
      note = meters(path_m_) + " from last GPS fix, low accuracy";
      break;
    case LocationMode::Unknown:
      note = "location unknown, no GPS fix yet";
      break;
  }
  return fit(note);
}

std::string Localizer::note_with_bearing(std::optional<double> bearing_deg) const {
  if (!bearing_deg) return location_.note;
  char buf[32];
  std::snprintf(buf, sizeof(buf), ", bearing %.0f", geo::wrap_360(*bearing_deg));
  return fit(location_.note + buf);
}

}  // namespace robot
