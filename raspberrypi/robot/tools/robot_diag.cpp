// robot_diag: bring up and calibrate the drive one piece at a time (docs/specs/robot.md section 16.3,
// docs/tasks/camille.md R8). It talks to the devices directly, so stop the robot program first.
//
//   robot_diag [--config PATH] pico [SECONDS]            stream rates and the newest values
//   robot_diag [--config PATH] terrain [SECONDS]         run the terrain rules on the live sensors (no motion)
//   robot_diag [--config PATH] motor a0|a1|b0|b1 DUTY [SECONDS]
//   robot_diag [--config PATH] wheel fl|fr|bl|br DUTY [SECONDS]   + rolls the robot forward
//   robot_diag [--config PATH] drive VX_MPS VY_MPS WZ_DPS [SECONDS] through the mecanum mixer
//   robot_diag [--config PATH] calibrate                 guided: directions, top speed, lx + ly, radius
//   robot_diag [--config PATH] servo a|b CHANNEL US      one leg servo to a raw pulse (ramped)
//   robot_diag [--config PATH] joint LEG_JOINT DEGREES   one calibrated joint, e.g. joint FL_knee 30
//   robot_diag [--config PATH] legcal [LEG_JOINT]        guided leg servo calibration (all 12, or one)
//
// DUTY is -1..1, SECONDS defaults to 1.5 and is capped at 10. Ctrl+C stops the motors at once.
// motor and wheel ignore the mixer and its dimensions, so they work before calibration.
// drive goes through the same mixer as the robot and respects limits.max_lin_mps / max_ang_dps.

#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "core/clock.hpp"
#include "core/config.hpp"
#include "hal/dc_driver.hpp"
#include "hal/device_mock.hpp"
#include "hal/pico_link.hpp"
#include "hal/pico_snapshot.hpp"
#include "hal/servo_bus.hpp"
#include "motion/leg_ik.hpp"
#include "motion/calibration.hpp"
#include "motion/mecanum.hpp"
#include "terrain/terrain.hpp"

using namespace robot;
using namespace std::chrono_literals;

namespace {

std::atomic<bool> g_stop{false};
void on_signal(int) { g_stop = true; }

constexpr double kMaxSeconds = 10;
const char* const kWheelNames[4] = {"FL", "FR", "BL", "BR"};  // paper wheels 1..4
const char* const kSlotNames[4] = {"A ch0", "A ch1", "B ch0", "B ch1"};

struct Rig {
  Config cfg;
  MecanumConfig mecanum;
  std::shared_ptr<IDcDriver> a, b;
  std::shared_ptr<IPicoLink> pico;
  bool pico_up = false;

