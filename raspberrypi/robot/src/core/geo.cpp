#include "core/geo.hpp"

#include <cmath>

namespace robot::geo {

namespace {

constexpr double kPi = 3.14159265358979323846;

double radians(double deg) { return deg * kPi / 180.0; }

}  // namespace

LatLon offset(LatLon origin, double north_m, double east_m) {
  const double cos_lat = std::cos(radians(origin.lat));
  LatLon out;
  out.lat = origin.lat + north_m / kMetersPerDegLat;
  // Near a pole cos(lat) goes to 0; the robot never goes there, so just avoid dividing by 0.
  out.lon = origin.lon + (cos_lat > 1e-9 ? east_m / (kMetersPerDegLat * cos_lat) : 0.0);
  return out;
}

void local_offset_m(LatLon from, LatLon to, double* north_m, double* east_m) {
  // Use the mean latitude for the east scale, so a->b and b->a agree.
  const double cos_lat = std::cos(radians((from.lat + to.lat) / 2.0));
  *north_m = (to.lat - from.lat) * kMetersPerDegLat;
  *east_m = (to.lon - from.lon) * kMetersPerDegLat * cos_lat;
}

double distance_m(LatLon a, LatLon b) {
  double n = 0, e = 0;
  local_offset_m(a, b, &n, &e);
  return std::hypot(n, e);
}

double bearing_deg(LatLon from, LatLon to) {
  double n = 0, e = 0;
  local_offset_m(from, to, &n, &e);
  // atan2(east, north) is the compass bearing: 0 for north, 90 for east.
  return wrap_360(std::atan2(e, n) * 180.0 / kPi);
}

double wrap_360(double deg) {
  double out = std::fmod(deg, 360.0);
  if (out < 0) out += 360.0;
  if (out >= 360.0) out = 0;  // fmod rounding of a tiny negative number can land on 360
  return out;
}

}  // namespace robot::geo
