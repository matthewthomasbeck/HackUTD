#pragma once

// Local meters <-> WGS84 lat/lon, plus distance and bearing (docs/specs/robot.md section 8.2).
//
// Equirectangular approximation: dlat = dn / 111320, dlon = de / (111320 * cos(lat)).
// At the 0.3 mile demo site the error is far below the dead-reckoning drift, so it is good enough.
// Angles follow CONTRACTS.md: degrees clockwise from true north (0 = N, 90 = E).

namespace drone::geo {

constexpr double kMetersPerDegLat = 111320.0;

struct LatLon {
  double lat = 0;
  double lon = 0;
};

// The point `north_m` north and `east_m` east of `origin`.
LatLon offset(LatLon origin, double north_m, double east_m);

// How far north and east `to` is from `from`, in meters.
void local_offset_m(LatLon from, LatLon to, double* north_m, double* east_m);

double distance_m(LatLon a, LatLon b);

// Bearing from `from` to `to`, in [0, 360).
double bearing_deg(LatLon from, LatLon to);

// Any angle in degrees to [0, 360).
double wrap_360(double deg);

}  // namespace drone::geo
