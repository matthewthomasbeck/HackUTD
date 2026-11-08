// Robot main program (docs/specs/robot.md section 4, whiteboard steps 2-A and 3).
//
// Threads on the Pi:
//   main      the orchestrator (this file). Reads the Pico and the camera, runs the state machine,
//             decides every move, and hands gated commands to the movement thread.
//   movement  the only writer to the Maestros and DC drivers (motion/movement_thread.hpp), so the
//             main thread never waits on a motor port. Stops on its own if main goes quiet.
//   vision    runs the Coral model on the newest camera frame (vision/vision_thread.hpp).
// Helpers that are not ours: libcamera's delivery thread fills the frame slot, and DeviceManager
// starts short-lived threads to init devices. Threads share data only through LatestSlot<T>.
//
// Startup: load the config (BOOT), start the control socket and the two workers, then INIT the
// devices. Then one fixed-rate loop on the main thread. Each tick runs, in this order:
//   1. observe   drain the Pico link (non-blocking), then snapshot devices, sensors, frames, detections;
//                poll the control socket and the bridge socket (bridge/bridge_client.hpp) once each
//   2. step      the state machine decides whether to change state
//   3. behavior  in ACTIVE, the mission behavior proposes a command
//   4. gate      the safety gate filters it (the only path to the actuators)
//   5. send      hand the gated command to the movement thread, update the localizer, and queue
//                heartbeat, position, and device messages for the bridge
//   6. log       state changes, gate interventions, a 1 Hz summary
// then pings the systemd watchdog if the tick finished in time and the movement thread is alive,
// and sleeps until the next tick. Nothing in the loop blocks on I/O.

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include <nlohmann/json.hpp>

#include "bridge/bridge_client.hpp"
#include "bridge/control_server.hpp"
#include "bridge/messages.hpp"
#include "core/clock.hpp"
#include "core/config.hpp"
#include "core/log.hpp"
#include "core/notify.hpp"
#include "core/world.hpp"
#include "hal/device_manager.hpp"
#include "hal/device_mock.hpp"
#include "mission/behaviors/behavior.hpp"
#include "mission/behaviors/teleop.hpp"
#include "mission/behaviors/thermal_seek.hpp"
#include "mission/mission_intake.hpp"
#include "hal/camera.hpp"
#include "hal/dc_driver.hpp"
#include "hal/pico_link.hpp"
#include "hal/servo_bus.hpp"
#include "localization/localizer.hpp"
#include "motion/leg_ik.hpp"
#include "motion/movement_thread.hpp"
#include "vision/detector.hpp"
#include "vision/vision_thread.hpp"
#include "state/health.hpp"
#include "state/safety_gate.hpp"
#include "state/state_machine.hpp"

using namespace robot;
using json = nlohmann::json;

namespace {

std::atomic<bool> g_stop_requested{false};

void on_signal(int) { g_stop_requested = true; }

void install_signal_handlers() {
  struct sigaction action {};
  action.sa_handler = on_signal;
  sigemptyset(&action.sa_mask);
  sigaction(SIGTERM, &action, nullptr);
  sigaction(SIGINT, &action, nullptr);
  std::signal(SIGPIPE, SIG_IGN);  // a dead socket peer must not kill the robot
}

struct Args {
  std::string config_path = "/etc/robot/robot.yaml";
  bool verbose = false;
};

bool parse_args(int argc, char** argv, Args& args) {
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    if (a == "--config" && i + 1 < argc) {
      args.config_path = argv[++i];
    } else if (a == "--verbose" || a == "-v") {
      args.verbose = true;
    } else {
      std::fprintf(stderr, "usage: robot [--config path/to/robot.yaml] [--verbose]\n");
      return false;
    }
  }
  return true;
}

// Every device, typed where the threads need the type, plus the list the DeviceManager inits.
struct Hardware {
  std::shared_ptr<IServoBus> maestro_a, maestro_b;
  std::shared_ptr<IDcDriver> dc_a, dc_b;
  std::shared_ptr<IPicoLink> pico;
  std::shared_ptr<ICamera> camera;
  std::shared_ptr<IDetector> detector;  // the "coral" device
  std::vector<std::shared_ptr<IDevice>> init_order;
};

