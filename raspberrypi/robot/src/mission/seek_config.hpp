#pragma once

// seek.* in robot.yaml (plus inspect.standoff_m and scan.rotate_wz_dps), for ThermalSeekBehavior.
// Every value is a starting point to tune on the floor.

namespace robot {

struct SeekConfig {
  double scan_wz_dps = 20;          // scan.rotate_wz_dps
  double scan_step_s = 1.0;         // turn this long...
  double scan_dwell_s = 1.0;        // ...then hold still this long to look
  double scan_max_s = 60;           // nothing found by then: give up
  double turn_gain = 1.5;           // deg/s of turn per degree of bearing
  double max_turn_dps = 30;
  double center_deg = 5;            // bearing within this counts as straight ahead
  double approach_mps = 0.1;
  double standoff_m = 1.0;          // inspect.standoff_m: stop this far away (TF-Luna)
  double close_frac = 0.25;         // without a range, stop when the blob fills this much of the frame
  double lost_s = 1.5;              // candidate unseen this long: back to scanning
  double approach_timeout_s = 20;

  // LD19 on top: distance to the target at its bearing, and obstacles ahead.
  double ld19_front_deg = 0;        // LD19 angle that points straight ahead (TBD on the robot)
  bool ld19_clockwise = true;       // LD19 angles grow to the right (TBD on the robot)
  double ld19_window_deg = 4;       // look this far either side of the target's bearing
  double blocked_m = 0.3;           // anything closer than this ahead (and not the target): stop
  double front_sector_deg = 40;     // the "ahead" checked for obstacles
  double lock_deg = 10;             // stay on the same target while it stays within this of where it was
};

}  // namespace robot