  void set_slots(const WheelDuties& d) {
    a->set_duty(0, d[0]);
    a->set_duty(1, d[1]);
    b->set_duty(0, d[2]);
    b->set_duty(1, d[3]);
  }
  void stop() {
    if (a) a->stop_all();
    if (b) b->stop_all();
  }
  ~Rig() { stop(); }
};

bool open_rig(const std::string& config_path, Rig& rig, bool need_motors, bool need_pico) {
  const ConfigResult loaded = load_config_file(config_path);
  if (!loaded.ok) {
    std::fprintf(stderr, "config %s: %s\n", config_path.c_str(), loaded.error.c_str());
    return false;
  }
  rig.cfg = loaded.config;
  const MecanumSettings& m = rig.cfg.mecanum;
  rig.mecanum = MecanumConfig{m.wheel_radius_m, m.half_track_lx_m, m.half_base_ly_m, m.max_wheel_rad_s,
                              m.wheel_order, m.invert};
  auto controls = std::make_shared<MockControls>();

  if (need_motors) {
    std::shared_ptr<IGpio> gpio;
    auto make = [&](const std::string& name) -> std::shared_ptr<IDcDriver> {
      if (rig.cfg.is_mock(name)) return make_dc_driver_mock(name);
      if (!gpio) gpio = make_gpio_pigpio();
      const DcDriverSettings& d = rig.cfg.dc_driver.at(name);
      return make_dc_driver_gpio(name, DcGpioConfig{d.pwm_hz, d.pins, d.min_duty}, gpio);
    };
    rig.a = make("dc_driver_a");
    rig.b = make("dc_driver_b");
    for (const auto& d : {rig.a, rig.b}) {
      const InitResult r = d->init();
      std::printf("%s: %s (%s)%s\n", d->name().c_str(), to_string(r.status), r.detail.c_str(),
                  rig.cfg.is_mock(d->name()) ? " [mock]" : "");
      if (r.status == DeviceStatus::FAILED) return false;
    }
  }
  if (need_pico) {
    rig.pico = rig.cfg.is_mock("pico")
                   ? make_pico_link_mock(controls)
                   : make_pico_link_serial(PicoLinkConfig{rig.cfg.device_path.at("pico"), rig.cfg.pico_heartbeat_hz,
                                                          rig.cfg.pico_link_timeout_ms, rig.cfg.pico_firmware_version});
    const InitResult r = rig.pico->init();
    rig.pico_up = r.status != DeviceStatus::FAILED;
    std::printf("pico: %s (%s)%s\n", to_string(r.status), r.detail.c_str(), rig.cfg.is_mock("pico") ? " [mock]" : "");
  }
  return true;
}

// Holds `duties` for `seconds` (re-sent at 50 Hz), polling the Pico and handing each new IMU
// sample to `on_imu`. Returns false if Ctrl+C cut it short. Always ends with the motors stopped.
template <typename OnImu>
bool run_for(Rig& rig, const WheelDuties& duties, double seconds, OnImu on_imu) {
  seconds = std::min(seconds, kMaxSeconds);
  const auto start = std::chrono::steady_clock::now();
  const auto end = start + std::chrono::duration<double>(seconds);
  std::optional<SteadyTime> last_imu;
  while (!g_stop && std::chrono::steady_clock::now() < end) {
    if (rig.a) rig.set_slots(duties);
    if (rig.pico_up) {
      const SteadyTime now = std::chrono::steady_clock::now();
      rig.pico->poll(now);
      if (const auto s = rig.pico->readings().imu.read(); s && (!last_imu || s->written != *last_imu)) {
        last_imu = s->written;
        on_imu(s->value, ms_between(start, s->written) / 1000.0);
      }
    }
    std::this_thread::sleep_for(20ms);
  }
  rig.stop();
  return !g_stop;
}

bool run_for(Rig& rig, const WheelDuties& duties, double seconds) {
  return run_for(rig, duties, seconds, [](const ImuSample&, double) {});
}

// Output slot that carries paper wheel 1..4, and the sign that makes it roll the robot forward.
std::pair<int, double> slot_for_wheel(const MecanumConfig& m, int paper) {
  for (int k = 0; k < 4; ++k) {
    if (m.wheel_order[static_cast<std::size_t>(k)] == paper) return {k, m.invert[static_cast<std::size_t>(k)] ? -1.0 : 1.0};
  }
  return {-1, 0};
}

WheelDuties wheel_duties(const MecanumConfig& m, int paper, double duty) {
  WheelDuties d{0, 0, 0, 0};
  const auto [slot, sign] = slot_for_wheel(m, paper);
  if (slot >= 0) d[static_cast<std::size_t>(slot)] = sign * duty;
  return d;
}

// Every wheel at `duty` in the pattern of a pure spin to the left (eq. 20 with wz > 0):
// FL and BL backward, FR and BR forward.
WheelDuties spin_left_duties(const MecanumConfig& m, double duty) {
  WheelDuties d{0, 0, 0, 0};
  const double paper[4] = {-duty, duty, -duty, duty};
  for (int k = 0; k < 4; ++k) {
    const int p = m.wheel_order[static_cast<std::size_t>(k)];
    d[static_cast<std::size_t>(k)] = (m.invert[static_cast<std::size_t>(k)] ? -1 : 1) * paper[p - 1];
  }
  return d;
}

WheelDuties forward_duties(const MecanumConfig& m, double duty) {
  WheelDuties d{0, 0, 0, 0};
  for (int p = 1; p <= 4; ++p) {
    const WheelDuties one = wheel_duties(m, p, duty);
    for (std::size_t k = 0; k < 4; ++k) d[k] += one[k];
  }
  return d;
}

int wheel_index(const std::string& name) {
  for (int i = 0; i < 4; ++i) {
    std::string lower = kWheelNames[i];
    for (auto& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (name == lower || name == kWheelNames[i]) return i + 1;
  }
  return 0;
}

std::string ask(const std::string& prompt) {
  std::printf("%s ", prompt.c_str());
  std::fflush(stdout);
  std::string line;
  if (!std::getline(std::cin, line)) {
    g_stop = true;
    return "";
  }
  return line;
}

bool confirm(const std::string& prompt) {
  const std::string a = ask(prompt + " [type yes]");
  return a == "yes" || a == "y";
}

double duty_arg(const char* s) {
  const double d = std::atof(s);
  return std::max(-1.0, std::min(1.0, d));
}

/*************** COMMANDS ***************/

int cmd_pico(const std::string& config, double seconds) {
  Rig rig;
  if (!open_rig(config, rig, false, true) || !rig.pico_up) return 1;
  int n = 0;
  ImuSample last{};
  run_for(rig, WheelDuties{0, 0, 0, 0}, seconds, [&](const ImuSample& s, double) {
    ++n;
    last = s;
  });
  const SteadyTime now = std::chrono::steady_clock::now();
  std::printf("imu: %d samples in %.1f s (%.0f Hz), last a=[%.2f %.2f %.2f] m/s2 g=[%.1f %.1f %.1f] dps\n", n, seconds,
              n / seconds, last.ax, last.ay, last.az, last.gx, last.gy, last.gz);
  for (const char* sensor : {"imu", "thermal", "ads1115", "lidar_single", "ld19"}) {
    const auto age = rig.pico->sensor_age_ms(sensor, now);
    std::printf("  %-13s %s\n", sensor, age ? (std::to_string(static_cast<int>(*age)) + " ms old").c_str() : "no data");
  }
  if (const auto s = rig.pico->readings().lidar_single.read())
    std::printf("  TF-Luna: %u mm, strength %u\n", s->value.dist_mm, s->value.strength);
  if (const auto s = rig.pico->readings().ld19.read())
    std::printf("  LD19: %zu points in the last revolution\n", s->value.points.size());
  return 0;
}

// The terrain rules (robot.md 7b.3) on the live Pico sensors, for tuning on the mock rubble.
// Prints every class change at once and the inputs once a second. Nothing moves.
int cmd_terrain(const std::string& config, double seconds) {
  Rig rig;
  if (!open_rig(config, rig, false, true) || !rig.pico_up) return 1;
  TerrainConfig tc = rig.cfg.terrain;
  auto rules = make_terrain_rules(tc);
  TerrainHysteresis hysteresis(tc.hold_ticks);
  auto fmt = [](const std::optional<double>& v, const char* f) {
    if (!v) return std::string("-");
    char buf[32];
    std::snprintf(buf, sizeof(buf), f, *v);
    return std::string(buf);
  };
  const auto start = std::chrono::steady_clock::now();
  const auto period = std::chrono::milliseconds(static_cast<int>(1000.0 / rig.cfg.loop.rate_hz));
  std::optional<TerrainAssessment> shown;
  SteadyTime next_print = start;
  while (!g_stop && ms_between(start, std::chrono::steady_clock::now()) < std::min(seconds, 600.0) * 1000.0) {
    const SteadyTime now = std::chrono::steady_clock::now();
    rig.pico->poll(now);
    WorldSnapshot w;
    w.now = now;
    copy_pico_sensors(rig.pico->readings(), rig.cfg.stale_ms, now, w);
    const TerrainAssessment raw = rules->assess(w);
    const TerrainAssessment& held = hysteresis.update(raw);
    const double t = ms_between(start, now) / 1000.0;
    if (!shown || shown->cls != held.cls || shown->action != held.action) {
      std::printf("%6.2f s  %-7s %-8s conf %.2f  %s%s\n", t, to_string(held.cls), to_string(held.action), held.confidence,
                  held.reason.c_str(), held.action == TerrainAction::kSteer ? (" -> " + fmt(held.steer_bearing_deg, "%+.0f deg")).c_str() : "");
      shown = held;
    }
    if (now >= next_print) {
      const TerrainInputs in = rules->last_inputs();
      std::printf("          ld19 ahead %s m (var %s), single %s m, pitch %s roll %s deg, gyro rms %s dps, missing %d, raw %s\n",
                  fmt(in.ld19_front_min_m, "%.2f").c_str(), fmt(in.ld19_front_var, "%.3f").c_str(),
                  fmt(in.single_m, "%.2f").c_str(), fmt(in.pitch_deg, "%.1f").c_str(), fmt(in.roll_deg, "%.1f").c_str(),
                  fmt(in.gyro_rms_dps, "%.1f").c_str(), in.missing, to_string(raw.cls));
      next_print = now + std::chrono::seconds(1);
    }
    std::this_thread::sleep_for(period);
  }
  return 0;
}

int cmd_motor(const std::string& config, const std::string& which, double duty, double seconds) {
  static const char* names[4] = {"a0", "a1", "b0", "b1"};
  int slot = -1;
  for (int i = 0; i < 4; ++i)
    if (which == names[i]) slot = i;
  if (slot < 0) {
    std::fprintf(stderr, "motor: use a0, a1, b0 or b1\n");
    return 2;
  }
  Rig rig;
  if (!open_rig(config, rig, true, false)) return 1;
  WheelDuties d{0, 0, 0, 0};
  d[static_cast<std::size_t>(slot)] = duty;
  std::printf("driver %s at duty %+.2f for %.1f s\n", kSlotNames[slot], duty, std::min(seconds, kMaxSeconds));
  return run_for(rig, d, seconds) ? 0 : 130;
}

int cmd_wheel(const std::string& config, const std::string& which, double duty, double seconds) {
  const int paper = wheel_index(which);
  if (paper == 0) {
    std::fprintf(stderr, "wheel: use fl, fr, bl or br\n");
    return 2;
  }
  Rig rig;
  if (!open_rig(config, rig, true, false)) return 1;
  const auto [slot, sign] = slot_for_wheel(rig.mecanum, paper);
  std::printf("%s (driver %s%s) at %+.2f for %.1f s: positive should roll the robot forward\n", kWheelNames[paper - 1],
              kSlotNames[slot], sign < 0 ? ", inverted" : "", duty, std::min(seconds, kMaxSeconds));
  return run_for(rig, wheel_duties(rig.mecanum, paper, duty), seconds) ? 0 : 130;
}

int cmd_drive(const std::string& config, double vx, double vy, double wz, double seconds) {
  Rig rig;
  if (!open_rig(config, rig, true, false)) return 1;
  if (!mecanum_dimensions_known(rig.mecanum)) {
    std::fprintf(stderr, "drive: motion.mecanum dimensions are still 0 (TBD). Run `robot_diag calibrate` first.\n");
    return 1;
  }
  const LimitsConfig& lim = rig.cfg.limits;
  if (std::fabs(vx) > lim.max_lin_mps || std::fabs(vy) > lim.max_lin_mps || std::fabs(wz) > lim.max_ang_dps) {
    std::fprintf(stderr, "drive: over limits.max_lin_mps %.2f / max_ang_dps %.0f\n", lim.max_lin_mps, lim.max_ang_dps);
    return 2;
  }
  MotionCommand c;
  c.vx_mps = vx;
  c.vy_mps = vy;
  c.wz_dps = wz;
  const WheelDuties d = mix_mecanum(c, rig.mecanum);
  std::printf("vx %.2f m/s, vy %.2f m/s, wz %.0f deg/s for %.1f s -> duties [%+.2f %+.2f %+.2f %+.2f]\n", vx, vy, wz,
              std::min(seconds, kMaxSeconds), d[0], d[1], d[2], d[3]);
  std::printf("expect about %.2f m and %.0f deg\n", std::hypot(vx, vy) * std::min(seconds, kMaxSeconds),
              wz * std::min(seconds, kMaxSeconds));
  return run_for(rig, d, seconds) ? 0 : 130;
}

/*************** CALIBRATE ***************/

int cmd_calibrate(const std::string& config) {
  Rig rig;
  if (!open_rig(config, rig, true, true)) return 1;
  MecanumConfig& m = rig.mecanum;
  std::printf("\nCalibration. Ctrl+C at any time stops the motors. Wheel radius from config: %.4f m\n", m.wheel_radius_m);
  if (m.wheel_radius_m <= 0) {
    std::fprintf(stderr, "set motion.mecanum.wheel_radius_m first (half the wheel diameter)\n");
    return 1;
  }

  // --- 1. Directions, on blocks ---
  std::printf("\nStep 1 of 4: wheel directions. Put the robot on blocks so all 4 wheels spin freely.\n");
  if (!confirm("Robot on blocks?")) return 1;
  bool order_ok = true;
  std::array<bool, 4> flip{false, false, false, false};
  for (int p = 1; p <= 4 && !g_stop; ++p) {
    std::printf("  %s forward at 40%% for 1.5 s...\n", kWheelNames[p - 1]);
    run_for(rig, wheel_duties(m, p, 0.4), 1.5);
    const std::string a = ask(std::string("  Did ") + kWheelNames[p - 1] +
                              " turn the way that rolls the robot FORWARD? [y]es, [b]ackward, [o]ther wheel, [n]othing:");
    const auto [slot, sign] = slot_for_wheel(m, p);
    (void)sign;
    if (a == "b") flip[static_cast<std::size_t>(slot)] = true;
    if (a == "o") order_ok = false;
    if (a == "n") std::printf("  -> check that wheel's wiring and the motor battery, or raise %s.min_duty\n",
                              slot < 2 ? "dc_driver_a" : "dc_driver_b");
  }
  if (g_stop) return 130;
  if (!order_ok) {
    std::printf("\n  A different wheel moved: fix motion.mecanum.wheel_order (which wheel is on which driver channel)\n"
                "  with `robot_diag motor a0|a1|b0|b1 0.4`, then run calibrate again.\n");
    return 1;
  }
  for (int k = 0; k < 4; ++k) {
    if (flip[static_cast<std::size_t>(k)]) m.invert[static_cast<std::size_t>(k)] = !m.invert[static_cast<std::size_t>(k)];
  }

  // --- 2. Top speed, on blocks ---
  std::printf("\nStep 2 of 4: top wheel speed. Put a tape mark on the FL tyre. It will spin at full duty for 10 s.\n");
  if (!confirm("Ready to count FL's turns?")) return 1;
  run_for(rig, wheel_duties(m, 1, 1.0), 10);
  if (g_stop) return 130;
  const double turns = std::atof(ask("  How many full turns did FL make (decimals OK, e.g. 23.5)?").c_str());
  m.max_wheel_rad_s = calibration::wheel_rad_s_from_turns(turns, 10);
  std::printf("  max_wheel_rad_s = %.2f (%.0f RPM)\n", m.max_wheel_rad_s, m.max_wheel_rad_s * 60 / (2 * calibration::kPi));
  if (m.max_wheel_rad_s <= 0) return 1;

  // --- 3. lx + ly, spin on the floor with the gyro ---
  double sum = 0;
  if (!rig.pico_up) {
    std::printf("\nStep 3 of 4 skipped: no Pico, so no gyro. Measure the wheel centres with a tape instead.\n");
  } else {
    std::printf("\nStep 3 of 4: spin in place. Put the robot on the floor with about 1 m clear around it.\n");
    if (!confirm("On the floor and clear?")) return 1;
    std::vector<std::array<double, 3>> still, spinning;
    std::printf("  Measuring gyro bias, keep it still (2 s)...\n");
    run_for(rig, WheelDuties{0, 0, 0, 0}, 2, [&](const ImuSample& s, double) { still.push_back({s.gx, s.gy, s.gz}); });
    const double spin_duty = 0.4;
    std::printf("  Spinning left at 40%% for 4 s...\n");
    run_for(rig, spin_left_duties(m, spin_duty), 4, [&](const ImuSample& s, double t) {
      if (t > 1.0) spinning.push_back({s.gx, s.gy, s.gz});  // skip the first second while it spins up
    });
    if (g_stop) return 130;
    const auto yaw = calibration::yaw_from_spin(spinning, calibration::mean_gyro(still));
    if (!yaw) {
      std::printf("  The gyro saw no turn (%zu samples). Did it spin? If not, the wheels may need more duty.\n",
                  spinning.size());
    } else {
      sum = calibration::lx_plus_ly(m.wheel_radius_m, spin_duty * m.max_wheel_rad_s, yaw->rate_dps);
      std::printf("  Turned at %.1f deg/s on IMU axis %c -> lx + ly = %.3f m\n", std::fabs(yaw->rate_dps),
                  "xyz"[yaw->axis], sum);
      std::printf("  (a left spin read %s on that axis: note it for the IMU axes in docs/ROBOT.md)\n",
                  yaw->rate_dps > 0 ? "positive" : "negative");
    }
  }

  // --- 4. Radius check with the TF-Luna, optional ---
  double radius = m.wheel_radius_m;
  if (rig.pico_up) {
    std::printf("\nStep 4 of 4 (optional): radius check. Point the robot at a wall 1.5 to 2 m away, TF-Luna facing it.\n");
    if (confirm("Run it?")) {
      auto range_now = [&]() -> double {
        double total = 0;
        int n = 0;
        for (int i = 0; i < 25; ++i) {
          rig.pico->poll(std::chrono::steady_clock::now());
          if (const auto s = rig.pico->readings().lidar_single.read(); s && s->value.strength >= 100) {
            total += s->value.dist_mm / 1000.0;
            ++n;
          }
          std::this_thread::sleep_for(20ms);
        }
        return n ? total / n : -1;
      };
      const double before = range_now();
      const double duty = 0.3, seconds = 2.0;
      run_for(rig, forward_duties(m, duty), seconds);
      std::this_thread::sleep_for(300ms);
      const double after = range_now();
      if (before < 0 || after < 0 || before <= after) {
        std::printf("  No usable TF-Luna change (%.2f m -> %.2f m). Keeping the measured radius.\n", before, after);
      } else {
        radius = calibration::radius_from_drive(before - after, seconds, duty * m.max_wheel_rad_s);
        std::printf("  Moved %.2f m in %.1f s -> effective radius %.4f m (measured %.4f m)\n", before - after, seconds,
                    radius, m.wheel_radius_m);
        std::printf("  Under about 10%% apart is normal (roller slip). Much more means max_wheel_rad_s is off.\n");
      }
    }
  }

  // --- Result ---
  std::printf("\nPaste into motion.mecanum in robot.yaml:\n\n");
  std::printf("    wheel_radius_m: %.5f\n", radius);
  if (sum > 0) {
    std::printf("    half_track_lx_m: %.4f           # only lx + ly = %.4f is measured; split evenly\n", sum / 2, sum);
    std::printf("    half_base_ly_m: %.4f\n", sum / 2);
  }
  std::printf("    wheel_order: [%d, %d, %d, %d]\n", m.wheel_order[0], m.wheel_order[1], m.wheel_order[2], m.wheel_order[3]);
  std::printf("    invert: [%s, %s, %s, %s]\n", m.invert[0] ? "true" : "false", m.invert[1] ? "true" : "false",
              m.invert[2] ? "true" : "false", m.invert[3] ? "true" : "false");
  std::printf("    max_wheel_rad_s: %.2f\n\n", m.max_wheel_rad_s);
  std::printf("Then check on the floor: `robot_diag drive 0.1 0 0 2` should go about 20 cm,\n"
              "and `robot_diag drive 0 0 45 2` should turn about 90 degrees.\n");
  return 0;
}


/*************** LEG SERVOS ***************/

// Maestro A and B from the config. A mock Maestro (laptop config) accepts everything.
struct ServoRig {
  Config cfg;
  std::shared_ptr<IServoBus> bus[2];
  std::map<std::pair<int, int>, double> now;  // last pulse sent per (bus, channel)

  // Ramps from the last pulse to `us` at 400 us/s (a jump if this channel was never sent),
  // so a typo moves a leg slowly instead of slamming it. Ctrl+C stops the ramp where it is.
  bool move(int b, int channel, double us) {
    if (!bus[b] || !bus[b]->ready()) return false;
    us = std::max(500.0, std::min(2500.0, us));
    auto it = now.find({b, channel});
    double at = it == now.end() ? us : it->second;
    while (!g_stop && at != us) {
      const double step = 8;  // 8 us every 20 ms = 400 us/s
      at = std::fabs(us - at) <= step ? us : at + (us > at ? step : -step);
      bus[b]->set_target_us(channel, at);
      now[{b, channel}] = at;
      std::this_thread::sleep_for(20ms);
    }
    if (it == now.end()) {
      bus[b]->set_target_us(channel, us);
      now[{b, channel}] = us;
    }
    return !g_stop;
  }
};

bool open_servos(const std::string& config_path, ServoRig& rig) {
  const ConfigResult loaded = load_config_file(config_path);
  if (!loaded.ok) {
    std::fprintf(stderr, "config %s: %s\n", config_path.c_str(), loaded.error.c_str());
    return false;
  }
  rig.cfg = loaded.config;
  const char* names[2] = {"maestro_a", "maestro_b"};
  bool any = false;
  for (int b = 0; b < 2; ++b) {
    const std::string n = names[b];
    rig.bus[b] = rig.cfg.is_mock(n) ? make_servo_mock(n)
                                    : make_servo_maestro(n, rig.cfg.device_path.at(n), rig.cfg.device_baud.at(n));
    const InitResult r = rig.bus[b]->init();
    std::printf("%s: %s (%s)%s\n", n.c_str(), to_string(r.status), r.detail.c_str(), rig.cfg.is_mock(n) ? " [mock]" : "");
    any = any || r.status != DeviceStatus::FAILED;
  }
  return any;
}

// "FL_knee" -> (leg, joint); false if unknown.
bool parse_joint(const std::string& name, int& leg, int& joint) {
  for (int l = 0; l < kLegCount; ++l) {
    for (int j = 0; j < kJointsPerLeg; ++j) {
      if (name == std::string(kLegNames[l]) + "_" + kJointNames[j]) {
        leg = l;
        joint = j;
        return true;
      }
    }
  }
  return false;
}

JointCal cal_from(const JointSettings& s) {
  return JointCal{s.bus, s.channel, s.zero_us, s.us_per_rad, s.direction, s.min_us, s.max_us};
}

int cmd_servo(const std::string& config, const std::string& which, int channel, double us) {
  if ((which != "a" && which != "b") || channel < 0 || channel > 23) {
    std::fprintf(stderr, "servo: use a or b, channel 0..23\n");
    return 2;
  }
  ServoRig rig;
  if (!open_servos(config, rig)) return 1;
  const int b = which == "a" ? 0 : 1;
  std::printf("Maestro %s channel %d -> %.0f us (the servo holds it after this exits)\n", which.c_str(), channel, us);
  return rig.move(b, channel, us) ? 0 : 130;
}

int cmd_joint(const std::string& config, const std::string& name, double degrees) {
  int leg = 0, joint = 0;
  if (!parse_joint(name, leg, joint)) {
    std::fprintf(stderr, "joint: use LEG_JOINT like FL_hip (legs FL FR BL BR; abduction, hip, knee)\n");
    return 2;
  }
  ServoRig rig;
  if (!open_servos(config, rig)) return 1;
  const JointCal cal = cal_from(rig.cfg.legs.joints[static_cast<std::size_t>(leg)][static_cast<std::size_t>(joint)]);
  if (!cal.calibrated()) {
    std::fprintf(stderr, "%s is not calibrated yet: run `robot_diag legcal %s`\n", name.c_str(), name.c_str());
    return 1;
  }
  const double us = cal.pulse_for(degrees * calibration::kPi / 180.0);
  if (us < cal.min_us || us > cal.max_us) {
    std::fprintf(stderr, "%s at %.1f deg is %.0f us, outside its limits %.0f..%.0f us\n", name.c_str(), degrees, us,
                 cal.min_us, cal.max_us);
    return 2;
  }
  std::printf("%s -> %.1f deg = %.0f us\n", name.c_str(), degrees, us);
  return rig.move(cal.bus, cal.channel, us) ? 0 : 130;
}

// Interactive jog: a number sends that pulse, + / - move 10 us, ++ / -- move 50 us,
// "ok" accepts the current pulse. Returns the accepted pulse, or empty on Ctrl+C / EOF.
std::optional<double> jog(ServoRig& rig, int b, int channel, double start, const std::string& goal) {
  double us = start;
  if (!rig.move(b, channel, us)) return std::nullopt;
  std::printf("    %s\n    Type a pulse (e.g. 1620), + / - (10 us), ++ / -- (50 us), then ok.\n", goal.c_str());
  while (!g_stop) {
    const std::string a = ask("    [" + std::to_string(static_cast<int>(std::lround(us))) + " us]");
    if (g_stop) break;
    if (a == "ok") return us;
    double next = us;
    if (a == "+") next += 10;
    else if (a == "-") next -= 10;
    else if (a == "++") next += 50;
    else if (a == "--") next -= 50;
    else if (!a.empty() && std::isdigit(static_cast<unsigned char>(a[0]))) next = std::atof(a.c_str());
    else continue;
    next = std::max(500.0, std::min(2500.0, next));
    if (!rig.move(b, channel, next)) break;
    us = next;
  }
  return std::nullopt;
}

// Where angle 0 and the reference angle are, per joint (Rubble Dog assembly, motion/leg_ik.hpp).
const char* zero_pose(int joint) {
  switch (joint) {
    case Abduction: return "leg hanging straight down, not swung in or out";
    case Hip: return "femur pointing straight down";
    default: return "tibia in line with the femur (knee straight)";
  }
}
const char* reference_pose(int joint) {
  switch (joint) {
    case Abduction: return "leg swung OUT, away from the body, by a known angle (a set square gives 90, half of it 45)";
    case Hip: return "femur swung FORWARD to a known angle (horizontal forward = 90)";
    default: return "tibia folded FORWARD from the femur to a known angle (right angle = 90)";
  }
}

int cmd_legcal(const std::string& config, const std::string& only) {
  ServoRig rig;
  if (!open_servos(config, rig)) return 1;
  std::printf("\nLeg calibration. Hang the robot so every leg swings freely and nothing can be hit.\n"
              "Ctrl+C stops at once. Each joint: channel, zero pose, one reference angle, then both limits.\n");
  if (!confirm("Robot supported, legs free?")) return 1;

  std::vector<std::string> results;
  for (int l = 0; l < kLegCount && !g_stop; ++l) {
    for (int j = 0; j < kJointsPerLeg && !g_stop; ++j) {
      const std::string name = std::string(kLegNames[l]) + "_" + kJointNames[j];
      if (!only.empty() && only != name) continue;
      JointSettings s = rig.cfg.legs.joints[static_cast<std::size_t>(l)][static_cast<std::size_t>(j)];
      std::printf("\n== %s ==\n", name.c_str());

      // 1. Channel.
      if (s.channel < 0) {
        const std::string c = ask("  Which Maestro A channel is " + name + " plugged into (0..23)? Press Enter to skip" +
                                  std::string(j == Abduction ? " (no abduction servo fitted)" : "") + ":");
        if (c == "skip" || c.empty()) continue;
        s.channel = std::atoi(c.c_str());
      } else {
        std::printf("  Channel %d on Maestro %c (from robot.yaml).\n", s.channel, s.bus == 0 ? 'A' : 'B');
      }
      if (s.channel < 0 || s.channel > 23) continue;

      // 2. Zero pose.
      std::printf("  Step 1: zero pose.\n");
      const auto zero = jog(rig, s.bus, s.channel, s.zero_us, std::string("Move it until: ") + zero_pose(j) + ".");
      if (!zero) break;

      // 3. Reference angle: gives us_per_rad and direction.
      std::printf("  Step 2: reference angle.\n");
      const auto ref = jog(rig, s.bus, s.channel, *zero, std::string("Move it to: ") + reference_pose(j) + ".");
      if (!ref) break;
      const double deg = std::atof(ask("    What angle is it at now, in degrees (e.g. 90)?").c_str());
      if (std::fabs(deg) < 10 || std::fabs(*ref - *zero) < 20) {
        std::printf("  Too small a move to measure (need 10+ degrees and 20+ us). Skipping %s.\n", name.c_str());
        continue;
      }
      const double rad = deg * calibration::kPi / 180.0;
      s.zero_us = *zero;
      s.us_per_rad = std::fabs(*ref - *zero) / std::fabs(rad);
      s.direction = (*ref - *zero) * rad > 0 ? 1 : -1;

      // 4. Limits, 20 us back from wherever it would hit.
      std::printf("  Step 3: limits. Move slowly; stop BEFORE anything touches or the servo strains.\n");
      const auto lo = jog(rig, s.bus, s.channel, *zero, "Move toward the LOW-pulse end until it is just short of hitting.");
      if (!lo) break;
      const auto hi = jog(rig, s.bus, s.channel, *zero, "Now toward the HIGH-pulse end, same thing.");
      if (!hi) break;
      s.min_us = std::min(*lo, *hi) + 20;
      s.max_us = std::max(*lo, *hi) - 20;
      rig.move(s.bus, s.channel, s.zero_us);

      char line[256];
      std::snprintf(line, sizeof(line),
                    "    %-14s { bus: %d, channel: %d, zero_us: %.0f, us_per_rad: %.1f, direction: %d, min_us: %.0f, max_us: %.0f }",
                    (name + ":").c_str(), s.bus, s.channel, s.zero_us, s.us_per_rad, s.direction, s.min_us, s.max_us);
      results.push_back(line);
      std::printf("  %s: %.1f us/rad (%.0f us per 90 deg), direction %+d, limits %.0f..%.0f us\n", name.c_str(),
                  s.us_per_rad, s.us_per_rad * calibration::kPi / 2, s.direction, s.min_us, s.max_us);
    }
  }
  if (results.empty()) return g_stop ? 130 : 1;
  std::printf("\nPaste under legs.joints in robot.yaml:\n\n");
  for (const auto& r : results) std::printf("%s\n", r.c_str());
  std::printf("\nCheck each with `robot_diag joint <LEG_JOINT> 0` (zero pose) and `... 45`.\n"
              "Once all 12 are in, set legs.impl: two_link and servos.max_rate_us_per_s (start at 300).\n");
  return 0;
}

void usage() {
  std::fprintf(stderr,
               "usage: robot_diag [--config PATH] pico [SECONDS]\n"
               "       robot_diag [--config PATH] terrain [SECONDS]\n"
               "       robot_diag [--config PATH] motor a0|a1|b0|b1 DUTY [SECONDS]\n"
               "       robot_diag [--config PATH] wheel fl|fr|bl|br DUTY [SECONDS]\n"
               "       robot_diag [--config PATH] drive VX_MPS VY_MPS WZ_DPS [SECONDS]\n"
               "       robot_diag [--config PATH] calibrate\n"
               "       robot_diag [--config PATH] servo a|b CHANNEL US\n"
               "       robot_diag [--config PATH] joint LEG_JOINT DEGREES\n"
               "       robot_diag [--config PATH] legcal [LEG_JOINT]\n");
}

}  // namespace

int main(int argc, char** argv) {
  std::signal(SIGINT, on_signal);
  std::signal(SIGTERM, on_signal);
  std::string config = "/etc/robot/robot.yaml";
  std::vector<std::string> args;
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    if (a == "--config" && i + 1 < argc) config = argv[++i];
    else args.push_back(a);
  }
  if (args.empty()) {
    usage();
    return 2;
  }
  auto num = [&](std::size_t i, double fallback) { return args.size() > i ? std::atof(args[i].c_str()) : fallback; };
  const std::string& cmd = args[0];
  if (cmd == "pico") return cmd_pico(config, num(1, 3));
  if (cmd == "terrain") return cmd_terrain(config, num(1, 30));
  if (cmd == "motor" && args.size() >= 3) return cmd_motor(config, args[1], duty_arg(args[2].c_str()), num(3, 1.5));
  if (cmd == "wheel" && args.size() >= 3) return cmd_wheel(config, args[1], duty_arg(args[2].c_str()), num(3, 1.5));
  if (cmd == "drive" && args.size() >= 4) return cmd_drive(config, num(1, 0), num(2, 0), num(3, 0), num(4, 2));
  if (cmd == "calibrate") return cmd_calibrate(config);
  if (cmd == "servo" && args.size() >= 4) return cmd_servo(config, args[1], std::atoi(args[2].c_str()), num(3, 1500));
  if (cmd == "joint" && args.size() >= 3) return cmd_joint(config, args[1], num(2, 0));
  if (cmd == "legcal") return cmd_legcal(config, args.size() >= 2 ? args[1] : "");
  usage();
  return 2;
}