// Picks the mock or the real implementation of each device from the config (`<device>.mock`).
// Devices without a typed interface yet (GPS, light, the Pico's sensors) are generic placeholders.
Hardware build_hardware(const Config& cfg, const std::shared_ptr<MockControls>& controls) {
  Hardware hw;
  auto path = [&](const std::string& name) { return cfg.device_path.at(name); };
  auto baud = [&](const std::string& name) { return cfg.device_baud.at(name); };
  const bool mock_a = cfg.is_mock("maestro_a"), mock_b = cfg.is_mock("maestro_b");
  hw.maestro_a = mock_a ? make_servo_mock("maestro_a") : make_servo_maestro("maestro_a", path("maestro_a"), baud("maestro_a"));
  hw.maestro_b = mock_b ? make_servo_mock("maestro_b") : make_servo_maestro("maestro_b", path("maestro_b"), baud("maestro_b"));
  // Both DC drivers share one pigpiod connection.
  std::shared_ptr<IGpio> gpio;
  auto dc_driver = [&](const std::string& name) -> std::shared_ptr<IDcDriver> {
    if (cfg.is_mock(name)) return make_dc_driver_mock(name);
    if (!gpio) gpio = make_gpio_pigpio();
    const DcDriverSettings& d = cfg.dc_driver.at(name);
    return make_dc_driver_gpio(name, DcGpioConfig{d.pwm_hz, d.pins, d.min_duty}, gpio);
  };
  hw.dc_a = dc_driver("dc_driver_a");
  hw.dc_b = dc_driver("dc_driver_b");
  hw.pico = cfg.is_mock("pico") ? make_pico_link_mock(controls)
                                : make_pico_link_serial(PicoLinkConfig{path("pico"), cfg.pico_heartbeat_hz,
                                                                       cfg.pico_link_timeout_ms, cfg.pico_firmware_version});
  const CameraConfig cam{cfg.camera_width, cfg.camera_height, cfg.camera_fps};
  hw.camera = cfg.is_mock("camera") ? make_camera_mock(cam, controls) : make_camera_libcamera(cam);
  hw.detector = cfg.is_mock("coral")
                    ? make_detector_mock()
                    : make_detector_coral(DetectorConfig{cfg.vision_model_path, cfg.vision_labels_path,
                                                         static_cast<float>(cfg.vision_min_score)});

  for (const auto& name : cfg.devices_in_init_order()) {
    if (name == "maestro_a") hw.init_order.push_back(hw.maestro_a);
    else if (name == "maestro_b") hw.init_order.push_back(hw.maestro_b);
    else if (name == "dc_driver_a") hw.init_order.push_back(hw.dc_a);
    else if (name == "dc_driver_b") hw.init_order.push_back(hw.dc_b);
    else if (name == "pico") hw.init_order.push_back(hw.pico);
    else if (name == "camera") hw.init_order.push_back(hw.camera);
    else if (name == "coral") hw.init_order.push_back(hw.detector);
    else if (!cfg.is_mock(name) && std::find(kPicoDevices.begin(), kPicoDevices.end(), name) != kPicoDevices.end())
      hw.init_order.push_back(make_pico_sensor_device(name, hw.pico));  // status from the Pico's STATUS reply
    else if (cfg.is_mock(name)) hw.init_order.push_back(std::make_shared<MockDevice>(name, controls));
    else hw.init_order.push_back(std::make_shared<UnimplementedDevice>(name));
  }
  return hw;
}

