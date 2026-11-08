// Localizer and geo tests (docs/specs/robot.md sections 8 and 16.1).

#include <cmath>

#include <gtest/gtest.h>

#include "core/geo.hpp"
#include "localization/localizer.hpp"

namespace drone {
namespace {

using namespace std::chrono_literals;

constexpr double kLat = 32.9857;  // a Texas latitude, so cos(lat) matters
constexpr double kLon = -96.7502;
constexpr double kDegPerM = 1.0 / geo::kMetersPerDegLat;

DemoPlaces demo_places() {
  DemoPlaces p;
  p.anchor = {kLat, kLon};
  p.waypoints["home"] = Waypoint{"home", "", {kLat + 0.0001, kLon}};
  p.waypoints["house_3"] = Waypoint{"house_3", "house 3", {kLat + 0.0010, kLon + 0.0010}};
  return p;
}

LocalizerConfig commanded_heading() {
  LocalizerConfig c;
  c.heading_from_imu = false;
  return c;
}

GpsFix fix_at(double lat, double lon, int mode = 3) {
  GpsFix f;
  f.pos = {lat, lon};
  f.mode = mode;
  return f;
}

TEST(Geo, OffsetMathAtSiteScale) {
  const geo::LatLon origin{kLat, kLon};
  // 300 m north and 400 m east: inside the 483 m site radius.
  const geo::LatLon p = geo::offset(origin, 300, 400);
  EXPECT_NEAR(p.lat - origin.lat, 300 / 111320.0, 1e-12);
  EXPECT_NEAR(p.lon - origin.lon, 400 / (111320.0 * std::cos(kLat * 3.14159265358979323846 / 180)), 1e-12);
  EXPECT_NEAR(geo::distance_m(origin, p), 500, 0.5);
  EXPECT_NEAR(geo::bearing_deg(origin, p), 53.13, 0.05);
  double n = 0, e = 0;
  geo::local_offset_m(origin, p, &n, &e);
  EXPECT_NEAR(n, 300, 0.05);
  EXPECT_NEAR(e, 400, 0.5);  // the mean latitude moves the east scale a little over 300 m
  EXPECT_NEAR(geo::bearing_deg(origin, geo::offset(origin, -10, 0)), 180, 1e-9);
  EXPECT_NEAR(geo::bearing_deg(origin, geo::offset(origin, 0, -10)), 270, 1e-6);
  EXPECT_DOUBLE_EQ(geo::wrap_360(-90), 270);
  EXPECT_DOUBLE_EQ(geo::wrap_360(720), 0);
}

TEST(Localizer, GpsMode) {
  Localizer loc(commanded_heading(), {});
  LocalizerInput in;
  in.gps = fix_at(kLat, kLon);
  const Location& l = loc.update(in);
  EXPECT_EQ(l.mode, LocationMode::Gps);
  ASSERT_TRUE(l.lat && l.lon);
  EXPECT_DOUBLE_EQ(*l.lat, kLat);
  EXPECT_DOUBLE_EQ(*l.lon, kLon);
  EXPECT_TRUE(l.gps_fix);
  ASSERT_TRUE(l.indoor_offset_m);
  EXPECT_DOUBLE_EQ(*l.indoor_offset_m, 0);
  EXPECT_EQ(l.note, "GPS fix");
}

TEST(Localizer, GpsTrackSetsHeadingWhenMoving) {
  Localizer loc(commanded_heading(), {});
  LocalizerInput in;
  in.gps = fix_at(kLat, kLon);
  in.gps->speed_mps = 1.0;
  in.gps->track_deg = 135;
  EXPECT_DOUBLE_EQ(loc.update(in).heading_deg, 135);
  in.now += 1s;
  in.gps->speed_mps = 0.1;  // too slow: the track is noise
  in.gps->track_deg = 10;
  EXPECT_DOUBLE_EQ(loc.update(in).heading_deg, 135);
}

TEST(Localizer, FixLossGoesIndoorWithOffset) {
  Localizer loc(commanded_heading(), {});  // heading 0: north
  LocalizerInput in;
  in.gps = fix_at(kLat, kLon);
  in.vx_mps = 0.5;
  loc.update(in);
  // Walk inside: no fix for 10 s at 0.5 m/s forward.
  in.gps.reset();
  for (int i = 0; i < 10; ++i) {
    in.now += 1s;
    loc.update(in);
  }
  const Location& l = loc.location();
  EXPECT_EQ(l.mode, LocationMode::Indoor);
  EXPECT_FALSE(l.gps_fix);
  ASSERT_TRUE(l.lat && l.lon);
  EXPECT_NEAR(*l.lat, kLat + 5 * kDegPerM, 1e-9);
  EXPECT_NEAR(*l.lon, kLon, 1e-9);
  ASSERT_TRUE(l.indoor_offset_m);
  EXPECT_NEAR(*l.indoor_offset_m, 5, 1e-9);
  EXPECT_EQ(l.note, "5 m from last GPS fix, low accuracy");

  // The fix comes back: offset restarts from it.
  in.now += 1s;
  in.gps = fix_at(kLat + 0.0002, kLon);
  EXPECT_EQ(loc.update(in).mode, LocationMode::Gps);
  EXPECT_DOUBLE_EQ(*loc.location().indoor_offset_m, 0);
}

TEST(Localizer, DeadReckoningFollowsHeadingAndScale) {
  LocalizerConfig c = commanded_heading();
  c.odometry_scale = 0.5;  // half of the commanded distance
  Localizer loc(c, {});
  LocalizerInput in;
  in.gps = fix_at(kLat, kLon);
  in.wz_dps = -90;  // counterclockwise is positive, so this turns clockwise, toward east
  loc.update(in);
  in.gps.reset();
  in.now += 1s;
  in.wz_dps = 0;
  in.vx_mps = 1.0;
  EXPECT_NEAR(loc.update(in).heading_deg, 90, 1e-9);
  EXPECT_TRUE(loc.location().heading_from_commands);
  for (int i = 0; i < 4; ++i) {
    in.now += 1s;
    loc.update(in);
  }
  // 4 s at 1 m/s with scale 0.5: 2 m east.
  double n = 0, e = 0;
  geo::local_offset_m({kLat, kLon}, {*loc.location().lat, *loc.location().lon}, &n, &e);
  EXPECT_NEAR(n, 0, 1e-6);
  EXPECT_NEAR(e, 2, 1e-6);

  // Strafing left (vy > 0) while facing east moves north.
  in.vx_mps = 0;
  in.vy_mps = 1.0;
  loc.update(in);
  in.now += 1s;
  loc.update(in);
  geo::local_offset_m({kLat, kLon}, {*loc.location().lat, *loc.location().lon}, &n, &e);
  EXPECT_NEAR(n, 0.5, 1e-6);
}

TEST(Localizer, ImuHeadingWinsOverCommands) {
  Localizer loc(LocalizerConfig{}, {});  // heading_from_imu = true
  LocalizerInput in;
  in.wz_dps = 45;                  // commanded counterclockwise
  in.imu_heading_rate_dps = 10;    // but the IMU says 10 deg/s clockwise
  loc.update(in);
  in.now += 1s;
  EXPECT_NEAR(loc.update(in).heading_deg, 10, 1e-9);
  EXPECT_FALSE(loc.location().heading_from_commands);
  in.imu_heading_rate_dps.reset();  // the IMU went stale: fall back to the command
  in.now += 1s;
  EXPECT_NEAR(loc.update(in).heading_deg, 325, 1e-9);
  EXPECT_TRUE(loc.location().heading_from_commands);
}

TEST(Localizer, DemoModeUsesWaypoints) {
  Localizer loc(commanded_heading(), demo_places());
  loc.set_site_demo_mode(true);
  LocalizerInput in;
  in.gps = fix_at(1.0, 1.0);  // a real fix does not matter in demo mode
  Location l = loc.update(in);
  EXPECT_EQ(l.mode, LocationMode::Demo);
  EXPECT_FALSE(l.gps_fix);
  EXPECT_DOUBLE_EQ(*l.lat, kLat);  // the anchor
  EXPECT_DOUBLE_EQ(*l.lon, kLon);

  EXPECT_FALSE(loc.set_waypoint("house_99"));
  ASSERT_TRUE(loc.set_waypoint("house_3"));
  in.now += 1s;
  l = loc.update(in);
  EXPECT_DOUBLE_EQ(*l.lat, kLat + 0.0010);
  EXPECT_DOUBLE_EQ(*l.lon, kLon + 0.0010);
  EXPECT_EQ(l.note.rfind("house 3, 0 m from waypoint", 0), 0u) << l.note;

  // Drive 2 m north from the waypoint.
  in.vx_mps = 0.5;
  loc.update(in);
  for (int i = 0; i < 4; ++i) {
    in.now += 1s;
    l = loc.update(in);
  }
  EXPECT_NEAR(*l.lat, kLat + 0.0010 + 2 * kDegPerM, 1e-9);
  EXPECT_EQ(l.note, "house 3, 2 m from waypoint, heading rough");
  EXPECT_EQ(loc.note_with_bearing(40.4), "house 3, 2 m from waypoint, heading rough, bearing 40");

  // The site leaves demo mode: the real fix counts again.
  loc.set_site_demo_mode(false);
  in.now += 1s;
  EXPECT_EQ(loc.update(in).mode, LocationMode::Gps);
}

TEST(Localizer, ForceDemoOverridesSite) {
  LocalizerConfig c = commanded_heading();
  c.force_demo = true;
  Localizer loc(c, demo_places());
  loc.set_site_demo_mode(false);
  LocalizerInput in;
  EXPECT_EQ(loc.update(in).mode, LocationMode::Demo);
  EXPECT_EQ(loc.location().note.rfind("demo site", 0), 0u) << loc.location().note;
}

TEST(Localizer, UnknownModeOmitsLatLon) {
  Localizer loc(commanded_heading(), demo_places());
  LocalizerInput in;
  in.gps = fix_at(kLat, kLon, 1);  // mode 1: no fix
  const Location& l = loc.update(in);
  EXPECT_EQ(l.mode, LocationMode::Unknown);
  EXPECT_FALSE(l.lat.has_value());
  EXPECT_FALSE(l.lon.has_value());
  EXPECT_FALSE(l.gps_fix);
  EXPECT_FALSE(l.indoor_offset_m.has_value());
  EXPECT_FALSE(l.note.empty());  // a detection still says something useful
}

TEST(Localizer, NoteNeverOver80Characters) {
  DemoPlaces p = demo_places();
  p.waypoints["long"] = Waypoint{"long", std::string(120, 'a'), {kLat, kLon}};
  Localizer loc(commanded_heading(), p);
  loc.set_site_demo_mode(true);
  ASSERT_TRUE(loc.set_waypoint("long"));
  LocalizerInput in;
  EXPECT_LE(loc.update(in).note.size(), 80u);
  EXPECT_LE(loc.note_with_bearing(123).size(), 80u);
}

TEST(Localizer, LoadsDemoPathsFile) {
  DemoPlaces places;
  std::string error;
  ASSERT_TRUE(load_demo_places(std::string(DRONE_CONFIG_DIR) + "/scripts/demo_paths.yaml", &places, &error)) << error;
  // The drone's file has only the anchor (the site center) until backend/sim has a drone.
  EXPECT_NEAR(places.anchor.lat, 32.9861898, 1e-9);
  EXPECT_NEAR(places.anchor.lon, -96.7516083, 1e-9);
  EXPECT_TRUE(places.waypoints.empty());
  EXPECT_FALSE(load_demo_places("/nonexistent/demo_paths.yaml", &places, &error));
}

}  // namespace
}  // namespace drone