// Step 1 (after pico.poll). Copy everything the state machine and gate need into one snapshot.
// Sensor ages come from the slots themselves, so a sensor that stops updating goes stale on its own.
WorldSnapshot observe(const Config& cfg, const DeviceManager& devices, const Hardware& hw, const MockControls& controls,
                      const MovementThread& movement, const VisionThread& vision, SteadyTime now) {
  WorldSnapshot w;
  w.now = now;
  w.init_complete = true;
  for (const auto& rec : devices.records()) {
    DeviceView v;
    v.name = rec.name;
    v.required = cfg.is_required(rec.name);
    v.initialized = rec.initialized;
    v.status = rec.status;
    v.detail = rec.detail;
    const auto stale = cfg.stale_ms.find(rec.name);
    if (stale != cfg.stale_ms.end()) v.stale_ms = stale->second;
    if (rec.name == "camera") {
      v.age_ms = hw.camera->frames().age_ms(now);
    } else if (std::find(kPicoDevices.begin(), kPicoDevices.end(), rec.name) != kPicoDevices.end()) {
      v.age_ms = hw.pico->sensor_age_ms(rec.name, now);
    }
    // TODO(R2): gps age from the gpsd reader.
    if (!rec.initialized) w.init_complete = false;
    w.devices.push_back(v);
  }

  w.pico_link_timeout_ms = cfg.pico_link_timeout_ms;
  w.pico_heartbeat_age_ms = hw.pico->heartbeat_age_ms(now);
  // TODO(R2/R4): read the real sense line from the Pico once estop.sense names one.
  w.estop_sense_asserted = controls.estop_sense();
  const auto moving = movement.status();
  w.motion_stopped = !moving || moving->stopped;
  if (const auto d = vision.detections().read()) w.detections = d->value;

  // Pico sensors for the mission behaviors, only when fresh.
  const PicoReadings& r = hw.pico->readings();
  auto fresh = [&](const std::string& name, SteadyTime written) {
    const auto it = cfg.stale_ms.find(name);
    return it == cfg.stale_ms.end() || ms_between(written, now) <= it->second;
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
  return w;
}

json status_json(const Config& cfg, const Machine& m, const std::string& last_reason, const WorldSnapshot& w,
                 const MotionCommand& sent, const std::string& mission_kind) {
  const Health health = assess_health(w, m.latched);
  json devices = json::array();
  for (const auto& d : w.devices) {
    devices.push_back({{"name", d.name},
                       {"required", d.required},
                       {"status", to_string(d.status)},
                       {"detail", d.detail},
                       {"mock", cfg.is_mock(d.name)}});
  }
  return {{"ok", true},
          {"robot_id", cfg.robot_id},
          {"state", to_string(m.state)},
          {"latched", m.latched},
          {"fault_retries", m.fault_retries},
          {"shutting_down", m.shutting_down},
          {"safe_stop_cause", m.safe_stop_cause},
          {"last_transition", last_reason},
          {"health", {{"ok", health.ok}, {"reason", health.reason}}},
          {"mission", mission_kind.empty() ? json(nullptr) : json(mission_kind)},
          {"motion", {{"vx_mps", sent.vx_mps}, {"vy_mps", sent.vy_mps}, {"wz_dps", sent.wz_dps}}},
          {"vision", w.detections ? json{{"frame_seq", w.detections->frame_seq},
                                         {"inference_ms", w.detections->inference_ms},
                                         {"detections", w.detections->items.size()}}
                                  : json(nullptr)},
          {"devices", devices}};
}

bool known_device(const std::string& name) {
  for (const auto* group : {&kPiDevices, &kPicoDevices}) {
    for (const auto& d : *group) {
      if (d == name) return true;
    }
  }
  return false;
}

// `robotctl mock ...`: turn a mock knob. Returns an error string, or empty on success.
std::string apply_mock(const json& body, MockControls& controls) {
  const std::string what = body.value("what", "");
  const std::string value = body.value("value", "");
  const std::string device = body.value("device", "");
  if (what == "pico_link" && (value == "lost" || value == "ok")) {
    controls.set_pico_link_lost(value == "lost");
  } else if (what == "thermal_blob") {
    // A fake warm body for laptop tests: off, or the column (0..31) it shows at.
    if (value == "off") controls.set_thermal_blob(-1);
    else if (!value.empty() && std::isdigit(static_cast<unsigned char>(value[0])) && std::stoi(value) < 32)
      controls.set_thermal_blob(std::stoi(value));
    else return "usage: mock thermal_blob off|<column 0..31>";
  } else if (what == "estop_sense" && (value == "on" || value == "off")) {
    controls.set_estop_sense(value == "on");
  } else if (what == "stale" && known_device(device) && (value == "on" || value == "off")) {
    controls.set_stale(device, value == "on");
  } else if (what == "init" && known_device(device) && (value == "OK" || value == "DEGRADED" || value == "FAILED")) {
    controls.set_init_status(device, value == "OK"         ? DeviceStatus::OK
                                     : value == "DEGRADED" ? DeviceStatus::DEGRADED
                                                           : DeviceStatus::FAILED);
  } else {
    return "usage: mock pico_link lost|ok, mock estop_sense on|off, mock stale <device> on|off, "
           "mock init <device> OK|DEGRADED|FAILED";
  }
  return "";
}

// Heading rate in degrees per second clockwise from the newest IMU sample, if it is fresh.
// heading.gyro_axis and heading.gyro_sign are TBD until the IMU mounting is known.
std::optional<double> imu_heading_rate(const Config& cfg, const IPicoLink& pico, SteadyTime now) {
  const auto imu = pico.readings().imu.read();
  if (!imu) return std::nullopt;
  const auto stale = cfg.stale_ms.find("imu");
  if (stale == cfg.stale_ms.end() || ms_between(imu->written, now) > stale->second) return std::nullopt;
  const std::string& axis = cfg.location.heading_gyro_axis;
  const double g = axis == "x" ? imu->value.gx : axis == "y" ? imu->value.gy : imu->value.gz;
  return cfg.location.heading_gyro_sign * g;
}

// The next due time of a periodic message; after a slow stretch it restarts from now, no burst.
SteadyTime next_due(SteadyTime due, double hz, SteadyTime now) {
  due += std::chrono::duration_cast<SteadyTime::duration>(std::chrono::duration<double>(1.0 / hz));
  return due < now ? now : due;
}

}  // namespace

int main(int argc, char** argv) {
  Args args;
  if (!parse_args(argc, argv, args)) return 2;
  if (args.verbose) log::set_level(log::Level::Debug);
  install_signal_handlers();

  // BOOT: load and validate the config.
  const ConfigResult loaded = load_config_file(args.config_path);
  Machine machine;
  {
    WorldSnapshot boot_world;
    const auto r = step(machine, boot_world, {Event{loaded.ok ? EventType::config_valid : EventType::config_invalid}},
                        StateMachineConfig{});
    if (r.next.state == State::SHUTDOWN) {
      log::error("BOOT -> SHUTDOWN: " + loaded.error);
      return 2;
    }
  }
  const Config& cfg = loaded.config;
  log::info("robot " + cfg.robot_id + " (" + cfg.robot_name + "), config " + args.config_path);

  const StateMachineConfig sm_config{cfg.fault_max_retries, static_cast<double>(cfg.shutdown_timeout_ms)};
  GateConfig gate_config;
  gate_config.max_lin_mps = cfg.limits.max_lin_mps;
  gate_config.max_ang_dps = cfg.limits.max_ang_dps;
  gate_config.max_lin_accel = cfg.limits.max_lin_accel;
  gate_config.max_ang_accel = cfg.limits.max_ang_accel;
  gate_config.reject_factor = cfg.limits.reject_factor;
  gate_config.terrain_slow_scale = cfg.terrain_slow_scale;
  gate_config.tick_s = 1.0 / cfg.loop.rate_hz;

  ControlServer control;
  std::string control_error;
  if (control.start(cfg.control_socket, &control_error)) {
    log::info("control socket " + cfg.control_socket);
  } else {
    log::error(control_error + " (robotctl will not work; e-stop only by power)");
  }

  // The bridge client never blocks, so it starts before the devices (robot.md 4.1 step 2). It
  // connects on its first poll and keeps retrying with backoff while the bridge is not up.
  BridgeClient bridge(BridgeClientConfig{cfg.bridge.socket, cfg.bridge.outbox});
  MessageBuilder messages(cfg.robot_id);
  log::info("bridge socket " + cfg.bridge.socket + ", outbox " +
            (cfg.bridge.outbox.empty() ? std::string("off") : cfg.bridge.outbox));

  // Location (robot.md section 8). Demo places come from paths_file; without it, demo positions
  // start at the site center.
  DemoPlaces places;
  places.anchor = {cfg.site.center_lat, cfg.site.center_lon};
  std::string places_error;
  if (!load_demo_places(cfg.location.paths_file, &places, &places_error)) {
    log::warn("location: " + places_error + "; demo positions start at site.center");
  }
  Localizer localizer(LocalizerConfig{cfg.location.force_demo, cfg.location.heading_initial_deg,
                                      cfg.location.heading_gps_min_speed_mps, cfg.location.heading_source == "imu",
                                      cfg.location.odometry_scale},
                      places);
  // Until the bridge sends a `site` message, the config's site.* stands in for it.
  SiteMsg site;
  site.demo_mode = cfg.site.demo_mode_default;
  site.center_lat = cfg.site.center_lat;
  site.center_lon = cfg.site.center_lon;
  site.radius_m = cfg.site.radius_m;
  localizer.set_site_demo_mode(site.demo_mode);
  // Missions the robot cannot run yet (every kind but hold) are kept here and logged. The mission
  // runner (task R6) takes them over; until then they are not started and get no progress.
  // With missions.auto_start off, a hold mission waits here too, until `robotctl start`.
  std::optional<MissionMsg> stored_mission;
  FinishedMissions finished_missions;  // done or failed this boot, so a resend does not restart them
  std::optional<TerrainHintMsg> terrain_hint;  // advisory, for the terrain assessor (task R7)

  auto controls = std::make_shared<MockControls>();
  Hardware hw = build_hardware(cfg, controls);
  std::set<std::string> pico_devices(kPicoDevices.begin(), kPicoDevices.end());
  DeviceManager devices(hw.init_order, pico_devices, Millis(cfg.init_device_timeout_ms));

  // Workers start now; each idles until its devices report ready after INIT.
  MovementConfig movement_config;
  movement_config.rate_hz = cfg.movement_rate_hz;
  movement_config.command_timeout_ms = cfg.movement_command_timeout_ms;
  movement_config.release_servos_on_stop = cfg.safe_stop_servo_action == "release";
  const MecanumSettings& m = cfg.mecanum;
  movement_config.mecanum = MecanumConfig{m.wheel_radius_m, m.half_track_lx_m, m.half_base_ly_m, m.max_wheel_rad_s,
                                          m.wheel_order, m.invert};
  if (!mecanum_dimensions_known(movement_config.mecanum)) {
    log::warn("motion: mecanum dimensions TBD (motion.mecanum.*), so the wheels stay at 0");
  }
  movement_config.servo_max_rate_us_per_s = cfg.legs.max_rate_us_per_s;
  std::shared_ptr<ILegIK> leg_ik = make_leg_ik_mock();
  if (cfg.legs.impl == "two_link") {
    LegIkConfig ik{cfg.legs.l1_m, cfg.legs.l2_m, cfg.legs.stance_height_m, cfg.legs.stance_x_m, cfg.legs.knee_bend, {}};
    bool all_calibrated = true;
    for (std::size_t l = 0; l < 4; ++l) {
      for (std::size_t j = 0; j < 3; ++j) {
        const JointSettings& s = cfg.legs.joints[l][j];
        ik.joints[l][j] = JointCal{s.bus, s.channel, s.zero_us, s.us_per_rad, s.direction, s.min_us, s.max_us};
        all_calibrated = all_calibrated && ik.joints[l][j].calibrated();
      }
    }
    if (!all_calibrated) log::warn("legs: some joints are not calibrated (robot_diag legcal), so the legs will not move");
    leg_ik = make_leg_ik_2link(ik);
  }
  MovementThread movement(Actuators{hw.dc_a, hw.dc_b, hw.maestro_a, hw.maestro_b, leg_ik}, movement_config);
  VisionThread vision(hw.camera, hw.detector, cfg.vision_rate_hz);
  movement.start();
  vision.start();

  SteadyClock clock;
  std::vector<Event> pending{Event{EventType::config_valid}};
  std::unique_ptr<IBehavior> behavior;
  // Remote driving: robotctl drive/teleop and the bridge's teleop messages all write here; only a
  // running "teleop" mission reads it (mission/behaviors/teleop.hpp).
  auto teleop_input = std::make_shared<TeleopInput>();
  std::uint64_t teleop_seq = 0;
  std::string mission_kind;
  std::uint64_t mission_id = 0;
  std::uint64_t movement_seq = 0;
  bool movement_stall_reported = false;
  std::string last_reason = "config valid";
  GateMemory gate_memory;
  bool sigterm_sent = false;
  bool notified_ready = false;
  int overruns_in_a_row = 0;
  double worst_tick_ms = 0;
  long long tick = 0;

  // Bridge messages: mission_progress only for real missions (id 0 is a local robotctl test).
  // A done or failed mission is remembered, so the bridge's resend of it is ignored.
  auto send_progress = [&](std::uint64_t id, const char* status, const std::string& note) {
    if (id == 0) return;
    bridge.send(messages.mission_progress(id, status, note));
    if (std::string(status) != "active") finished_missions.add(id);
  };
  std::map<std::string, std::pair<DeviceStatus, std::string>> devices_sent;  // last status sent per device
  SteadyTime next_heartbeat = clock.now();
  SteadyTime next_position = clock.now();
  bool position_unknown_logged = false;

  const auto period = std::chrono::duration_cast<std::chrono::steady_clock::duration>(
      std::chrono::duration<double>(1.0 / cfg.loop.rate_hz));
  const double period_ms = 1000.0 / cfg.loop.rate_hz;
  const long long ticks_per_second = static_cast<long long>(cfg.loop.rate_hz + 0.5);
  SteadyTime next_tick = clock.now();

  while (true) {
    const SteadyTime tick_start = clock.now();

    // 1. Observe. The Pico link first: read the bytes already waiting, never wait for more.
    hw.pico->poll(tick_start);
    const WorldSnapshot world = observe(cfg, devices, hw, *controls, movement, vision, tick_start);
    std::vector<Event> events = std::move(pending);
    pending.clear();
    if (g_stop_requested && !sigterm_sent) {
      events.push_back(Event{EventType::sigterm});
      sigterm_sent = true;
    }
    for (const auto& req : control.poll()) {
      const std::string cmd = req.body.value("cmd", "");
      if (cmd == "status") {
        json status = status_json(cfg, machine, last_reason, world, gate_memory.last_sent, mission_kind);
        const Location& loc = localizer.location();
        status["bridge"] = {{"connected", bridge.connected()},
                            {"telemetry_queued", bridge.telemetry_queued()},
                            {"important_queued", bridge.important_queued()},
                            {"site_demo_mode", site.demo_mode},
                            {"stored_mission", stored_mission ? json(stored_mission->id) : json(nullptr)}};
        status["location"] = {{"mode", to_string(loc.mode)},
                              {"lat", loc.lat ? json(*loc.lat) : json(nullptr)},
                              {"lon", loc.lon ? json(*loc.lon) : json(nullptr)},
                              {"heading_deg", loc.heading_deg},
                              {"note", loc.note}};
        control.reply(req.client, status);
      } else if (cmd == "test_detection") {
        // TEST HOOK for the R3 laptop check: queue one fake thermal detection so the bridge path
        // (report_detection) can be seen before the inspect behavior exists (task R6). Mission id:
        // the one robotctl passed, else the running mission, else bridge.test_mission_id. Never 0,
        // because the bridge drops mission 0 messages.
        std::uint64_t id = 0;
        const auto given = req.body.find("mission_id");
        if (given != req.body.end() && given->is_number_unsigned()) {
          id = given->get<std::uint64_t>();
        } else if (machine.state == State::ACTIVE && mission_id != 0) {
          id = mission_id;
        } else {
          id = cfg.bridge.test_mission_id;
        }
        const Location& loc = localizer.location();
        if (id == 0) {
          control.reply(req.client, {{"ok", false},
                                     {"error", "no mission id: pass one, run a mission, or set bridge.test_mission_id"}});
        } else if (!loc.lat || !loc.lon) {
          control.reply(req.client, {{"ok", false}, {"error", "location unknown; report_detection needs lat and lon"}});
        } else {
          DetectionFields d;
          d.mission_id = id;
          d.source = "thermal";
          d.lat = loc.lat;
          d.lon = loc.lon;
          d.gps_fix = loc.gps_fix;
          d.location_note = localizer.note_with_bearing(std::nullopt);
          d.max_temp_c = 34.0;          // made up: a test hook, not a reading
          d.thermal_confidence = 0.9;   // made up
          d.thermal_debug = {{"test_hook", true}};
          const json detection = messages.detection(d);
          bridge.send(detection);
          log::warn("TEST HOOK: queued fake detection " + detection.value("client_ref", "") + " for mission " +
                    std::to_string(id));
          control.reply(req.client, {{"ok", true}, {"client_ref", detection["client_ref"]}, {"mission_id", id}});
        }
      } else if (cmd == "thermal_frame") {
        // Read-only preview; only this robot process owns the Pico serial link.
        const auto sample = hw.pico->readings().thermal.read();
        if (!sample) {
          control.reply(req.client, {{"ok", false}, {"error", "no thermal frame yet"}});
        } else {
          control.reply(req.client, {{"ok", true}, {"robot_id", cfg.robot_id},
                                     {"age_ms", ms_between(sample->written, clock.now())},
                                     {"width", sample->value.width}, {"height", sample->value.height},
                                     {"centi_deg_c", sample->value.centi_deg_c}});
        }
      } else if (cmd == "drive") {
        // One teleop command; robotctl drive/teleop re-send it about 10 times a second.
        const auto num = [&](const char* k) { return req.body.contains(k) && req.body[k].is_number() ? req.body[k].get<double>() : 0.0; };
        TeleopCommand t{num("vx"), num("vy"), num("wz"), ++teleop_seq, "robotctl"};
        if (!std::isfinite(t.vx_mps) || !std::isfinite(t.vy_mps) || !std::isfinite(t.wz_dps)) {
          control.reply(req.client, {{"ok", false}, {"error", "vx, vy and wz must be numbers"}});
          continue;
        }
        teleop_input->write(t, clock.now());
        json reply = {{"ok", true}};
        if (mission_kind != "teleop") reply["note"] = "not driving: start a teleop mission first (robotctl start teleop)";
        control.reply(req.client, reply);
      } else if (cmd == "start") {
        const std::string kind = req.body.value("kind", "hold");
        if (kind != "hold" && kind != "seek_thermal" && kind != "teleop") {
          control.reply(req.client, {{"ok", false}, {"error", "unknown mission kind '" + kind +
                                                                   "' (hold, seek_thermal or teleop)"}});
          continue;
        }
        Event e{EventType::start};
        e.mission_kind = kind;  // mission_id 0: a local test mission, not sent to SpacetimeDB
        // With missions.auto_start off, a stored bridge hold mission starts here instead (in READY
        // only, so a start in another state does not fail it).
        if (machine.state == State::READY && stored_mission && stored_mission->kind == kind) {
          e.mission_id = stored_mission->id;
          stored_mission.reset();
        }
        events.push_back(e);
        control.reply(req.client, {{"ok", true}, {"queued", "start " + kind}, {"mission_id", e.mission_id}});
      } else if (cmd == "stop" || cmd == "estop" || cmd == "reset") {
        events.push_back(Event{cmd == "stop" ? EventType::stop : cmd == "estop" ? EventType::estop : EventType::reset});
        control.reply(req.client, {{"ok", true}, {"queued", cmd}});
      } else if (cmd == "mock") {
        const std::string error = apply_mock(req.body, *controls);
        control.reply(req.client, error.empty() ? json{{"ok", true}} : json{{"ok", false}, {"error", error}});
      } else {
        control.reply(req.client, {{"ok", false}, {"error", "commands: status, start, stop, estop, reset, mock, test_detection"}});
      }
    }
    // The bridge sends mission, cancel, site, terrain_hint (robot.md 9.4), and teleop (PROPOSED).
    for (const auto& msg : bridge.poll(tick_start)) {
      switch (msg.type) {
        case InboundType::Mission: {
          const MissionMsg& m = msg.mission;
          const std::string id = std::to_string(m.id);
          const MissionContext ctx{machine.state == State::ACTIVE, mission_id,
                                   stored_mission ? std::optional<std::uint64_t>(stored_mission->id) : std::nullopt,
                                   cfg.missions_auto_start};
          switch (classify_mission(m, ctx, events, finished_missions)) {
            case MissionAction::ignore_duplicate:
              log::info("bridge: duplicate mission " + id + " ignored");  // the resend after a reconnect
              break;
            case MissionAction::ignore_finished:
              log::info("bridge: mission " + id + " already ended this boot, ignored");
              break;
            case MissionAction::start: {
              Event e{EventType::start};
              e.mission_id = m.id;
              e.mission_kind = m.kind;
              events.push_back(e);  // the state machine accepts it in READY or rejects it with a note
              log::info("bridge: mission " + id + " (" + m.kind + ") from " + m.created_by);
              break;
            }
            case MissionAction::store:
              stored_mission = m;
              if (m.kind == "hold") {
                log::warn("bridge: mission " + id + " (hold) stored: missions.auto_start is off, run robotctl start");
              } else {
                log::warn("bridge: mission " + id + " (" + m.kind + ") stored, not started: the mission runner is task R6");
              }
              break;
          }
          break;
        }
        case InboundType::Cancel: {
          const std::uint64_t id = msg.cancel_mission_id;
          bool found = false;
          if (id != 0 && machine.state == State::ACTIVE && id == mission_id) {
            events.push_back(Event{EventType::mission_cancelled});
            found = true;
          }
          if (drop_pending_start(events, id) > 0) found = true;  // its mission came in this same batch
          if (stored_mission && stored_mission->id == id) {
            stored_mission.reset();
            found = true;
          }
          log::info("bridge: cancel mission " + std::to_string(id) + (found ? "" : " ignored: not running or pending"));
          break;
        }
        case InboundType::Site:
          if (msg.site.demo_mode != site.demo_mode) {
            log::info(std::string("bridge: site demo mode ") + (msg.site.demo_mode ? "on" : "off"));
          }
          site = msg.site;
          localizer.set_site_demo_mode(site.demo_mode);
          break;
        case InboundType::TerrainHint:
          terrain_hint = msg.terrain_hint;
          log::debug("bridge: terrain hint " + msg.terrain_hint.terrain_class);
          break;
        case InboundType::Teleop:
          // From the website's joystick (PROPOSED contract). Only a running teleop mission uses it.
          teleop_input->write(TeleopCommand{msg.teleop.vx_mps, msg.teleop.vy_mps, msg.teleop.wz_dps, msg.teleop.seq, "web"},
                              tick_start);
          break;
      }
    }

    // 2. Step.
    const StepResult r = step(machine, world, events, sm_config);
    if (r.next.state != machine.state) {
      log::info(std::string(to_string(machine.state)) + " -> " + to_string(r.next.state) + ": " + r.reason);
      last_reason = r.reason;
    } else if (!r.reason.empty()) {
      log::info(std::string(to_string(machine.state)) + ": " + r.reason);
    }
    for (const auto& rej : r.rejected) {
      log::warn("mission " + std::to_string(rej.mission_id) + " rejected: " + rej.note);
      send_progress(rej.mission_id, "failed", rej.note);
    }
    if (r.abort_mission) {
      log::warn("mission " + std::to_string(mission_id) + " failed: " + r.abort_note);
      send_progress(mission_id, "failed", r.abort_note);
    }
    if (r.alert) log::error("ALERT: " + r.reason);
    if (r.begin_init) devices.start_init(machine.state == State::BOOT);
    // An operator stop ends a bridge mission too; tell SpacetimeDB, or it stays active there.
    // A bridge cancel sends nothing: the module already knows.
    if (r.operator_stop && mission_id != 0) {
      log::warn("mission " + std::to_string(mission_id) + " failed: stopped by operator");
      send_progress(mission_id, "failed", "stopped by operator");
    }
    if (r.next.state != State::ACTIVE && behavior) {
      behavior->cancel();
      behavior.reset();
      mission_kind.clear();
      mission_id = 0;
    }
    if (r.start_mission) {
      if (r.mission.mission_kind == "seek_thermal") {
        behavior = std::make_unique<ThermalSeekBehavior>(cfg.thermal, cfg.seek);
      } else if (r.mission.mission_kind == "teleop") {
        teleop_input = std::make_shared<TeleopInput>();  // never drive on a command left from before
        behavior = std::make_unique<TeleopBehavior>(teleop_input, cfg.teleop_deadman_ms);
      } else {
        behavior = std::make_unique<HoldBehavior>();
      }
      behavior->start();
      mission_kind = r.mission.mission_kind;
      mission_id = r.mission.mission_id;
      send_progress(mission_id, "active", "started " + mission_kind);
    }
    if (r.next.state == State::READY && !notified_ready) {
      notify::ready();
      notified_ready = true;
    }
    machine = r.next;

    // 3. Behavior.
    BehaviorOutput output;
    if (machine.state == State::ACTIVE && behavior) {
      output = behavior->tick(world);
      if (output.done) {
        pending.push_back(Event{EventType::mission_done});
        send_progress(mission_id, "done", mission_kind + " done");
      }
      if (output.failed) {
        pending.push_back(Event{EventType::mission_failed});
        send_progress(mission_id, "failed", mission_kind + " failed");
      }
    }

    // 4. Safety gate.
    GateResult gated = SafetyGate::filter(machine.state, machine.latched, world, output, gate_config, gate_memory);
    gate_memory = gated.memory;
    for (auto& e : gated.raised) pending.push_back(e);  // the state machine sees them next tick

    // 5. Send. One short lock; the movement thread applies it on its next step.
    movement.submit(MovementCommand{++movement_seq, gated.motion}, clock.now());

    // Location: dead-reckon with the command just sent (robot.md section 8).
    LocalizerInput where;
    where.now = tick_start;
    where.vx_mps = gated.motion.command().vx_mps;
    where.vy_mps = gated.motion.command().vy_mps;
    where.wz_dps = gated.motion.command().wz_dps;
    where.imu_heading_rate_dps = imu_heading_rate(cfg, *hw.pico, tick_start);
    // TODO(R2): where.gps from the gpsd reader's latest fix slot, once the GPS device exists.
    const Location& loc = localizer.update(where);

    // Bridge messages. send() only queues; the socket is written on the next tick's poll.
    if (bridge.take_reconnected()) {
      devices_sent.clear();  // a new bridge (or a restarted one) gets every device again
      next_heartbeat = tick_start;
      next_position = tick_start;
    }
    if (tick_start >= next_heartbeat) {
      bridge.send(messages.heartbeat(to_string(machine.state), std::nullopt));  // battery_pct: no monitor, TBD
      next_heartbeat = next_due(next_heartbeat, cfg.bridge.heartbeat_hz, tick_start);
    }
    if (tick_start >= next_position) {
      if (loc.lat && loc.lon) {
        bridge.send(messages.position(PositionFields{*loc.lat, *loc.lon, loc.gps_fix, loc.indoor_offset_m,
                                                     loc.heading_deg}));
        position_unknown_logged = false;
      } else if (!position_unknown_logged) {
        log::warn("location unknown (no GPS fix, not demo mode): no position messages until there is one");
        position_unknown_logged = true;
      }
      next_position = next_due(next_position, cfg.bridge.position_hz, tick_start);
    }
    for (const auto& d : world.devices) {
      if (!d.initialized) continue;  // "not initialized" is not news
      const auto it = devices_sent.find(d.name);
      if (it != devices_sent.end() && it->second.first == d.status && it->second.second == d.detail) continue;
      bridge.send(messages.device(d.name, to_string(d.status), d.detail));
      devices_sent[d.name] = {d.status, d.detail};
    }

    // 6. Log.
    for (const auto& line : gated.log_lines) log::warn(line);
    if (machine.state == State::SHUTDOWN) break;

    // Timing: overrun detection, watchdog ping, sleep.
    const double tick_ms = ms_between(tick_start, clock.now());
    if (tick_ms > worst_tick_ms) worst_tick_ms = tick_ms;
    if (tick_ms > cfg.loop.overrun_factor * period_ms) {
      if (++overruns_in_a_row >= cfg.loop.overrun_ticks) {
        pending.push_back(Event(EventType::loop_overrun, std::to_string(overruns_in_a_row) + " slow ticks"));
        overruns_in_a_row = 0;
      }
    } else {
      overruns_in_a_row = 0;
    }
    // A stuck movement thread is a safety event (it may be holding the last command), and it
    // also stops the systemd watchdog ping so systemd restarts the program. Vision is optional.
    const bool movement_alive = movement.heartbeat_age_ms(clock.now()) <= cfg.workers_stall_ms;
    if (!movement_alive && !movement_stall_reported) {
      pending.push_back(Event(EventType::worker_stalled, "movement thread heartbeat stopped"));
      log::error("movement thread is not responding");
    }
    movement_stall_reported = !movement_alive;
    if (vision.heartbeat_age_ms(clock.now()) > cfg.workers_stall_ms && tick % ticks_per_second == 0) {
      log::warn("vision thread is not responding");
    }
    if (tick_ms <= period_ms && movement_alive) notify::watchdog();

    if (++tick % ticks_per_second == 0) {
      const Health health = assess_health(world, machine.latched);
      char worst[32];
      std::snprintf(worst, sizeof(worst), "%.2f ms", worst_tick_ms);
      log::info(std::string("summary: state ") + to_string(machine.state) + (machine.latched ? " (latched)" : "") +
                ", health " + (health.ok ? "ok" : health.reason) + ", bridge " +
                (bridge.connected() ? "up" : "down") + ", location " + to_string(localizer.location().mode) +
                ", worst tick " + worst);
      worst_tick_ms = 0;
    }

    next_tick += period;
    const SteadyTime now = clock.now();
    if (next_tick < now) next_tick = now;  // running late: do not try to catch up with a burst
    std::this_thread::sleep_until(next_tick);
  }

  notify::stopping();
  // Stop the workers first: the movement thread stops the wheels in on_stop().
  vision.request_stop();
  movement.request_stop();
  vision.join();
  movement.join();
  hw.camera->stop();
  control.stop();
  bridge.close();  // unsent detections, cells, and progress go to the outbox for the next start
  log::info("SHUTDOWN");
  return 0;
}
