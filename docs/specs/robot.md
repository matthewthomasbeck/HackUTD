# Robot software spec: C++ main program, Node.js bridge, Pico firmware

Status: PROPOSED (2026-11-07), follows `docs/specs/CONTRACTS.md` version 8.1.
Audience: coding agents and teammates who build the robot software for the rubble search robot dog.
This spec follows `docs/specs/CONTRACTS.md` exactly; CONTRACTS.md wins where they differ.
Where it needs a contract change, the change is listed in "Proposed contract changes" at the end, and the code uses the current contract until a human updates `CONTRACTS.md`.

Backend: SpacetimeDB (CONTRACTS.md version 8).
The robot never talks to SpacetimeDB itself; the Node.js bridge on the Pi does, with the generated TypeScript bindings in `backend/spacetimedb-bindings/` and the robot's own identity.
Writes go only through reducers, and the bridge learns about missions and cancellations from subscriptions.

Agents: missions come from the orchestrator (a Nemotron agent on the laptop in `backend/agent/`, which plans the search and calls `create_mission` directly) or from a coordinator.
No agent ever commands motors (section 10.3).

Read these first:

- `docs/specs/CONTRACTS.md`: shared names, tables, reducers, the local bridge protocol, the media server, recording and replay.
- `docs/ROBOT.md`: hardware, pin map, Pi and Pico architecture, state machine, Pi-Pico protocol, safety layers, and the team's working rules.
- `docs/PROJECT.md`: what the whole system does.
- `docs/research/platform.md`: bridge, GPS over USB with gpsd.
- `docs/research/perception.md`: thermal blob detection, breathing clip rules, why the NCS2 is skipped.
- `docs/MVP.md`: scope (must, should, could have) and "Assignments".

Owners (from `docs/MVP.md` "Assignments", 2026-11-07, can change):

| Person | Owns in this spec |
| --- | --- |
| Camille | Robot edge software: the C++ program, the Pico firmware, missions, thermal detection, the bridge |
| Matthew Beck | Electrical system and bring-up; the only source for what the servos move, motor drivers, and wiring facts |
| Eric Lee | Computer vision and terrain recognition, including the optional camera terrain model (section 7b.5) |
| Cayden Hutcheson | Glasses, and extra hands on the bridge or tests |

`docs/ROBOT.md` uses role names S0, S1, S2; this spec uses the people's names from `docs/MVP.md`.

## 0. Rules every coding agent must follow

- Anything marked TBD or PROPOSED is open.
  Put it in config, give it a placeholder, and do not hard-code it.
  Ask the team (Matthew for hardware) before locking it.
- Never assume hardware details: I2C addresses, baud rates other than those in `docs/ROBOT.md`, driver protocols, servo channel maps, voltages.
- Every device has an interface, a real implementation, and a mock.
  The full program, including the state machine and every mission behavior, must run on a laptop (Linux or macOS) with no hardware attached.
- Behaviors never touch hardware.
  They return commands, and only the safety gate passes commands to the drivers.
- The main loop never blocks on I/O: not on the Pico, the camera, the bridge socket, gpsd, the disk, or the network.
- Prefer iterative code over recursive code (for example the blob flood fill uses an explicit stack).
- No em dashes in code, comments, docs, or commit messages.
- Explain changes in the PR or commit body for a learning teammate, and trace one example through the change.
- No agent (orchestrator, comms agent, auditor) can ever command motors.
  The only things that reach the robot from the network are `mission`, `cancel`, `site`, and the optional advisory `terrain_hint` messages (section 9).

## 1. Scope

| Component | Folder in the team repo | Language |
| --- | --- | --- |
| Robot main program | `raspberrypi/robot/` | C++17, CMake |
| Robot bridge to SpacetimeDB | `raspberrypi/bridge/` | TypeScript on Node.js 22 |
| Pi system files (systemd, udev, tmpfiles, boot config notes) | `raspberrypi/system/` | text |
| Pico firmware | `pico/` | C/C++, Pico C SDK |
| Shared Pi-Pico frame definitions | `protocol/` | C header, used by both sides |

The `protocol/` folder at the repo root follows the suggested layout in `docs/ROBOT.md`.
It is new; the team repo already has `raspberrypi/`, `pico/`, `backend/`, `frontend/`, `3d_parts/`, and `images/`.

Out of scope here: the SpacetimeDB module (`spacetimedb.md`), the perception service and media server (`perception.md`), the agent, the glasses, the dashboard, and the simulator.

## 2. Folder layout

```
protocol/
  pico_link.h                 # frame header, message types, device ids, payload structs, CRC16 (PROPOSED values)
raspberrypi/
  robot/
    CMakeLists.txt
    config/
      robot.yaml              # Pi config, real hardware (every TBD value present and marked)
      robot.laptop.yaml       # all devices mocked, socket paths under /tmp
      scripts/demo_paths.yaml # scripted paths and demo waypoints (section 8)
    src/
      main.cpp                # parse args, load config, BOOT, init, loop, shutdown
      core/
        config.hpp/.cpp       # YAML load + validation (BOOT step)
        clock.hpp             # Clock interface: SteadyClock (real) and FakeClock (tests)
        latest_slot.hpp       # LatestSlot<T>: mutex-guarded value + timestamp
        log.hpp/.cpp          # leveled logger to stderr (journald picks it up)
        world.hpp             # WorldSnapshot struct (one tick's view of everything)
        commands.hpp          # MotionCommand, CaptureRequest
        geo.hpp/.cpp          # local meters <-> lat/lon, bearing, distance
      hal/
        device.hpp            # DeviceStatus {OK, DEGRADED, FAILED}, IDevice {init(), status(), name()}
        servo_bus.hpp         # IServoBus (one per Maestro)
        servo_maestro.cpp     # real: Pololu Maestro compact protocol over UART
        servo_mock.cpp
        dc_driver.hpp         # IDcDriver (one per dual driver, 2 channels)
        dc_driver_gpio.cpp    # real: GPIO PWM H-bridge via pigpiod (docs/ROBOT.md "Pi 4B GPIO")
        gpio.hpp, gpio_pigpio.cpp  # IGpio over pigpiod; FAILED with the reason when pigpio is missing
        pico_text_protocol.*  # parser for the firmware's text lines (pico/README.md)
        dc_driver_mock.cpp
        pico_link.hpp         # IPicoLink: start(), send(), latest-value slots for every Pico sensor
        pico_link_serial.cpp  # real: /dev/pico, reader thread, framing, CRC, heartbeat
        pico_link_mock.cpp    # synthetic IMU, thermal frames (with a warm blob on demand), force sensors, lidars
        camera.hpp            # ICamera: latest frame slot, still capture, clip recording
        camera_libcamera.cpp  # real: libcamera C++ API (compiled only when libcamera is found)
        camera_mock.cpp       # synthetic gray frames with a slow periodic brightness change
        gps.hpp               # IGps: latest fix slot
        gps_gpsd.cpp          # real: TCP to gpsd on localhost:2947, JSON TPV reports
        gps_mock.cpp          # fixed or scripted fix, "indoors" toggle
        light.hpp             # ILight: optional white light for the camera (hardware TBD)
        light_maestro_digital.cpp  # spare Maestro channel as digital output (TBD)
        light_mock.cpp
      motion/
        motion.hpp            # IMotion: apply(MotionCommand), stop(), capabilities()
        motion_mock.cpp       # integrates commanded velocity into a fake pose
        motion_drive_only.cpp # 4 DC motors, mecanum wheels, mecanum mixing (section 12.4)
        leg_ik.hpp            # ILegIK: stance height, lift one leg (section 12.5)
        leg_ik_mock.cpp       # records requested joint targets
        leg_ik_2link.cpp      # planar 2-link IK, geometry from config (TBD from Matthew)
        motion_legged.cpp     # stretch: legs through ILegIK plus wheels
      perception/
        thermal_detector.hpp/.cpp   # warm blob rule (section 7)
        thermal_render.hpp/.cpp     # false color PNG of a thermal frame
      localization/
        localizer.hpp/.cpp    # GPS, last fix + offset, demo coordinates (section 8)
      terrain/
        terrain.hpp           # TerrainClass, TerrainAction, TerrainAssessment, ITerrainAssessor
        terrain_rules.cpp     # rule-based assessor from LD19, single LiDAR, IMU tilt (section 7b)
        terrain_mock.cpp      # scripted classes for tests and laptop runs
        terrain_hint.hpp/.cpp # optional camera model hint slot (section 7b.5)
        terrain_reporter.cpp  # rate-limited terrain messages to the bridge
      bridge/
        bridge_client.hpp/.cpp      # NDJSON over Unix socket, non-blocking, two queues
        messages.hpp/.cpp           # build and parse local protocol JSON
        control_server.hpp/.cpp     # local operator socket: start, stop, estop, reset, status
      state/
        state_machine.hpp/.cpp      # pure transition function (section 5)
        safety_gate.hpp/.cpp        # pure filter (section 10)
      mission/
        mission.hpp                 # Mission struct, validation against limits
        mission_runner.hpp/.cpp     # owns the current mission, sub-state machine, progress messages
        behaviors/
          behavior.hpp              # IBehavior: start(), tick(world) -> BehaviorOutput, cancel()
          idle.cpp
          follow_path.cpp           # scripted path follower (drive-only)
          scan.cpp                  # stand still or rotate in place, run the thermal detector
          inspect.cpp               # settle, confirm, stills, 20 s clip, detection
          search_cells.cpp
          return_home.cpp
          hold.cpp
      recorder/
        sensor_log.hpp/.cpp         # raw logs on the SD card (section 11)
        clip_writer.hpp/.cpp        # pipes gray frames to ffmpeg in a worker thread
    tools/
      robotctl.cpp            # CLI for the control socket
      robot_diag.cpp          # bring up one device at a time and print readings
      http_reducer_test.sh    # test-first: call reducers directly over the SpacetimeDB HTTP API (section 9.10)
    third_party/
      stb_image_write.h       # PNG and JPEG writer, single header (public domain or MIT)
    tests/
      test_state_machine.cpp
      test_safety_gate.cpp
      test_pico_frame.cpp
      test_thermal_detector.cpp
      test_localizer.cpp
      test_mission_runner.cpp
      test_bridge_client.cpp
      test_terrain.cpp
      test_motion.cpp
      test_config.cpp
  bridge/
    package.json
    tsconfig.json
    .env.example
    src/
      index.ts                # start: SpacetimeDB connection, local socket server, spool
      stdb.ts                 # DbConnection, token, register, subscriptions, reconnect
      local_socket.ts         # Unix socket server, NDJSON parse and write
      mapping.ts              # local message -> reducer call (pure, unit tested)
      to_wire.ts              # SpacetimeDB row -> local JSON (bigint, enums, optionals)
      spool.ts                # append-only file spool, ordered replay
      media.ts                # POST /media, POST /breathing with retry
      missions.ts             # claim_next_mission, forward mission and cancel
      upload_logs.ts          # CLI: upload SD card sensor logs to the media server
    test/
      mapping.test.ts
      spool.test.ts
      to_wire.test.ts
  system/
    robot.service
    robot-bridge.service
    robot-tmpfiles.conf       # creates /run/robot
    99-robot.rules            # udev names
    config.txt.snippet        # /boot/firmware/config.txt lines from docs/ROBOT.md
    prestart.sh               # ExecStartPre checks
pico/
  CMakeLists.txt
  src/main.cpp                # superloop + hardware watchdog
  src/link.c/.h               # framing, CRC, heartbeat (uses protocol/pico_link.h)
  src/tasks/                  # imu, thermal, ads1115, lidar_single, ld19 (one poll() each)
```

## 3. Build and run

### 3.1 Dependencies

Pi (Debian 12 bookworm), install with apt:

```
sudo apt install build-essential cmake pkg-config git \
  libyaml-cpp-dev nlohmann-json3-dev libgtest-dev \
  libcamera-dev libsystemd-dev gpsd gpsd-clients ffmpeg
```

Node.js 22 or newer for the bridge, because the SpacetimeDB Node quickstart needs Node 22, 24, or 26+ ([SpacetimeDB Node.js quickstart](https://spacetimedb.com/docs/quickstarts/nodejs)).

Laptop (macOS with Homebrew, or Linux with apt): `cmake`, `yaml-cpp`, `nlohmann-json`, `googletest`, `ffmpeg`, Node 22, and the `spacetime` CLI from https://spacetimedb.com/install.
libcamera and libsystemd are not needed on the laptop.

### 3.2 C++ build

`raspberrypi/robot/CMakeLists.txt` must:

- Set `CMAKE_CXX_STANDARD 17` and warnings `-Wall -Wextra -Wpedantic` (treat as errors in CI).
- Find `yaml-cpp`, `nlohmann_json`, `Threads`, and `GTest`.
  If `GTest` is not found, fetch it with `FetchContent`.
- Option `ROBOT_WITH_LIBCAMERA` (default ON when `pkg_check_modules(LIBCAMERA libcamera)` succeeds).
  When OFF, `camera_libcamera.cpp` is not compiled and the factory can only build the mock camera.
- Option `ROBOT_WITH_SYSTEMD` (default ON when `libsystemd` is found).
  When OFF, `sd_notify` calls compile to no-ops.
- Build a static library `robot_core` from everything except `main.cpp`, then the executables `robot`, `robotctl`, `robot_diag`, and the test binary `robot_tests` linked to `robot_core`.

Commands:

```
cd raspberrypi/robot
cmake -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build -j
ctest --test-dir build --output-on-failure
```

### 3.3 Bridge build

```
cd raspberrypi/bridge
npm install
npm run build      # tsc
npm test           # node --test on dist/test or vitest, pick one and keep it
npm start          # node dist/src/index.js
npm run dev        # tsx watch src/index.ts
npm run upload-logs -- --dir /var/lib/robot/logs   # section 11
```

`package.json` depends on the `spacetimedb` npm package and imports the generated bindings from `../../backend/spacetimedb-bindings` (see `CONTRACTS.md`).
Do not copy the bindings into the bridge folder.

### 3.4 Run everything on a laptop with mocks (no hardware)

1. Start a local SpacetimeDB and publish the module (commands from `spacetimedb.md`; the Node quickstart uses `spacetime dev`, which runs a local server, publishes, and generates bindings, per the [Node.js quickstart](https://spacetimedb.com/docs/quickstarts/nodejs)).
2. Start the perception service and media server (from `perception.md`), or skip it and the bridge will spool media uploads and retry.
3. Start the bridge:

```
cd raspberrypi/bridge
cp .env.example .env    # STDB_URI=ws://localhost:3000, STDB_DATABASE=assess-0hw81, BRIDGE_SOCKET=/tmp/robot/bridge.sock, MEDIA_URL=http://localhost:8080
npm run dev
```

4. Start the robot with every device mocked:

```
cd raspberrypi/robot
./build/robot --config config/robot.laptop.yaml
```

5. Drive it locally without SpacetimeDB:

```
./build/robotctl --socket /tmp/robot/control.sock status
./build/robotctl start search_cells      # local test mission, mission_id 0, not sent to SpacetimeDB
./build/robotctl mock thermal_blob on    # mock Pico puts a warm blob in the thermal frames
./build/robotctl estop
./build/robotctl reset
```

6. Or create a real mission from the dashboard, the simulator, or the orchestrator (`backend/agent/`), and the bridge leases it with `claim_next_mission`.

`robot.laptop.yaml` sets `mock: true` for every device, sets socket paths under `/tmp/robot/`, sets the sensor log folder to `/tmp/robot/logs`, and sets `site.demo_mode_default: true`.
macOS has no `/run`, which is why the laptop config uses `/tmp/robot/`.

## 4. Main program shape

### 4.1 Startup (from `docs/ROBOT.md`)

1. BOOT: parse args, load and validate the config.
   Invalid config goes to SHUTDOWN with the reason logged and a non-zero exit code.
2. Start the control server and the bridge client (both are non-blocking and safe to start before devices).
3. INIT, Pi devices, in this order: Maestro A, Maestro B, DC driver A, DC driver B, Pico, camera, GPS.
   Each `init()` runs in an ephemeral `std::async` task with a timeout from config (`init.device_timeout_ms`, TBD, start at 3000).
   Each returns OK, DEGRADED, or FAILED with a detail string.
   The NCS2 is dropped (section 4.4), so it is not in the init order.
4. INIT, Pico devices, after the Pico link is up: version handshake first (a mismatch counts as FAILED), then `INIT_DEV` for IMU, thermal, ADS1115, single-point LiDAR, LD19, and collect a `DEV_STATUS` for each.
5. Send one `device` message per device to the bridge.
6. If every device listed in `devices.required` is OK (optional ones may be DEGRADED or FAILED), go to READY and call `sd_notify("READY=1")`.
   Otherwise go to FAULT.

`READY=1` tells systemd that startup has finished, and `WATCHDOG=1` is the keep-alive ping when `WatchdogSec=` is set ([sd_notify](https://www.freedesktop.org/software/systemd/man/latest/sd_notify.html)).

### 4.2 Threads (from `docs/ROBOT.md`, updated 2026-11-08)

| Thread | Job |
| --- | --- |
| Main | Init, then the fixed-rate loop. Drains `/dev/pico` each tick with non-blocking reads (parse frames, write latest-value slots, send heartbeats); there is no separate Pico reader thread |
| Movement | `MovementThread` at `movement.rate_hz`: the only writer to both Maestros and both DC drivers; applies the newest gated command; dead-man stop after `movement.command_timeout_ms` |
| Vision | `VisionThread`: newest camera frame -> OpenCV preprocessing -> Coral Edge TPU model -> latest detections slot |
| Camera | libcamera's request loop (its own thread), latest frame slot, feeds the clip writer when recording |
| Clip writer | Writes gray frames to an `ffmpeg` child process stdin |
| GPS | Reads gpsd JSON lines, writes the latest fix slot |
| Bridge I/O | `poll()` on the bridge socket and the control socket, drains outgoing queues, parses incoming lines into an inbox slot |
| Sensor log writer | Appends raw thermal frames and LD19 scans to files on the SD card |

Rules:

- Latest-value slots (`LatestSlot<T>`) for sensors, never unbounded queues.
- The bridge inbox is a small bounded queue of parsed messages (mission, cancel), because each one matters; capacity 16, oldest dropped with a log line.
- Every slot value carries the steady-clock time it was written.
  Data older than its timeout is stale.
- Every worker thread stamps a heartbeat each pass. If the movement thread's heartbeat is older than `workers.stall_ms`, the main loop raises `worker_stalled` (ACTIVE goes to SAFE_STOP) and stops feeding the systemd watchdog.

### 4.3 Main loop (order from `docs/ROBOT.md`)

Rate: `loop.rate_hz` (TBD, start at 50).
Each tick:

1. Observe: build a `WorldSnapshot` from all slots (copy values and ages), the bridge inbox, the control inbox, and `now`.
   Then run `terrain.assess(snapshot)` (section 7b) and store the `TerrainAssessment` in the snapshot.
   This is a pure computation on data already in memory, so it never waits on I/O or the network.
2. Step: `state_machine.step(state, snapshot, events)` returns the next state and a reason.
3. Behavior: in ACTIVE, `mission_runner.tick(snapshot)` returns a `BehaviorOutput` (motion command, capture requests, outgoing messages).
   In every other state the output is "stop".
4. Safety gate: `safety_gate.filter(state, snapshot, output)` returns the commands that may reach hardware (section 10).
5. Send: `motion.apply(cmd)`, camera capture requests, and enqueue outgoing messages on the bridge client (never blocks).
6. Log: state changes, gate interventions, and a 1 Hz summary line.
7. If the tick finished in time, `sd_notify("WATCHDOG=1")` from the main loop only, then sleep until the next tick with `sleep_until`.

Loop overrun: if one tick takes longer than `loop.overrun_factor` (TBD, start at 2.0) times the period for `loop.overrun_ticks` (TBD, start at 5) ticks in a row, raise the `loop_overrun` event (ACTIVE goes to SAFE_STOP).

Periodic outgoing messages (enqueued in step 5):

| Message | Rate | Content |
| --- | --- | --- |
| `heartbeat` | 1 Hz (`bridge.heartbeat_hz`) | `robot_id`, `state`, `battery_pct` |
| `position` | 1 Hz (`bridge.position_hz`) | from the localizer (section 8) |
| `device` | on every status change, and every 10 s for all devices | `robot_id`, `device`, `status`, `detail` |
| `terrain` | on a class or action change, at most `terrain.report_max_hz` (default 1 Hz), and a keep-alive every `terrain.report_keepalive_s` while moving | section 7b.6 |

The 1 Hz rates match `robot_report_position` ("about once a second") and keep heartbeats well inside the module's 5 s offline rule (`heartbeat_timer`) in `CONTRACTS.md`.
Each `robot_heartbeat` also renews the lease of a `leased` or `active` mission (CONTRACTS.md `mission`), so the robot sends no extra lease messages.
If heartbeats stop for 5 s, the module marks the robot offline and reopens its current cell (`searching` back to `unsearched`); the robot does nothing for that, and on reconnect it sees the cell state through the bridge like any other change.

### 4.4 Camera person detection

Skip the NCS2: OpenVINO 2023.0 dropped it and the last line that supports it has no Python 3.11 bindings, while Debian 12 ships Python 3.11 (`docs/research/perception.md`, [OpenVINO 2023.0 release notes](https://www.intel.com/content/www/us/en/developer/articles/release-notes/openvino/2023-0.html)).
The robot program does not run a camera person detector.
The thermal blob gives the candidate, and the camera still goes to the laptop, where the perception service can run a detector.
A Pi CPU detector is a later fallback behind an `IPersonDetector` interface with a `none` default; do not build it this weekend unless the laptop path fails.
Update 2026-11-08 (Eric): the team has a Coral USB Edge TPU, so `coral` is an optional device in the init order and the vision thread (section 4.2) runs a model on it. What the model detects is open; the thermal path above stays the primary person finder.

## 5. State machine

States, spelled as in `CONTRACTS.md` and `docs/ROBOT.md`: `BOOT`, `INIT`, `READY`, `ACTIVE`, `SAFE_STOP`, `FAULT`, `SHUTDOWN`.

`state_machine.step()` is a pure function: inputs are the current state, a `WorldSnapshot`, and a list of events; outputs are the next state, a reason string, and flags (for example `latched`).
No I/O, no clock reads (time comes in the snapshot), so it is easy to unit test.

Transitions (from `docs/ROBOT.md`; event names are the C++ enum values):

| From | Event or condition | To |
| --- | --- | --- |
| BOOT | `config_valid` | INIT |
| BOOT | `config_invalid` | SHUTDOWN |
| INIT | all required devices OK | READY |
| INIT | a required device FAILED | FAULT |
| READY | `start` (a mission arrived, or `robotctl start`) AND health OK | ACTIVE |
| ACTIVE | `mission_done`, `mission_failed`, `mission_cancelled`, or `stop` | READY |
| ACTIVE | `estop`, `stale_sensor`, `pico_link_lost`, `loop_overrun`, `command_out_of_limits` | SAFE_STOP |
| any | `estop` | SAFE_STOP, latched until `reset` from a human |
| SAFE_STOP | motion stopped AND cause recoverable AND not latched | FAULT |
| SAFE_STOP | `reset` while latched AND e-stop no longer asserted | FAULT (then the normal FAULT path reinitializes) |
| FAULT | retries < `fault.max_retries` (TBD, start at 3): reinit the failed device | INIT |
| FAULT | retries exhausted | SAFE_STOP latched, plus a `device` message with status FAILED and an alert log line |
| any | `sigterm` | SAFE_STOP, then SHUTDOWN after motion is stopped (bounded by `shutdown.timeout_ms`) |

"Health OK" means: every required device OK, Pico heartbeat fresh, no stale required sensor, not latched.

Mission events when not ACTIVE:

- A mission that arrives in READY with health OK starts it.
- A mission that arrives in any other state is rejected with `mission_progress(mission_id, "failed", "robot not ready: <state>")`, so the module can requeue or the coordinator can see it.
  Exception: in ACTIVE with a mission already running, a second mission is rejected the same way; the bridge should not send one (section 9.5).
- If SAFE_STOP interrupts a mission, the mission runner sends `mission_progress(mission_id, "failed", "safe stop: <reason>")`.

`config.missions.auto_start` (TBD, team decision, default true for the demo): if false, a mission waits in READY until a human runs `robotctl start`.

## 6. Mission behaviors (ACTIVE sub-states)

### 6.0 Where missions come from

| Source | How | What the robot sees |
| --- | --- | --- |
| Orchestrator (Nemotron on the laptop) | The orchestrator reads the board (cells, person reports, robot telemetry, terrain, detections) and calls `create_mission` directly; it may `cancel_own_mission` while the mission is `proposed` or `queued` | a leased mission, like any other |
| Coordinator (dashboard) | `create_mission`, `approve_mission`, `cancel_mission` | same |
| Module watchdog | does not create missions (it only proposes rescuers) | nothing |

- If `site.require_mission_approval` is true, agent missions stay `proposed` until a coordinator approves them; the bridge only ever forwards `leased` rows.
- The orchestrator decides inspect or continue at the mission level only; inside a mission, the robot's own state machine and safety gate decide every motion.
- Search order: cells with unaccounted people first, then unsearched and partially searched cells; the orchestrator orders `target_cell_ids`, and the robot searches them in the order given.
- The robot never talks to an agent directly, never reads `agent_task`, and needs no model or API key.

### 6.1 Mission intake and validation

The bridge sends `{"type":"mission","mission":{...}}` with the mission row fields (section 9.4).
`mission.hpp` parses it into:

```
struct Mission {
  uint64_t id;                       // 0 means a local test mission from robotctl
  uint64_t chain_id;                 // 0 for none; logged only, the robot does not act on it
  std::string robot_id;
  MissionKind kind;                  // search_cells | inspect | return_home | hold
  std::vector<uint64_t> target_cell_ids;
  std::optional<double> target_lat, target_lon;
  std::string reason;
};
```

Validation (reject with `mission_progress(id, "failed", "rejected: <why>")`):

- `robot_id` equals `config.robot.robot_id`.
- `kind` is one of the four contract values; unknown kinds are rejected.
- `search_cells` has 1 to `missions.max_cells` (TBD, start at 20) cell ids.
- `inspect` has a target; `return_home` may omit it (then uses `home` from config).
- The target is within `site.radius_m + missions.target_margin_m` of the site center when the site is known, or within `missions.max_target_distance_m` (TBD) of the robot.
- The mission never carries speeds, poses, joint angles, or durations that reach motors.
  Speed and limits come only from the robot's config.

On accept, the runner sends `mission_progress(id, "active", "started <kind>")`.
On finish, `done` or `failed` with a short note.
Local test missions (`id == 0`) send nothing to the bridge.

### 6.2 Shared building blocks

- `GoTo(target)`: there is no autonomous navigation this weekend.
  `GoTo` looks up the nearest scripted path in `demo_paths.yaml` whose `end` waypoint is within `nav.match_radius_m` (TBD, start at 5) of the target, or whose `label` equals the cell label.
  If one matches, it runs `FollowPath`; if none matches, it fails with note `"no scripted path to target"`.
  Real outdoor navigation by GPS (heading from GPS track plus IMU) is a later stretch, behind the same `GoTo` interface.
- `FollowPath(path)`: a path is a list of steps, each one of `drive {vx, vy, wz, seconds}`, `turn_to {heading_deg}`, `stop {seconds}`, or `scan {seconds, mode}`.
  Every step goes through `IMotion`, so it works with the mock, drive-only, or later legged motion.
  The path follower checks the single-point LiDAR: if range < `nav.min_clearance_m` (TBD, start at 0.30), it stops and waits up to `nav.blocked_timeout_s`, then fails the step.
- `Scan(seconds, mode)`: `mode: still` stops and watches, `mode: rotate` turns in place at `scan.rotate_wz_dps` (TBD).
  It runs the thermal detector on every new frame and returns the best confirmed candidate, if any.
- `Inspect(candidate)`: section 6.4.

### 6.3 `search_cells`

Sub-states: `NEXT_CELL -> GO_TO_CELL -> SCAN_CELL -> (INSPECT)* -> MARK_DONE -> NEXT_CELL ... -> DONE`.

1. `NEXT_CELL`: take the next id from `target_cell_ids`.
   If none are left, send `done`.
2. Send `{"type":"cell","cell_id":<id>,"status":"searching"}`.
3. `GO_TO_CELL`: `GoTo(cell)` using the scripted path keyed by the cell id or label in `demo_paths.yaml`.
   If no path exists and `missions.search_without_path` is true (default true), scan from where the robot is (useful for a stationary demo), and record `reached_cell = false` for the coverage check.
4. `SCAN_CELL`: `Scan(scan.seconds_per_cell, scan.mode)` (TBD, start at 10 s, `rotate` with drive-only, `still` otherwise).
   While scanning, the coverage tracker (below) counts how much of the view was clear and how much of the time the thermal data was fresh.
5. For each confirmed candidate not already inspected in this mission (same bearing within `scan.dedupe_deg` and range within `scan.dedupe_m`), run `Inspect` (section 6.4), then resume scanning for the remaining scan time.
6. `MARK_DONE`: send `{"type":"cell","cell_id":<id>,"status":"searched"}` or `"partially_searched"` by the coverage rule below.
7. On cancel: stop motion; if `SCAN_CELL` had started for the current cell, send `partially_searched` for it (some of it was seen, not all); otherwise send nothing; `cancel_mission` in the module already puts the mission's `searching` cells back to `unsearched`
   The runner sends no progress for a cancelled mission (the module already knows).

Coverage rule (keeps "no one is overlooked" honest; a blocked view is never "searched", CONTRACTS.md `search_cell`):

```
fresh_frac   = time with fresh thermal data / scan time
clear_frac   = share of the 15 degree LD19 sectors swept by the thermal field of view whose range exceeded scan.min_view_m at least once
               (only sectors the thermal camera faced; 1.0 if the LD19 is missing, with note "ld19 missing, view not checked")

searched            if reached_cell and fresh_frac >= scan.min_fresh_frac and clear_frac >= scan.min_clear_frac
partially_searched  if fresh_frac > 0 (something was seen)
not marked          otherwise (thermal stale the whole time): mission fails with "thermal stale in cell <id>";
                    the cell keeps its status, and the orchestrator's search list covers it
```

- Start values (TBD, tune on the mock rubble): `scan.min_view_m` 0.5, `scan.min_fresh_frac` 0.9, `scan.min_clear_frac` 0.7.
- A cell scanned from outside (`reached_cell = false`) is at most `partially_searched`, because the robot did not get in.
- Every `partially_searched` message carries a short `note` in the robot's log and in the `cell` message (for example `"view blocked: 40% of sectors under 0.5 m"`); `mark_cell` has no note argument, so the bridge logs the note and does not send it.
- `partially_searched` cells stay in the search queue (CONTRACTS.md), so the orchestrator or a human team comes back to them.
- Upper floors or rooms the robot cannot reach are never marked by the robot at all.

If the robot goes offline while searching a cell, the module reopens that cell (`heartbeat_timer`, CONTRACTS.md); after reconnect, spooled `cell` messages for that cell still replay with their `observed_at`, so a cell that was truly finished before the outage ends up `searched` or `partially_searched` again.

### 6.4 `inspect` (and the inspect step inside a search)

Goal: stop still, confirm the warm blob, capture stills, record the breathing clip, send one detection.
The clip rules come from `docs/research/perception.md`: record 20 s with a 15 s floor, exposure and gain locked, robot still.
The camera is a regular visible-light camera with no IR illuminators, so the clip needs room light or the optional white light (section 12.3); in a dark demo set, the breathing check fails without one.

Sub-states:

1. `APPROACH`: for an `inspect` mission, `GoTo(target)`.
   For a candidate found while scanning, turn toward the blob bearing (section 7.3) and optionally drive closer until the single-point LiDAR reads `inspect.standoff_m` (TBD, start at 1.0) or `inspect.approach_timeout_s` passes.
   With mock motion, this step only updates the fake pose.
2. `SETTLE`: command stop, then wait until the IMU gyro magnitude stays below `inspect.still_gyro_dps` (TBD) for `inspect.settle_s` (TBD, start at 2 s).
   If the IMU is missing, wait `inspect.settle_s` only and add `"imu missing"` to the note.
3. `CONFIRM`: watch the thermal frames for `thermal.confirm_s` (TBD, start at 3 s) while still.
   Confirmed if the blob appears in at least `thermal.confirm_min_frames` of those frames (section 7.2).
   If not confirmed, end with no detection (search continues; an `inspect` mission ends `done` with note `"no warm blob confirmed"`).
4. `STILLS`: save the thermal frame as a false-color PNG (`thermal_render`, nearest-neighbor upscale by `thermal.render_scale`, TBD, start at 10), and one camera still as JPEG.
5. `CLIP`: `light.on()` (if a light exists and `light.use_for_clip` is true), wait `light.warmup_ms`, lock camera controls (section 12.2), then record `breathing.clip_s` (default 20, minimum 15, enforced by config validation) at `camera.clip_fps` (TBD, start at 30) to `<media_dir>/<client_ref>_clip.mp4`.
   During recording the safety gate forces motion to zero (the behavior also commands stop).
   If the IMU shows motion above `inspect.still_gyro_dps` during the clip, keep recording but add `"robot moved during clip"` to the note; perception treats it as low quality.
   If the camera is FAILED or DEGRADED, skip the clip and add `"no clip: camera <status>"` to the note.
6. `REPORT`: enqueue one `detection` message (section 9.3) with the location from the localizer, the blob's `max_temp_c`, the `thermal_confidence` (section 7.4), and the three file paths.
7. Unlock camera controls, `light.off()`, and return to the caller.

An `inspect` mission ends `done` after `REPORT`.

### 6.5 `return_home`

1. Target = `target_lat/lon` if given, else `home.lat/lon` from config (in demo mode, the demo `home` waypoint).
2. `GoTo(target)` using the scripted path that ends at `home`.
3. `done` on arrival, `failed` with the GoTo note otherwise.

### 6.6 `hold`

1. Stop motion, keep sensing and reporting position.
2. The thermal detector keeps running; if `hold.inspect_candidates` (default false) is true, a confirmed candidate runs `Inspect`.
3. Ends only on cancel, or after `hold.max_s` (TBD, default 0 means no limit) with `done`.

## 7. Thermal person detection on the robot

The thermal sensor model is TBD, so the frame width, height, field of view, frame rate, and every threshold come from config.
Use the thermal camera only to find warm, person-sized blobs; thermal breathing at 32x24 or 8x8 is not realistic (`docs/research/perception.md`).
Thermal cannot see through boxes, glass, or rubble, so the demo must leave part of the person in line of sight ([NFCC Pub 6/92](https://nfcc.org.uk/wp-content/uploads/2023/10/Publication-6_92-Detection-Devices-for-Hidden-or-Buried-Casualties.pdf), via `perception.md`).

### 7.1 Per-frame rule (explainable, no learning)

Input: a frame of `w x h` temperatures in degrees C, its timestamp, and the latest single-point LiDAR range (if fresh).

1. Mask: ignore pixels listed in `thermal.mask` (rectangles), for example where the robot's own Pi or motor drivers show up; hot electronics are an expected false positive (`perception.md`).
2. Background: `bg = median(all unmasked pixels)`.
   A per-pixel background model breaks while the robot moves, so use the per-frame median while moving (`perception.md`).
3. Hot pixel: `t >= bg + thermal.delta_c` AND `thermal.min_c <= t <= thermal.max_c`.
   `delta_c` starts at 4.0, the Grid-EYE human detection test condition of at least 4 C above background ([Panasonic Grid-EYE spec](https://api.pim.na.industrial.panasonic.com/file_stream/main/fileversion/8799), via `perception.md`); TBD until the range test.
   `min_c` and `max_c` are placeholders (TBD) that reject very hot objects such as heaters; they are not physiological facts and must be set from the range test.
4. Blobs: 4-connected components of hot pixels with an iterative flood fill (explicit stack).
5. Size check: keep a blob if `area >= thermal.min_blob_px` AND `area <= thermal.max_blob_frac * w * h`.
   If the LiDAR range `r` is fresh and the sensor points the same way as the thermal camera (alignment TBD), also require the blob width in pixels to be at least `thermal.size_tolerance * expected_px(r)`, where `expected_px(r) = degrees(2 * atan(thermal.person_width_m / (2 r))) / (thermal.fov_h_deg / w)`.
   `person_width_m` starts at 0.25, the short side of the 700x250 mm Grid-EYE test target (`perception.md`); TBD.
6. Output per blob: centroid (column, row), area, width, height, `max_temp_c`, `mean_temp_c`, contrast `max_temp_c - bg`.

Geometry note from the research: one MLX90640 55 degree pixel is about 1.7 degrees, so about 3 cm at 1 m and 9 cm at 3 m, and one AMG8833 pixel is about 7.5 degrees, so about 13 cm at 1 m (`docs/research/inspection-robots.md`).
That is why the inspect standoff starts at 1 m.

### 7.2 Confirmation over time

- A candidate is a blob that appears in at least `thermal.persist_frames` (TBD, start at 3) of the last `thermal.persist_window` (TBD, start at 5) frames, with centroids within `thermal.persist_px` (TBD, start at 2) pixels after accounting for robot rotation (ignore rotation in v1; scan with short stops).
- While still (inspect `CONFIRM`), the detector switches to background subtraction: average the first second of frames per pixel, and count a frame as a hit if the blob region stays `delta_c` above that background.
  This follows the stopped-robot recommendation in `perception.md`.

### 7.3 Bearing to the blob

`bearing_offset_deg = (centroid_col + 0.5 - w / 2) * (thermal.fov_h_deg / w)`, positive to the right.
Absolute bearing = `heading_deg + bearing_offset_deg + thermal.yaw_offset_deg` (mounting offset, TBD).
Used to turn toward the blob and to dedupe candidates.

### 7.4 Confidence (0 to 1, for `thermal_confidence`)

```
c_contrast = clamp((contrast - delta_c) / thermal.contrast_full_c, 0, 1)    # contrast_full_c TBD, start at 6
c_size     = size check with LiDAR ? clamp(width_px / expected_px(r), 0, 1) : 0.5
c_persist  = hits / window
thermal_confidence = 0.3 + 0.7 * (0.4 * c_contrast + 0.3 * c_size + 0.3 * c_persist)   # only for confirmed blobs
```

The weights are untuned guesses (TBD).
Log every input to the formula with the detection in the sensor log (section 11), so the team can tune the weights from rehearsal runs.
The detector never claims a blob is a person; it reports a warm, person-sized shape with a confidence.

### 7.5 Range test (needed before any threshold is locked)

Procedure: a teammate lies at 0.5, 1, 2, 3, and 4 m, uncovered, under a thin blanket, and partly behind boxes, lights off.
Record 30 s of thermal frames at each (the sensor log does this automatically), then run `robot_diag thermal --replay <file>` to print blob stats per frame.
Set `delta_c`, `min_blob_px`, `min_c`, `max_c`, `person_width_m`, and `size_tolerance` from the results, and write the table into `docs/ROBOT.md` open questions.
The Grid-EYE output takes about 15 s to stabilize after power-up, so wait before testing if that is the sensor (`perception.md`).

## 7b. Terrain recognition

`docs/MVP.md` lists terrain recognition as a should-have: classify the ground ahead, then slow, steer around, or stop, and log what was seen.
On the robot this is a simple rule-based assessor that runs every loop tick.
Eric owns the terrain work overall; Camille builds the robot-side assessor and interface; Matthew confirms sensor mounting.

### 7b.1 Interface

```
enum class TerrainClass { flat, debris, step, gap, blocked, unknown };   // spelled as in CONTRACTS.md
enum class TerrainAction { kContinue, kSlow, kSteer, kStop };          // wire strings: continue, slow, steer, stop (CONTRACTS.md: kContinue)

struct TerrainAssessment {
  TerrainClass cls;
  TerrainAction action;
  double confidence;            // 0 to 1
  double steer_bearing_deg;     // only for steer: suggested body-relative heading to the clearest sector
  double speed_scale;           // 1.0 for continue, terrain.slow_scale for slow, 0 for stop
  std::string source;           // "lidar_imu_rules", or "lidar_imu_rules+camera_model" when a hint was applied
  std::string reason;           // short text, for example "ld19: 0.08 m rise at 0.4 m ahead"
  bool safety_stop;             // true when a rule asked for stop for safety; nothing can clear it this tick
};

class ITerrainAssessor {
 public:
  virtual TerrainAssessment assess(const WorldSnapshot&) = 0;   // pure on the snapshot, no I/O
  virtual ~ITerrainAssessor() = default;
};
```

Implementations, picked by `terrain.impl`: `rules` (default on the robot) and `mock` (returns a scripted class sequence from config, or `robotctl mock terrain <class>`).

### 7b.2 Inputs

All come from latest-value slots already in the snapshot:

- LD19 scan: the latest revolution, limited to the forward sector `terrain.front_sector_deg` (TBD, start at 60, centered on the direction of travel).
- Single-point LiDAR: range straight ahead, or angled down at the ground if Matthew mounts it that way (mounting TBD, `terrain.lidar_single_mode: forward | down`).
- IMU tilt: pitch and roll from the accelerometer (gravity direction, low-pass `terrain.tilt_lpf_alpha`), plus gyro magnitude for bumpiness.
- Force sensors (optional, off by default): the four FSRs on the ADS1115 are force sensors whose mounting and meaning are TBD; they are not foot pads.
  Do not treat them as ground contact.
  With `terrain.use_force: true`, a rule may only use a configured `terrain.force_rules` entry (for example "channel 2 above X means bumper pressed, class blocked") once Matthew says what each sensor measures.

A missing or stale input is skipped, and the confidence is reduced by `terrain.missing_input_penalty` per missing input.
If every input is missing, the class is `unknown`.

### 7b.3 Rules (checked in this order, first match wins)

Every number is a TBD config value; start values are placeholders to tune on the mock rubble.

1. `blocked`: the LD19 forward sector has any point closer than `terrain.blocked_m` (start at 0.25), or the forward single LiDAR reads closer than that.
   Action `stop` if no side sector is clear; `steer` toward the clearest sector (the 15 degree bin with the largest minimum range) if one has more than `terrain.clear_m` (start at 0.6).
2. `gap`: down-pointing single LiDAR range exceeds `terrain.ground_range_m + terrain.gap_drop_m` (start at 0.05 m drop over the expected ground range).
   Action `stop` (safety stop).
3. Tilt limit: `|pitch| > terrain.max_pitch_deg` or `|roll| > terrain.max_roll_deg` (start at 20) is class `step` with action `stop` (safety stop), because the robot is already on something it may tip off.
4. `step`: down-pointing range shorter than `terrain.ground_range_m - terrain.step_rise_m` (start at 0.04), or the LD19 shows a near, wide return in the forward sector at a range that matches a low obstacle (only if the LD19 is mounted low enough to see it, TBD).
   Action `stop` if the rise exceeds `terrain.max_step_m` (what the robot can cross, TBD from Matthew), otherwise `slow`.
5. `debris`: IMU gyro RMS over the last `terrain.bump_window_s` above `terrain.bump_gyro_dps`, or LD19 forward-sector range variance above `terrain.debris_range_var`.
   Action `slow`.
6. `flat`: none of the above, with at least two inputs fresh.
   Action `continue`.
7. Otherwise `unknown`, action `slow`.

Confidence: start at `terrain.base_confidence` for the matched rule (per class, TBD), minus the missing-input penalty, plus `terrain.agree_bonus` when two independent inputs agree (for example LD19 and single LiDAR both say blocked), clamped to 0 to 1.
Hysteresis: a new class must hold for `terrain.hold_ticks` (start at 5) before it replaces the current one, except `stop` actions, which apply at once.

### 7b.4 How behaviors and the safety gate use it

- Behaviors read `snapshot.terrain` and adjust their own commands: `slow` multiplies speed by `speed_scale`, `steer` rotates toward `steer_bearing_deg` before continuing, `stop` ends the drive step.
  `FollowPath` waits up to `nav.blocked_timeout_s` on `stop`, then fails the step with the terrain reason.
- The safety gate applies terrain independently, so a behavior bug cannot ignore it: if `safety_stop` is true, translation is zeroed (rotation in place stays allowed only for `blocked` with a clear side sector); if the action is `slow`, the gate caps speed at `limits.max_lin_mps * terrain.slow_scale`.
- A terrain stop is not a state machine fault; the robot stays ACTIVE and the behavior decides what to do next.
  Only stale required sensors are faults (section 10).
- When the robot is not moving, terrain is still assessed and logged, but reports go out only on changes.

### 7b.5 Optional camera terrain model (Eric's perception service)

A slot for a camera model, off by default (`terrain.camera_hint.enabled: false`):

- With the hint enabled, the robot saves a downscaled camera frame every `terrain.camera_hint.frame_every_s` (TBD) while moving, to `<media_dir>/terrain_hint.jpg` (written to a temporary file, then renamed, so the bridge never reads half a frame).
- The bridge posts each new frame to the perception service (`POST /terrain`, in CONTRACTS.md "Media server"), which returns a class and confidence (section 9.4).
- The bridge forwards the latest result as `{"type":"terrain_hint","terrain_class":...,"confidence":...,"observed_at":...}` (CONTRACTS.md version 8.1, bridge to robot), where `observed_at` is the time the frame was saved; the C++ bridge client puts it in a latest-value slot, and a newer hint replaces an older one.
- The hint is advisory only.
- A hint whose `observed_at` is older than `terrain.camera_hint.max_age_ms` (configurable, start at 1500) is ignored, so a slow or dead network never matters.
- A hint with an unknown `terrain_class` or a `confidence` outside 0 to 1 is dropped with a log line.
- How a fresh hint is applied: if it agrees with the rule class, confidence goes up by `terrain.camera_hint.weight * hint.confidence`; if it disagrees, confidence goes down by the same amount; if it says `debris`, `step`, `gap`, or `blocked` while the rules say `flat`, the action may become `slow` (more cautious), never anything else.
- It never clears a `safety_stop`, never turns `stop` into anything else, never raises speed, and never loosens the robot's own rules (the rule class, the safety gate, and every limit stay as they are).
- With the hint disabled or missing, the rule assessor works alone.
- Pi CPU camera terrain model: not planned this weekend, same slot if it ever exists.

### 7b.6 Reporting

- Message `{"type":"terrain","robot_id","lat","lon","terrain_class","confidence","source","action","image_path"}` maps to `report_terrain(robot_id, lat, lon, terrain_class, confidence, source, action, image_url, observed_at)`.
- The module keeps only the robot's latest terrain fields (`robot.terrain_class`, `terrain_confidence`, `terrain_source`, `terrain_action`) and writes an `event_log` row of kind `terrain` only when the class changes (CONTRACTS.md version 8); it stores no terrain position or image.
- `image_path` is optional: on a change to `step`, `gap`, or `blocked`, the robot saves the latest camera frame as JPEG in the sensor log `media/` folder; the bridge uploads it (media kind `terrain`) and passes `image_url`, which the module validates but does not store.
- Rate limit in `terrain_reporter`: send on a class or action change (after hysteresis), at most `terrain.report_max_hz` (1 Hz, per the reducer note in `CONTRACTS.md`), plus a keep-alive every `terrain.report_keepalive_s` (TBD, start at 5) while moving.
- Terrain messages go in the `important` queue only for `stop` actions; others go in the `telemetry` queue (drop oldest).
  The bridge spools them like positions.
- The sensor log (section 11) already keeps the raw LD19, IMU, and force sensor data, so Eric can tune the rules and train a model offline from the raw logs and the saved terrain frames (the module keeps no terrain history).

## 8. Location

The localizer produces, every tick: `lat`, `lon`, `gps_fix`, `indoor_offset_m`, `heading_deg`, and a `location_note`.

### 8.1 Modes

| Mode | When | Position |
| --- | --- | --- |
| Demo | `site.demo_mode` is true (section 9.4), or `location.force_demo` in config | Fixed demo coordinates: the current scripted waypoint's `lat/lon` from `demo_paths.yaml`, or `demo.anchor` plus the dead-reckoned local offset |
| GPS | demo mode false and the gpsd fix is fresh with `mode >= 2` | GPS `lat/lon`, `gps_fix = true`, `indoor_offset_m = 0`, and this fix becomes the "last outdoor fix" |
| Indoor | demo mode false and no fresh fix | last outdoor fix plus the dead-reckoned offset since that fix, `gps_fix = false`, `indoor_offset_m` = path length since the fix |
| Unknown | no fix ever and not demo | `lat`, `lon` omitted (null), `gps_fix = false`; a detection still goes out with a `location_note` |

gpsd: connect to `localhost:2947` (gpsd's default TCP port, per the [gpsd man page](https://gpsd.gitlab.io/gpsd/gpsd.html)), send `?WATCH={"enable":true,"json":true};`, and read `TPV` objects; `mode` is 0 unknown, 1 no fix, 2 2D, 3 3D ([gpsd JSON protocol](https://gpsd.gitlab.io/gpsd/gpsd_json.html)).
The gpsd reader runs in its own thread and reconnects with backoff.
The GPS module model and baud rate are TBD; gpsd probes common baud rates itself (`docs/research/platform.md`).
GPS is about 2.5 m open-sky accuracy and has no fix indoors (`platform.md`).

### 8.2 Dead reckoning (v1)

- Heading: integrate IMU gyro z (sign and axis TBD per IMU mounting), plus `heading.initial_deg` from config or the GPS track when moving outdoors faster than `heading.gps_min_speed_mps`.
  If the IMU is missing, integrate commanded `wz` from the motion layer (marked low quality in the note).
- Distance: integrate the commanded body velocity from `IMotion` (wheel encoders are not in the inventory, TBD), scaled by `odometry.scale` (TBD, calibrate by driving 2 m on the floor).
  Mecanum wheels slip, most of all when strafing and on loose debris, so expect this offset to drift; treat it as rough and say so in the location note.
- Offset to lat/lon: equirectangular approximation `dlat = dn / 111320`, `dlon = de / (111320 * cos(lat))`, fine at the 0.3 mile site scale (see the equirectangular section at [Movable Type](https://www.movable-type.co.uk/scripts/latlong.html)).
- LiDAR scan matching from the LD19 is a stretch goal and is not in v1.

### 8.3 Location note

Built as text for rescuers, at most 80 characters, for example `"house 3, 6 m from entry, bearing 40"` from the current waypoint label, the path length since the last waypoint, and the blob bearing.
In indoor mode: `"6 m from last GPS fix, low accuracy"`.

### 8.4 Demo coordinates

The demo site's coordinates live in a config file in `backend/sim/` (`CONTRACTS.md`).
`demo_paths.yaml` must use the same coordinates for `home`, `anchor`, and each house waypoint.
Add a small script in `backend/sim/` (owned by `demo.md`) or copy by hand, and check them together before the demo.

## 9. Bridge (`raspberrypi/bridge/`)

### 9.1 Job

- Holds the one SpacetimeDB connection for the robot, with the robot's own identity and the `robot` role, through the official TypeScript SDK (`spacetimedb` on npm) and the generated bindings.
  SpacetimeDB has no standalone C++ client (official clients are Rust, C#, TypeScript, and Unreal, `docs/PROJECT.md`), which is why the bridge exists.
- Listens on the Unix socket from `CONTRACTS.md` and accepts one C++ client at a time (a new client replaces the old one).
- Maps each local message to a reducer.
- Uploads media files to the media server and passes URLs to `report_detection`; posts the breathing clip to `/breathing` (section 9.6).
- Leases missions with `claim_next_mission` and forwards them as `mission` messages.
- Forwards cancellations as `cancel` messages and site changes as `site` messages.
- Spools messages to a file when SpacetimeDB is unreachable, and replays them in order on reconnect.
- Never sends anything to the robot except `mission`, `cancel`, `site`, and the optional advisory `terrain_hint`.
- Never reads the `agent_task` board and never calls a model.

### 9.2 Connection

From the [SpacetimeDB TypeScript client docs](https://spacetimedb.com/docs/clients/typescript); `withAutomaticReconnect` is present in the 2.14.1 package (checked in the npm tarball on 2026-11-07, behavior UNCONFIRMED until tested):

```ts
import { DbConnection, tables } from '../../../backend/spacetimedb-bindings';

const conn = DbConnection.builder()
  .withUri(env.STDB_URI)            // ws://localhost:3000 local, or https://maincloud.spacetimedb.com
  .withDatabaseName(env.STDB_DATABASE)    // assess-0hw81 (spacetimedb.md section 1.4)
  .withToken(loadToken())           // undefined on first run creates a new identity
  .onConnect((conn, identity, token) => { saveToken(token); onConnected(conn, identity); })
  .onConnectError((_ctx, err) => scheduleReconnect(err))
  .onDisconnect((_ctx, err) => markOffline(err))
  .withAutomaticReconnect()
  .build();
```

- Identity: the token file is the robot's identity.
  `BRIDGE_TOKEN_FILE` (default `/var/lib/robot/bridge/token`, laptop `./.data/token`), mode 0600, git-ignored.
  Tokens are per server, so keep separate files for Maincloud and the local fallback (`spacetimedb.md` section 11).
- Role: after connect, call `registerParticipant({ name: env.ROBOT_ID, role: 'robot' })` once; `participant.name` must equal `robot_id` (CONTRACTS.md conventions).
  Outside demo mode the robot role needs a prior `grant_role` from a coordinator (CONTRACTS.md reducer table), so print the identity hex at startup for the coordinator to grant.
- The `robot` row is created by the first `robot_heartbeat` (CONTRACTS.md `robot`).
- Subscriptions (SQL strings, string filters only, per `spacetimedb.md` section 11): `SELECT * FROM mission WHERE robot_id = '<id>'`, `SELECT * FROM mission WHERE robot_id = ''` (any-robot missions), `SELECT * FROM robot WHERE robot_id = '<id>'`, `SELECT * FROM detection WHERE robot_id = '<id>'` (learn `survivor_id` for the breathing upload), `SELECT * FROM site`, and `SELECT * FROM search_cell` (labels for location notes).
- Reducer calls use the generated camelCase names (`conn.reducers.robotHeartbeat({...})`); check `backend/spacetimedb-bindings/` for exact spellings.
  A rejected reducer throws a `SenderError`; log it and do not retry a rejection (only retry network failures).
- Reconnect: rely on `withAutomaticReconnect()`; also run our own backoff loop (1 s, 2 s, 4 s, max 30 s) for the first connect and for any case where the SDK gives up.
  `connected` is a boolean the rest of the bridge reads.
- When the connection drops, the module's `client_disconnected` marks the participant offline, and the 5 s `heartbeat_timer` marks the robot offline and reopens its current cell; the bridge does nothing extra.
- `.env.example`: `STDB_URI`, `STDB_DATABASE`, `ROBOT_ID=dog1`, `BRIDGE_SOCKET=/run/robot/bridge.sock`, `MEDIA_URL`, `BRIDGE_TOKEN_FILE`, `SPOOL_FILE=/var/lib/robot/bridge/spool.jsonl`, `CLAIM_INTERVAL_MS=2000`, `STDB_MODE=sdk` (`sdk` or `http`, section 9.10).

### 9.3 Local messages, robot to bridge

One JSON object per line.
Field names match reducer arguments (`CONTRACTS.md`).
Every message also carries `observed_at` (ISO 8601 UTC from the robot's wall clock) and `seq` (u64, increasing per boot).
The bridge passes `observed_at` to every robot reducer (CONTRACTS.md conventions: robot reducers accept an optional `observed_at`), and strips `seq`.

| `type` | Fields | Reducer |
| --- | --- | --- |
| `heartbeat` | `robot_id`, `state`, `battery_pct` (null until a battery monitor exists, TBD) | `robot_heartbeat(robot_id, state, battery_pct, observed_at)`; also renews the mission lease |
| `position` | `robot_id`, `lat`, `lon`, `gps_fix`, `indoor_offset_m`, `heading_deg` | `robot_report_position(...)` |
| `device` | `robot_id`, `device`, `status`, `detail` | `robot_report_device(...)` |
| `cell` | `cell_id`, `status` (`searching`, `searched`, `partially_searched`), `note` (logged by the bridge only) | `mark_cell(cell_id, status, observed_at)` |
| `mission_progress` | `mission_id`, `status` (`active`, `done`, `failed`), `note` | `mission_progress(...)` |
| `detection` | `robot_id`, `mission_id`, `source` (`thermal` or `camera`), `client_ref`, `lat`, `lon`, `gps_fix`, `location_note`, `max_temp_c`, `thermal_confidence`, `thermal_image_path`, `camera_image_path`, `breathing_clip_path`, `thermal_debug` (object, logged only) | upload files, then `report_detection(...)` with `thermal_image_url`, `camera_image_url`, `breathing_clip_url` |
| `terrain` | `robot_id`, `lat`, `lon`, `terrain_class`, `confidence`, `source`, `action`, `image_path` (optional) | upload the image if any, then `report_terrain(...)` with `image_url` |

`report_detection` arguments: the `detection` columns minus `id`, `run_id`, `survivor_id` (all set by the module) and `created_at`, plus the optional `observed_at`, in the order `spacetimedb.md` defines: `report_detection(robot_id, mission_id, source, client_ref, lat, lon, gps_fix, location_note, max_temp_c, thermal_confidence, thermal_image_url, camera_image_url, breathing_clip_url, observed_at)`.
The module also fills `chain_id` on the detection row from the survivor's chain.

Device names (`device` field): `maestro_a`, `maestro_b`, `dc_driver_a`, `dc_driver_b`, `pico`, `camera`, `imu`, `thermal`, `ads1115`, `lidar_single`, `ld19`, `gps`, `light`.
These extend the contract examples (`"thermal"`, `"camera"`, `"ld19"`, `"gps"`) with the same spelling style.

`client_ref` is a robot-made unique string (`<robot_id>-<boot_id>-<seq>`), used to name media files and to find the detection row later (CONTRACTS.md `detection.client_ref`).
Mission id 0 (local test) messages are logged by the bridge and not sent to SpacetimeDB.

### 9.4 Local messages, bridge to robot

- `{"type":"mission","mission":{...}}`: every mission row field, with `to_wire.ts` converting u64 `bigint` to JSON number (ids stay below 2^53), tagged enums to their string value, optionals to `null`, and Timestamps to ISO strings.
- `{"type":"cancel","mission_id":<id>}`.
- `{"type":"site","demo_mode":true|false,"site":{"id","center_lat","center_lon","radius_m"}}`, sent on connect and on change (CONTRACTS.md).
  Before the first one arrives, the robot uses `site.demo_mode_default` and `site.center_*` from its config.
- Optional: `{"type":"terrain_hint","terrain_class":...,"confidence":...,"observed_at":...}` (CONTRACTS.md version 8.1; section 7b.5), advisory only.
  The bridge forwards it as follows:
  1. Every second, if `<media_dir>/terrain_hint.jpg` exists and is newer than the last frame it posted, the bridge posts it to `POST {MEDIA_URL}/terrain` (multipart `file`, plus `robot_id`, `rule_class` from the latest `terrain` message, and `observed_at` from the file's modification time).
  2. On a `200` response `{"terrain_class","confidence","observed_at"}`, the bridge sends one `terrain_hint` line to the robot with those three fields.
  3. On an error, a timeout (1 s), or no C++ client, it sends nothing; it never retries or spools hints, because an old hint is useless.
  The bridge does not change the hint and never calls `report_terrain` with it.

The C++ parser ignores unknown `type` values with a log line, so new bridge messages cannot break the robot.

### 9.5 Mission leasing

- The bridge tracks `robotState` from the latest `heartbeat` and `currentMissionId` (the last mission it forwarded that has not reached `done`, `failed`, or `cancelled`).
- Every `CLAIM_INTERVAL_MS`, if connected, `robotState === "READY"`, no current mission, and the C++ client is connected, call `claim_next_mission(robot_id)`.
- When the subscription shows a `mission` row for this robot change to `leased`, forward it once (dedupe by id).
- When the robot sends `mission_progress` `active`, the module moves the mission to `active`.
- When a mission row for this robot changes to `cancelled` (a coordinator's `cancel_mission`, or the orchestrator's `cancel_own_mission` before it was leased), forward `cancel`.
- Lease renewal: each `robot_heartbeat` renews the lease of the robot's `leased` or `active` mission (CONTRACTS.md `mission`), so the bridge sends nothing extra.
- If the C++ client disconnects, the bridge stops forwarding heartbeats, the lease expires (`lease_timer`), and the module puts the mission back to `queued`.

### 9.6 Media and breathing

For each `detection` message:

1. Upload each non-null file path with `POST {MEDIA_URL}/media` (multipart, field `file`, plus form fields `run_id` if known, `robot_id`, `kind` = `thermal`, `camera`, or `clip`), using Node 22's built-in `fetch`, `FormData`, and `fs.openAsBlob`.
   Retry with backoff (1, 2, 4, 8 s), at most `MEDIA_RETRIES` (default 5).
2. Call `report_detection` with the returned URLs and `client_ref`.
   If an upload still fails, call `report_detection` with that URL as none (location matters more than images), and keep the file for `upload-logs`.
3. Find the survivor exactly: wait (up to 10 s) in the subscription cache for the `detection` row with this `client_ref`, and read its `survivor_id` (set by the module when it creates or merges the survivor).
   `survivor_id = 0` means the module stored the detection without a survivor (for example below its confidence floor); log it and keep the clip.
4. If a clip exists and `survivor_id != 0`, `POST {MEDIA_URL}/breathing` with `clip_url` (the URL from step 1, so the clip is not uploaded twice), `survivor_id`, and `detection_id` (CONTRACTS.md "Media server").

### 9.7 Spool (network or SpacetimeDB down)

Required by `CONTRACTS.md` "Recording and replay": the bridge spools to a local file on the Pi when the network is down and sends in order on reconnect.

- File: `SPOOL_FILE`, append-only JSON lines, each `{seq, observed_at, msg}`, `fsync` after each detection, cell, and mission_progress.
- What is spooled while disconnected:
  - `detection`, `cell`, `mission_progress`, `device`: always.
  - `position`: only the newest one is sent on reconnect, because positions are current state only (the module keeps no track).
  - `heartbeat`: not spooled (stale liveness has no meaning); the first live heartbeat after reconnect is enough.
- Replay: on reconnect, before any live message, send spooled entries in file order, one reducer call at a time, awaiting each, each with its original `observed_at`, so `detection` rows and robot events keep the original times (CONTRACTS.md conventions).
  A rejected reducer (for example a cell already searched) is logged and skipped, not retried.
  After the file is fully replayed, truncate it.
  Live messages that arrive during replay are appended to the spool, so order is kept.
- Cap: `SPOOL_MAX_MB` (default 50); past the cap drop `position` entries first, never detections.

### 9.8 Bridge tests

- `mapping.test.ts`: every local message type produces the right reducer name and argument object, with `observed_at` passed through; unknown types are rejected.
- `to_wire.test.ts`: bigint, optional, enum, Timestamp conversion.
- `spool.test.ts`: append, crash-safe reopen, ordered replay with original `observed_at`, rejection skip, cap behavior.
- `survivor_lookup.test.ts`: the `client_ref` lookup finds the `survivor_id`; `0` skips `/breathing`.

### 9.9 Mission source check (orchestrator)

To prove the agent path end to end without the robot, run the bridge with the C++ program in laptop mode, create the mission as the orchestrator, and check that the mission arrives as `leased`, then `active`, then `done`.
The bridge treats an agent mission exactly like a coordinator mission; nothing in the bridge knows which agent made it.

### 9.10 Option to test first: direct HTTP reducer calls

CONTRACTS.md lists this as an option to test, not rely on: the robot could call reducers directly through SpacetimeDB's HTTP API and skip the Node.js bridge.

- API (tested on a local server by the module spec, `spacetimedb.md` section 0; docs: [HTTP database API](https://spacetimedb.com/docs/http/database), [HTTP identity API](https://spacetimedb.com/docs/http/identity)): `POST /v1/identity` returns `{"identity","token"}`; `POST /v1/database/<db>/call/<reducer>` with header `Authorization: Bearer <token>` and a JSON array of positional arguments; enums as `{"<variant>":[]}`, options as `{"some":x}` or `{"none":[]}`; a failed reducer returns HTTP 530 with the `SenderError` text.
- `tools/http_reducer_test.sh`: creates or loads a token, calls `register_participant` and then `robot_heartbeat` and `robot_report_position` with `curl`, and prints the HTTP status and timing.
- What HTTP cannot do: it has no subscriptions, so missions, cancels, and site changes would need polling (`POST /v1/database/<db>/sql`), and nothing pushes to the robot.
  So the bridge stays the plan; `STDB_MODE=http` in the bridge is a test switch that sends writes over HTTP while keeping the SDK subscription, only to compare latency.
- Do not build an HTTP client into the C++ program unless the team decides to drop the bridge after this test.

## 10. Safety

### 10.1 Safety gate (pure function)

`SafetyGate::filter(state, snapshot, BehaviorOutput) -> GatedOutput`:

- State not ACTIVE: motion zero (`MotionCommand::stop()`).
- E-stop asserted or latched: motion zero.
- Pico heartbeat age > `pico.link_timeout_ms` (from `docs/ROBOT.md`, about 250 ms, TBD): motion zero and raise `pico_link_lost`.
- Any required sensor older than its `stale_ms` (per device in config): motion zero and raise `stale_sensor`.
- Clip recording in progress: motion zero.
- Terrain (section 7b.4): `safety_stop` zeroes translation; `slow` caps speed at `limits.max_lin_mps * terrain.slow_scale`.
  A camera terrain hint can never clear a terrain stop.
- Clamp: `|vx|, |vy| <= limits.max_lin_mps`, `|wz| <= limits.max_ang_dps`, acceleration limited by `limits.max_lin_accel` and `limits.max_ang_accel` (all TBD).
  A command beyond `limits.reject_factor` times the limit (for example NaN or huge values from a bug) raises `command_out_of_limits` instead of being clamped.
- Leg moves (stretch): clamp every joint to `servos.<channel>.min_us/max_us`, rate-limit with `servos.max_rate_us_per_s` (all TBD), reject unreachable IK targets, and zero translation while a leg is lifted (section 12.5).
- Every intervention is counted and logged once per second, not every tick.

### 10.2 What keeps working when the network, bridge, or SpacetimeDB is down

- The C++ program never waits on the bridge.
  `BridgeClient` keeps two bounded queues: `telemetry` (heartbeat, position, device; capacity 64, drop oldest) and `important` (detection, cell, mission_progress; capacity 256, drop oldest with an error log).
  Writes are non-blocking; a partial write keeps the rest of the line for the next poll.
  It reconnects with backoff (0.5 s doubling to 5 s).
- If the bridge is gone, `important` messages are also appended to `/var/lib/robot/outbox.jsonl` and replayed to the bridge on reconnect, so a bridge crash does not lose detections (the bridge spool covers SpacetimeDB outages; this covers bridge outages).
- Policy on link loss during a mission: `missions.on_bridge_loss` (TBD, default `finish_step_then_hold`): finish the current sub-step (a running clip finishes), then stop motion and keep sensing, as in `docs/research/platform.md` ("finishes or holds its current safe behavior and does not start new moves").
  No new mission starts while the bridge is down.
- A lost network does not change the state machine; it is not a safety event.

### 10.3 The agent can never command motors

- The local protocol has no motion message.
- Missions come from the orchestrator or a coordinator through SpacetimeDB (section 6.0); the robot accepts only mission kinds from the contract and validates targets (section 6.1).
- An agent's only levers are `create_mission` and `cancel_own_mission`; the orchestrator cannot change a mission once leased, and no agent can reset an e-stop.
- Speeds, accelerations, and joint limits come only from the robot's config, never from a mission.
- Cancel can only make the robot stop or end a mission.
- E-stop reset is only possible locally (`robotctl reset` on the Pi, or a physical button, TBD), never from SpacetimeDB.

### 10.4 E-stop (from `docs/ROBOT.md`)

- Physical e-stop cuts actuator power only; the Pi and Pico stay up.
- Software sensing of the e-stop is TBD: the program can only know if a sense line exists (for example a divider from the actuator rail to a free Pico GPIO or ADC input).
  `estop.sense` in config: `none` (default), or a Pico input id once wired.
  With `none`, the physical e-stop still cuts power, and the program sees DC driver or Maestro errors and the operator runs `robotctl estop`.
- Software e-stop: `robotctl estop` sends `estop` on the control socket and latches SAFE_STOP.
- Reset: `robotctl reset` clears the latch only if the sense line (if any) reads released; then SAFE_STOP goes to FAULT and through reinit.
- SAFE_STOP physical behavior is TBD (hold pose, sit, or cut torque).
  Drive-only: motors commanded to zero.
  Servos: `safe_stop.servo_action` (TBD: `hold` keeps last targets, `release` sends target 0, which stops pulses per the [Maestro docs](https://www.pololu.com/docs/0J40/5.e)).

### 10.5 Watchdogs (from `docs/ROBOT.md`)

- systemd: `WatchdogSec=` in `robot.service`, `WATCHDOG=1` from the main loop only, after a tick completes in time.
- OS: `RuntimeWatchdogSec=` in `/etc/systemd/system.conf` (value TBD).
- Device timeouts: enable the Maestro serial timeout if the model supports it (TBD per model; check Maestro Control Center serial settings).
  The DC drivers have none, and `pigpiod` keeps the last duty after the program dies, so `robot.service` sets all 8 motor GPIOs to duty 0 in `ExecStartPre=` and `ExecStopPost=`.
- Pico: `watchdog_enable()` at boot, feed once per superloop; the Pico stops its own outputs (none today) if the Pi heartbeat is lost.

## 11. Raw sensor logs on the SD card

Required by `CONTRACTS.md` "Recording and replay": the robot keeps raw sensor logs for later upload.

- Folder: `recorder.dir` (Pi `/var/lib/robot/logs`, laptop `/tmp/robot/logs`), one subfolder per boot: `<UTC start time>_<boot_id>/`.
- Files:
  - `thermal.bin`: every thermal frame, records of `{u64 t_unix_us, u16 w, u16 h, int16[w*h] centi_deg_c}`, little-endian.
  - `ld19.bin`: every LD19 revolution, `{u64 t_unix_us, u16 n, n x (u16 angle_cdeg, u16 dist_mm, u8 intensity)}`.
  - `imu.csv`, `lidar_single.csv`, `force.csv` at their native rates (or decimated, `recorder.decimate`).
  - `messages.jsonl`: every local protocol message sent and received.
  - `media/`: stills and clips (the same files the detections reference).
  - `manifest.json`: written at start and updated every minute: robot_id, boot_id, config hash, file list with sizes and time ranges.
- Writes happen in the sensor log thread with a bounded queue; when the queue is full, drop frames and count them (the main loop never blocks on disk).
- Disk cap: `recorder.max_gb` (TBD, start at 8); delete the oldest boot folders first, never the current one.
- Upload step: `npm run upload-logs -- --dir <folder>` in the bridge uploads every file in a boot folder to `POST /media`, then uploads a `manifest_uploaded.json` listing name to URL.
  It runs by hand after a run (on the Pi or after copying the SD card).
  The media server groups them by `run_id`, `robot_id`, and `kind = log` (CONTRACTS.md "Media server").
- The module keeps no position history, so this sensor log is the only record of the robot's path; the robot still sends positions at 1 Hz for the live map.

## 12. Devices

### 12.1 Pico link (`protocol/pico_link.h`, PROPOSED)

Status 2026-11-08 (Camille): the flashed firmware (`pico/`, 0.9) speaks text lines, not these frames, and `pico_link_serial.cpp` reads them through `hal/pico_text_protocol.*` (formats in `pico/README.md`).
Until the firmware sends HEARTBEAT, any line from the Pico counts as its heartbeat; it streams at 50 Hz or more, so `pico.link_timeout_ms` still catches a lost Pico.
The handshake is `PING` / `PONG <version>` (must equal `pico.firmware_version`), then `STATUS` for the per-sensor states, then `STREAM 1`.
Proposed contract change: keep the text lines, or move both sides to the frames below; only the parser and the firmware change either way.

Frame (from `docs/ROBOT.md`): `[0xAA 0x55][type u8][dev u8][len u16 LE][payload][crc16 LE]`.

- CRC: CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final xor) over `type`, `dev`, `len`, and `payload` (PROPOSED; both sides use the same function from the header).
- Max payload 4096 bytes.
- On bad CRC or bad length: drop, count, resync on the next `0xAA 0x55`.
  Error rate above `pico.max_crc_errors_per_s` (TBD) is a fault (`pico` DEGRADED, then FAILED).
- Little-endian everywhere.

Message types (values PROPOSED): `HELLO=0x01` (Pi to Pico, `u16 protocol_version`), `VERSION=0x02` (Pico to Pi, `u16 protocol_version`, `char fw[32]`), `INIT_DEV=0x10` (`dev`), `DEV_STATUS=0x11` (`u8 status`, `char detail[]`), `DATA=0x20`, `HEARTBEAT=0x30` (`u32 seq`), `ERROR=0x7F` (`u16 code`, `char msg[]`).

Device ids (PROPOSED): `IMU=1`, `THERMAL=2`, `ADS1115=3`, `LIDAR_SINGLE=4`, `LD19=5`, `GPS_PIO=6` (reserved for the GPS fallback), `ESTOP_SENSE=7` (reserved).

`DATA` payloads, each starting with `u64 t_us` (Pico time since boot):

- IMU: `f32 ax, ay, az` (m/s^2), `f32 gx, gy, gz` (deg/s).
  Axes depend on the IMU model and mounting (TBD).
- THERMAL: `u8 w, u8 h, int16 centi_deg_c[w*h]`, row-major.
  The Pico does the sensor's own calibration math (for an MLX90640 that is the vendor library); the Pi gets temperatures.
- ADS1115: `i16 raw[4]` (A0 to A3, the four FSR force sensors; mounting, meaning, and scaling TBD).
- LIDAR_SINGLE: `u16 dist_mm, u16 strength`.
- LD19: `u16 n`, then `n x (u16 angle_cdeg, u16 dist_mm, u8 intensity)`, one batch per revolution (from `docs/ROBOT.md`); verify the LD19 packet format against its datasheet before writing the parser.

Heartbeat both ways at `pico.heartbeat_hz` (about 20 Hz); missing longer than `pico.link_timeout_ms` (about 250 ms) is link lost (both values from `docs/ROBOT.md`, tune).
On the Pi, the Pico clock is mapped to Pi steady time with the offset from the latest heartbeat round trip; slots store Pi time.
The protocol version constant lives in `pico_link.h`; bump it on any change.

### 12.2 Camera (regular visible-light camera, libcamera)

- Real implementation uses the libcamera C++ API ([libcamera application developer guide](https://libcamera.org/guides/application-developer.html)): `CameraManager`, one camera, one `VideoRecording`-role stream at `camera.width x camera.height` (TBD, start at 640x480) in a YUV format, requests re-queued in the completion callback.
- The camera thread copies the Y plane (grayscale is enough for the breathing motion signal) into the latest frame slot.
  It is a regular camera, not NoIR, so it needs visible light.
- Still: encode the latest Y plane as JPEG with `stb_image_write`.
- Clip lock: before recording, read the current auto exposure and gain, then set `AeEnable=false`, `ExposureTime=<locked>`, `AnalogueGain=<locked>`, and `AwbEnable=false` with fixed colour gains; restore auto after.
  Locking exposure, gain, and white balance stops auto modes from creating a fake periodic signal (`perception.md`; `rpicam-vid` exposes the same options per the [Raspberry Pi camera docs](https://www.raspberrypi.com/documentation/computers/camera_software.html)).
  Check the exact control names in the installed libcamera headers (`libcamera/control_ids.h`).
- Clip writer: spawns `ffmpeg -f rawvideo -pix_fmt gray -s <w>x<h> -r <fps> -i - -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p <file>.mp4` and writes Y planes to its stdin from its own thread.
  The clip format is MP4 (H.264) per CONTRACTS.md, which `perception.md` reads.
- Frame rate at the chosen resolution, and whether 30 fps holds on the Pi 4 while encoding, are TBD (measure in bring-up).
- Mock: generates a gray gradient plus a rectangle whose brightness varies with a 0.25 Hz sine (a fake 15 breaths per minute), so the perception service has something to analyze end to end.

### 12.3 Optional white light

There are no IR illuminators, and the camera needs visible light.
The robot has no light in the inventory, so the light is TBD, behind `ILight` (`init`, `on`, `off`, `status`) with a mock.
Cheap options: a small white LED panel or strip switched by a logic-level MOSFET from a spare Maestro channel set as a digital output (targets of 6000 or more drive it high, per the [Maestro serial command docs](https://www.pololu.com/docs/0J40/5.e)), or a USB LED light switched by hand and left on (`light.impl: manual`, `on()` is a no-op).
Steady light matters more than bright light: flicker or changing light creates a fake periodic signal in the breathing clip (`perception.md` lists illuminator flicker as a risk).

### 12.4 Motion

Drivetrain (Cayden, 2026-11-07): 4 mecanum wheels driven by the 4 DC motors, mounted on legs; the servos move the legs with inverse kinematics.
Plan: wheels first (drive with the legs held at one stance), legs as a stretch.
All motion is behind `IMotion`:

```
struct MotionCommand { double vx_mps; double vy_mps; double wz_dps; bool stop; };   // vx forward, vy left, wz counterclockwise
struct MotionCaps { bool can_translate; bool can_strafe; bool can_rotate; bool can_step; };
class IMotion {
 public:
  virtual DeviceStatus init() = 0;
  virtual MotionCaps caps() const = 0;
  virtual void apply(const MotionCommand&) = 0;   // called only by the main loop after the gate
  virtual void stop() = 0;                        // immediate zero, safe to call any time
  virtual ~IMotion() = default;
};
```

Implementations, picked by `motion.impl`:

- `mock`: integrates the command into a fake pose (used by the localizer in laptop runs).
- `drive_only` (first real target): mecanum drive through the 4 DC motors, legs not commanded (or held at `legs.stance_height_m` by `ILegIK` if the Maestros are up).
  Inverse kinematics of a four mecanum wheel platform ([Taheri, Qiao, Ghaeminezhad 2015, eq. 20](https://research.ijcaonline.org/volume113/number3/pxc3901586.pdf)):

  ```
  w1 = (vx - vy - (lx + ly) * wz) / r
  w2 = (vx + vy + (lx + ly) * wz) / r
  w3 = (vx + vy - (lx + ly) * wz) / r
  w4 = (vx - vy + (lx + ly) * wz) / r
  ```

  `lx` is half the left-right wheel spacing, `ly` half the front-back spacing, `r` the wheel radius, `wz` in rad/s.
  Which physical wheel is 1 to 4 (the paper's figure), the roller orientation, motor directions, and the three dimensions are TBD (`motion.mecanum.*`); with legs, `lx` and `ly` change with stance, so they come from the current stance.
  Check the mapping on the floor: pure `vx` must drive straight, pure `vy` must strafe, pure `wz` must spin in place, and fix wrong ones with `wheel_order` and `invert`.
  Scale: divide all four by the largest absolute value if any exceeds `motion.mecanum.max_wheel_rad_s`, so the direction is kept; then map to the driver command range (A: wheels on motors 1 and 2, B: motors 3 and 4, mapping TBD).
- `legged` (stretch): wheels as above plus leg moves through `ILegIK` (section 12.5), for example raising stance to clear debris or lifting one leg to step.
  Reports DEGRADED until Matthew confirms the leg geometry and servo map.

DC driver: two dual H-bridge modules driven by GPIO PWM through `pigpiod`, two PWM inputs (IN1/IN2) per motor (bench-tested 2026-11-08; pins and wheel map in `docs/ROBOT.md`, "Pi 4B GPIO").
Wheel encoders are not in the inventory (TBD).
`dc_driver_gpio.cpp` drives them through `IGpio` (pigpiod); it reports FAILED with the reason when pigpio is not built in or `pigpiod` is not running, and sets every motor pin to 0 at init and on destruction.
`motion.mecanum.wheel_order` and `invert` hold the wiring from the bench (`[1, 3, 4, 2]`, left side inverted); the floor check below confirms them.
`dc_driver_mock.cpp` records the last command per channel for tests.

Maestro: compact protocol Set Target is `0x84, channel, target & 0x7F, (target >> 7) & 0x7F`, with the target in quarter-microseconds ([Maestro serial commands](https://www.pololu.com/docs/0J40/5.e)).
Baud rate, channel map, and limits are TBD in config; the Maestros must be switched to UART mode first (`docs/ROBOT.md`).
With `drive_only`, the Maestros are optional devices.

### 12.5 Leg IK (stretch)

`docs/ROBOT.md` confirms IK, not reinforcement learning, and no URDF dependency.
All geometry is TBD from Matthew: how many servos per leg (the photo shows 4x 45 kg servos, the 25 kg count is unknown), link lengths, joint axes, zero offsets, directions, and limits.

```
struct LegTarget { double x_m; double z_m; };               // foot or wheel hub position in the leg's own plane, relative to the hip
struct JointTargets { std::vector<double> us; };           // Maestro pulse widths for this leg's channels
class ILegIK {
 public:
  virtual bool solve(int leg, const LegTarget&, JointTargets& out) = 0;   // false if unreachable; never throws
  virtual bool stance(double height_m, std::array<JointTargets, 4>& out) = 0;
  virtual bool lift(int leg, double lift_m, std::array<JointTargets, 4>& out) = 0;  // lift one leg, others hold stance
  virtual ~ILegIK() = default;
};
```

- `leg_ik_mock`: records requests, returns fixed pulse widths, used in tests and laptop runs.
- `leg_ik_2link` (written 2026-11-08): planar two-link IK (law of cosines) for hip and knee with `legs.l1_m`, `legs.l2_m`, `legs.knee_bend`, and one calibration per servo in `legs.joints.<LEG>_<joint>` (`zero_us`, `us_per_rad`, `direction`, `min_us`, `max_us`, from `robot_diag legcal`). Abduction holds 0 for now.
  Angle 0 is the Rubble Dog assembly pose (femur down, tibia in line). The interface is `solve(LegRequest, targets)`; it returns false, and nothing moves, while any joint is uncalibrated.
- Every output goes through the safety gate: clamp each channel to `servos.<ch>.min_us/max_us`, rate-limit to `servos.max_rate_us_per_s`, and reject (do not clamp) unreachable targets.
- Behaviors ask for leg moves as commands (`LegCommand { stance_height_m; lift_leg; lift_m; }`), never pulse widths.
- Terrain use (later): `step` with a small rise could raise stance; `debris` could raise stance and slow.
  Not in v1.
- While a leg is lifted, translation is zero (the gate enforces it), because a lifted mecanum wheel changes the drive kinematics.

### 12.6 GPS

See section 8.1.
`gps_gpsd` connects over TCP, so the program does not depend on `libgps` versions.

## 13. Pico firmware (`pico/`)

Design is in `docs/ROBOT.md`; summary of what the firmware must do:

- Pico C SDK, superloop on core 0, each device task a non-blocking `poll()` driven by timers and UART IRQ ring buffers.
  Core 1 optional (for example LD19 parsing).
  No FreeRTOS unless the team picks it.
- `watchdog_enable()` at boot, feed once per loop.
- USB CDC serial to the Pi, framing and CRC from `protocol/pico_link.h`.
- Answer `HELLO` with `VERSION`; answer `INIT_DEV` with `DEV_STATUS` after trying the device.
- Heartbeat at about 20 Hz; if the Pi heartbeat is lost, keep streaming but flag it (the Pico drives no actuators today).
- Tasks and buses (pin map PROPOSED in `docs/ROBOT.md`): LD19 on UART0 at 230400, single-point LiDAR on UART1 at 115200 default, thermal on I2C0 alone, IMU and ADS1115 (0x48) on I2C1.
  Thermal and IMU models and addresses are TBD, so their drivers are stubs that report FAILED until the parts are identified.
- Send parsed values, not raw bytes, except LD19 scans batched per revolution.
- Build: `cmake -B build -DPICO_SDK_PATH=<path> && cmake --build build`, flash the `.uf2` by holding BOOTSEL.
- A host-side test (`pico/test/`) compiles `link.c` natively and checks frames against the Pi parser.

## 14. System files (`raspberrypi/system/`)

### 14.1 `robot.service`

```
[Unit]
Description=Robot main program
After=network.target gpsd.service
Wants=gpsd.service

[Service]
Type=notify
User=robot
SupplementaryGroups=dialout i2c video plugdev
ExecStartPre=/opt/robot/system/prestart.sh
ExecStart=/opt/robot/bin/robot --config /etc/robot/robot.yaml
Restart=on-failure
RestartSec=2
WatchdogSec=2
NotifyAccess=main
KillSignal=SIGTERM
TimeoutStopSec=5

[Install]
WantedBy=multi-user.target
```

`WatchdogSec` is TBD (2 s is a starting value; it must be several times the loop period plus init jitter).
The robot does not depend on the bridge service; either can start or crash alone.
Groups come from `docs/ROBOT.md`.

`prestart.sh` (each step logs and exits 0 unless the config file is missing, so optional devices never block startup):

- Check that `/etc/robot/robot.yaml` exists.
- Check that `/dev/servo45`, `/dev/servo25`, `/dev/pico` exist, and that `pigpiod` is running for the DC drivers, and log any that are missing (the program decides required vs optional).
- Clean up stale camera state: stop any leftover `rpicam-*` process that holds the camera.
- No NCS2 or Coral reset step (both dropped for now).

### 14.2 `robot-bridge.service`

```
[Unit]
Description=Robot bridge to SpacetimeDB
After=network-online.target
Wants=network-online.target

[Service]
User=robot
WorkingDirectory=/opt/robot/bridge
EnvironmentFile=/etc/robot/bridge.env
ExecStart=/usr/bin/node dist/src/index.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

### 14.3 `robot-tmpfiles.conf`

```
d /run/robot 0770 robot robot -
d /var/lib/robot 0770 robot robot -
```

Install to `/etc/tmpfiles.d/robot.conf`.

### 14.4 `99-robot.rules` (from `docs/ROBOT.md`; every address is TBD and must be verified)

```
# Fill each KERNELS value from: udevadm info -a -n /dev/ttyAMAx
SUBSYSTEM=="tty", KERNELS=="fe20XXXX.serial", SYMLINK+="servo45"    # UART4, TBD
SUBSYSTEM=="tty", KERNELS=="fe20XXXX.serial", SYMLINK+="servo25"    # UART5, TBD
# Pico: fill idVendor, idProduct, serial from: udevadm info -a -n /dev/ttyACM0
SUBSYSTEM=="tty", ATTRS{idVendor}=="TBD", ATTRS{idProduct}=="TBD", ATTRS{serial}=="TBD", SYMLINK+="pico"
# GPS USB adapter or dongle, TBD
SUBSYSTEM=="tty", ATTRS{idVendor}=="TBD", ATTRS{idProduct}=="TBD", SYMLINK+="gps0"
```

The DC drivers are GPIO PWM H-bridges (2026-11-08), so they have no udev rule; config names their GPIO pins instead.
Point gpsd at `/dev/gps0` in `/etc/default/gpsd` (`DEVICES="/dev/gps0"`).

### 14.5 Boot config

`config.txt.snippet` holds the `/boot/firmware/config.txt` lines from `docs/ROBOT.md`, plus the steps: `sudo systemctl disable hciuart`, and turn off the serial login console in `raspi-config`.

## 15. Config file

YAML at `/etc/robot/robot.yaml` (laptop: `config/robot.laptop.yaml`).
`config.cpp` validates types and ranges and fails BOOT with a clear message.
Every TBD value has a key; a TBD key holds a placeholder value and a `# TBD` comment.

```yaml
robot: { robot_id: dog1, name: "Dog 1" }
loop: { rate_hz: 50, overrun_factor: 2.0, overrun_ticks: 5 }
init: { device_timeout_ms: 3000 }
fault: { max_retries: 3 }
shutdown: { timeout_ms: 2000 }
devices:
  required: [pico, thermal, dc_driver_a, dc_driver_b]      # TBD team decision
  optional: [maestro_a, maestro_b, camera, imu, ads1115, lidar_single, ld19, gps, light]
maestro_a: { mock: false, path: /dev/servo45, baud: 0 }    # baud TBD
maestro_b: { mock: false, path: /dev/servo25, baud: 0 }    # baud TBD
# GPIO PWM H-bridges via pigpiod (docs/ROBOT.md, "Pi 4B GPIO"). channel 0 = A, 1 = B; pins are [IN1, IN2].
dc_driver_a: { mock: false, pwm_hz: 1000, ch0_pins: [17, 27], ch1_pins: [22, 23] }   # left: FL, BL
dc_driver_b: { mock: false, pwm_hz: 1000, ch0_pins: [5, 6], ch1_pins: [20, 21] }     # right: BR, FR
pico: { mock: false, path: /dev/pico, heartbeat_hz: 20, link_timeout_ms: 250, max_crc_errors_per_s: 5 }
stale_ms: { imu: 200, thermal: 2000, lidar_single: 500, ld19: 1000, camera: 500, gps: 3000 }
camera: { mock: false, width: 640, height: 480, clip_fps: 30 }
gps: { mock: false, host: localhost, port: 2947 }
light: { impl: mock, maestro_channel: -1, use_for_clip: true, warmup_ms: 500 }   # TBD hardware: mock | maestro_digital | manual
motion:
  impl: drive_only                  # mock | drive_only | legged
  drive_only:
    hold_stance: true               # hold legs at legs.stance_height_m if the Maestros are up
  mecanum:
    wheel_radius_m: 0.0             # TBD
    half_track_lx_m: 0.0            # TBD, half the left-right spacing at default stance
    half_base_ly_m: 0.0             # TBD, half the front-back spacing at default stance
    wheel_order: [1, 2, 3, 4]       # TBD: physical wheel for paper index 1..4
    invert: [false, false, false, false]
    max_wheel_rad_s: 0.0            # TBD
legs:
  impl: mock                        # mock | two_link
  stance_height_m: 0.0              # TBD
  l1_m: 0.0                         # TBD
  l2_m: 0.0                         # TBD
  channels: []                      # TBD: per leg, list of [maestro, channel]
servos: { max_rate_us_per_s: 0 }    # per-channel min_us, max_us, zero_us, direction TBD
limits: { max_lin_mps: 0.2, max_ang_dps: 45, max_lin_accel: 0.5, max_ang_accel: 90, reject_factor: 5 }
safe_stop: { servo_action: hold }                           # TBD
estop: { sense: none }
thermal:
  width: 32
  height: 24
  fov_h_deg: 55
  yaw_offset_deg: 0
  delta_c: 4.0
  min_c: 25.0
  max_c: 45.0
  min_blob_px: 3
  max_blob_frac: 0.5
  person_width_m: 0.25
  size_tolerance: 0.5
  persist_frames: 3
  persist_window: 5
  persist_px: 2
  confirm_s: 3
  confirm_min_frames: 3
  contrast_full_c: 6
  render_scale: 10
  mask: []                                                  # list of [col0, row0, col1, row1]
terrain:
  impl: rules                       # rules | mock
  front_sector_deg: 60
  lidar_single_mode: forward        # forward | down, TBD mounting
  ground_range_m: 0.0               # TBD, only for mode down
  tilt_lpf_alpha: 0.2
  use_force: false                  # FSR force sensors, meaning TBD, never ground contact
  force_rules: []                   # TBD once Matthew says what each sensor measures
  missing_input_penalty: 0.2
  blocked_m: 0.25
  clear_m: 0.6
  gap_drop_m: 0.05
  max_pitch_deg: 20
  max_roll_deg: 20
  step_rise_m: 0.04
  max_step_m: 0.0                   # TBD from Matthew
  bump_window_s: 1.0
  bump_gyro_dps: 30
  debris_range_var: 0.01
  base_confidence: { flat: 0.6, debris: 0.5, step: 0.6, gap: 0.6, blocked: 0.8, unknown: 0.2 }
  agree_bonus: 0.2
  hold_ticks: 5
  slow_scale: 0.5
  report_max_hz: 1
  report_keepalive_s: 5
  camera_hint: { enabled: false, frame_every_s: 1.0, max_age_ms: 1500, weight: 0.3 }
scan: { seconds_per_cell: 10, mode: rotate, rotate_wz_dps: 20, dedupe_deg: 15, dedupe_m: 1.0, min_view_m: 0.5, min_fresh_frac: 0.9, min_clear_frac: 0.7 }
inspect: { standoff_m: 1.0, approach_timeout_s: 10, settle_s: 2, still_gyro_dps: 2.0 }
breathing: { clip_s: 20 }                                   # validation: >= 15
nav: { match_radius_m: 5, min_clearance_m: 0.30, blocked_timeout_s: 5 }
hold: { max_s: 0, inspect_candidates: false }
missions: { auto_start: true, max_cells: 20, target_margin_m: 50, max_target_distance_m: 600, search_without_path: true, on_bridge_loss: finish_step_then_hold }
site: { demo_mode_default: true, center_lat: 0.0, center_lon: 0.0, radius_m: 483 }
location: { force_demo: false }
home: { lat: 0.0, lon: 0.0 }
heading: { initial_deg: 0, gps_min_speed_mps: 0.5 }
odometry: { scale: 1.0 }
paths_file: /etc/robot/demo_paths.yaml
bridge: { socket: /run/robot/bridge.sock, heartbeat_hz: 1, position_hz: 1, outbox: /var/lib/robot/outbox.jsonl }
control: { socket: /run/robot/control.sock }
media_dir: /var/lib/robot/media
recorder: { dir: /var/lib/robot/logs, max_gb: 8, decimate: 1 }
```

`demo_paths.yaml`:

```yaml
anchor: { lat: 0.0, lon: 0.0 }           # copy from backend/sim config
waypoints:
  home:    { lat: 0.0, lon: 0.0 }
  house_3: { lat: 0.0, lon: 0.0, label: "house 3" }
paths:
  - name: home_to_house_3
    start: home
    end: house_3
    cells: [3]                            # search_cell ids or labels this path covers
    steps:
      - { drive: { vx: 0.15, vy: 0, wz: 0, seconds: 4 } }
      - { turn_to: { heading_deg: 90 } }
      - { scan: { seconds: 10, mode: rotate } }
```

### 15.1 Every TBD value

| Key or item | Placeholder | Who decides | How |
| --- | --- | --- | --- |
| `devices.required` | pico, thermal, DC drivers | Team | Depends on the drive-only plan |
| Maestro baud rates, channel map, servo limits | 0, none | Matthew | Maestro Control Center |
| DC driver board marking, minimum starting duty per wheel | GPIO PWM, pins from the bench | Matthew, Camille | Board marking, floor test |
| `motion.mecanum.*` (wheel radius, spacing, wheel order, invert, max speed) | 0, identity | Matthew | Measure, then the floor check in section 12.4 |
| Leg geometry, servo count per leg, channel map, servo limits (`legs.*`, `servos.*`) | 0, mock | Matthew | Matthew describes the legs |
| IMU model, address, axes | none | Matthew | Part marking, I2C scan |
| Thermal model, `width`, `height`, `fov_h_deg`, frame rate | 32x24, 55 degrees | Matthew | Part marking |
| Thermal thresholds (`delta_c`, `min_c`, `max_c`, `min_blob_px`, `person_width_m`, `size_tolerance`, persistence, confidence weights) | section 15 values | Camille | Range test (section 7.5) |
| `thermal.mask`, `yaw_offset_deg`, LiDAR to thermal alignment | none, 0 | Matthew | Look at frames on the robot |
| Every `terrain.*` threshold (`blocked_m`, `clear_m`, `gap_drop_m`, tilt limits, `step_rise_m`, bump and debris values, confidences, `hold_ticks`, `slow_scale`) | section 15 values | Eric, Camille | Drive over the mock rubble and replay the raw logs |
| `terrain.max_step_m` (what the robot can cross) | 0 | Matthew | Floor test |
| LD19 and single LiDAR mounting (height, `lidar_single_mode`, `ground_range_m`) | forward, 0 | Matthew | Mounting |
| FSR force sensor mounting and meaning, `terrain.force_rules` | off | Matthew | Look at the build |
| Camera terrain hint (endpoint, weight, max age) | disabled | Eric | Perception spec |
| Single-point LiDAR model | TF-Luna style, 115200 | Matthew | Part marking |
| LD19 packet format | per datasheet | Camille | Datasheet |
| GPS model, baud, USB adapter VID and PID | gpsd probes | Matthew | `udevadm info` |
| Pi UART `KERNELS` addresses, Pico USB ids | `fe20XXXX`, TBD | Camille | `udevadm info -a -n` |
| Pico protocol type ids, device ids, CRC choice | section 12.1 | Camille | Accept or change in review |
| `pico.heartbeat_hz`, `link_timeout_ms` | 20 Hz, 250 ms | Camille | Tune on hardware |
| `loop.rate_hz`, overrun values | 50 Hz, 2.0, 5 | Camille | Measure tick time on the Pi |
| `stale_ms` per sensor | section 15 values | Camille | Measure real rates |
| `WatchdogSec`, `RuntimeWatchdogSec` | 2 s, TBD | Camille | After loop timing |
| Camera resolution, fps under encoding | 640x480, 30 | Camille | Measure on the Pi |
| White light for the camera (part, channel, flicker) | mock | Team | Buy or find a steady LED light (section 12.3) |
| Coverage thresholds (`scan.min_view_m`, `min_fresh_frac`, `min_clear_frac`) | 0.5 m, 0.9, 0.7 | Camille | Mock rubble with a blocked corner |
| E-stop sense line | none | Matthew | Wiring |
| SAFE_STOP physical behavior | zero motors, servo hold | Team | Depends on hardware |
| Battery monitor (`battery_pct`) | null | Matthew | No sensor in inventory |
| Speed and acceleration limits | 0.2 m/s, 45 deg/s | Matthew | Floor test |
| `odometry.scale`, wheel encoders | 1.0, none | Matthew | Drive 2 m and measure |
| `inspect.standoff_m`, `settle_s`, `still_gyro_dps` | 1.0, 2, 2.0 | Camille | Range test, IMU noise |
| `missions.auto_start`, `on_bridge_loss` | true, finish then hold | Team | Demo plan |
| Demo coordinates and paths | zeros | Demo owner | Copy from `backend/sim` |
| `recorder.max_gb` | 8 | Camille | SD card size |

## 16. Test plan

### 16.1 Unit tests (C++, GoogleTest, no hardware, `FakeClock`)

- `test_state_machine.cpp`: one test per row of the transition table in section 5, plus: e-stop latch survives every event except `reset`; `reset` while the sense line is asserted does nothing; FAULT retry counting; SIGTERM from every state ends in SHUTDOWN; missions in non-READY states are rejected.
- `test_safety_gate.cpp`: zero output outside ACTIVE; zero on stale sensor, Pico link lost, e-stop, clip recording; clamps and acceleration limits; NaN or huge command raises `command_out_of_limits`; a behavior output can never bypass the gate (the main loop only calls drivers with `GatedOutput`).
- `test_pico_frame.cpp`: encode and decode each message; CRC known-answer test; resync after garbage and after a corrupted frame; max length; split reads across buffer boundaries.
- `test_thermal_detector.cpp`: synthetic frames with no blob, one blob, a too-small blob, a too-hot blob, a masked blob, two blobs; persistence; confidence monotonic in contrast; bearing math.
- `test_localizer.cpp`: GPS mode, fix loss to indoor with offset, demo mode from waypoints, unknown mode, lat/lon offset math.
- `test_mission_runner.cpp`: each mission kind with mocks and a fake clock: `search_cells` marks cells in order, inspects a mock blob, sends one detection with a clip path, marks `searched`; a blocked view (mock LD19 sectors under `min_view_m`) or a scan from outside the cell marks `partially_searched`; cancel after the scan started marks `partially_searched`; thermal stale during the whole scan fails the mission and does not mark the cell; `inspect` with no blob ends `done` with the note; a mission with an unknown kind is rejected; `return_home` fails with no path; `hold` runs until cancel; invalid missions are rejected.
- `test_terrain.cpp`: one synthetic snapshot per rule (blocked with and without a clear side sector, gap, tilt stop, step slow and step stop, debris, flat, unknown with all inputs missing); hysteresis delays a class change but not a stop; rate limiter sends on change and at most 1 Hz; a stale camera hint is ignored; a fresh hint changes confidence and can only make the action more cautious; a hint can never clear `safety_stop`; the safety gate zeroes translation on a terrain stop even when the behavior asks to drive.
- `test_terrain_hint.cpp`: a `terrain_hint` line through the bridge client fills the hint slot; one whose `observed_at` is older than `terrain.camera_hint.max_age_ms` is ignored; a fresh agreeing hint raises confidence and a disagreeing one lowers it; a hint never clears `safety_stop`, never makes the action less cautious, and never changes the rule class.
- `test_bridge_client.cpp`: with a socketpair, non-blocking writes, drop-oldest on the telemetry queue, outbox replay after reconnect, unknown message types ignored.
- `test_motion.cpp`: mecanum mixing matches eq. 20 for pure vx, vy, wz; scaling keeps direction when a wheel saturates; `wheel_order` and `invert` applied; `leg_ik_mock` records stance and lift requests; `leg_ik_2link` returns false for unreachable targets; the gate zeroes translation while a leg is lifted.
- `test_config.cpp`: laptop config loads; clip under 15 s is rejected; missing keys produce clear errors.

### 16.2 Laptop end-to-end with mocks and a local SpacetimeDB

1. Local SpacetimeDB with the module, bindings generated to `backend/spacetimedb-bindings/`.
2. Seed a site in demo mode, a grid, and a run (`start_run`) with the simulator or `spacetime call`.
3. Start the media server, the bridge, and `robot --config config/robot.laptop.yaml`.
4. Check: within 5 s the `robot` row is `online` with state `READY`; `device_status` rows exist for every device; positions arrive at 1 Hz.
5. Create a `search_cells` mission for two cells; `robotctl mock thermal_blob on` during the second cell.
6. Check: mission goes `leased`, `active`, `done`; cells go `searching` then `searched`; one `detection` row with three media URLs that open; a `survivor` row exists; the perception service received a 20 s clip on `/breathing` and wrote `report_breathing` (the mock clip has a 15 per minute signal).
7. Outage test: stop SpacetimeDB for 60 s mid-mission.
   The robot keeps scanning, the bridge spool grows, then on restart the spooled cells and detection arrive in order with their original `observed_at`, and the newest spooled position updates the robot row.
   Check that the module reopened the robot's `searching` cell during the outage (robot offline after 5 s), and that the replayed `cell` messages then set it again.
8. Bridge crash test: kill the bridge mid-mission; the robot finishes the step and holds; restart the bridge; the outbox replays the detection.
9. E-stop test: `robotctl estop` during a drive step; motion command goes to zero within one tick; the mission ends `failed`; `robotctl reset` returns to READY.
10. Terrain test: `robotctl mock terrain blocked` during a drive step; the robot stops, the `robot` row reads `blocked` with action `stop`, and one `terrain` event appears; `robotctl mock terrain debris` gives `slow` and one more `terrain` event, not one per tick.
11. Agent safety test: send a mission with an unknown kind and one with a target 5 km away; both are rejected with `failed` notes.
12. Agent mission test: start the agents (`backend/agent/`), let the orchestrator create a mission; the orchestrator's mission is leased by this robot and runs; with `require_mission_approval` true it waits as `proposed` until a coordinator approves.
13. Heartbeat lease test: freeze the C++ program (`kill -STOP`) during an active mission; within the mission lease the module requeues the mission, and within 5 s marks the robot offline and reopens the cell.

### 16.3 Hardware bring-up (one device at a time, `robot_diag`)

1. Pi: flash Debian 12, apply `config.txt.snippet`, disable `hciuart` and the serial console, create the `robot` user and groups, install packages.
2. udev: fill each `KERNELS` and USB id with `udevadm info -a -n`, reload rules, confirm `/dev/servo45`, `/dev/servo25`, `/dev/pico`, `/dev/gps0`.
3. Logic levels: check every TX line into the Pi and Pico is 3.3 V before connecting (`docs/ROBOT.md`).
4. Pico: flash, `robot_diag pico` shows VERSION, heartbeats both ways, and `DEV_STATUS` for each device.
5. Thermal: `robot_diag thermal` prints the frame as ASCII and blob stats; hand in front at 1 m shows a blob.
6. IMU: `robot_diag imu` shows gyro near 0 at rest; measure noise for `still_gyro_dps`.
7. LiDARs: `robot_diag lidar_single` and `robot_diag ld19` show sane ranges.
8. Camera: `robot_diag camera --still out.jpg` and `--clip 20 out.mp4` with exposure locked; check the frame rate in the log.
9. GPS: `cgps -s` outdoors shows a fix, then `robot_diag gps`.
10. DC motors, wheels off the ground, e-stop in hand: `robot_diag motor A1 0.1` for each motor, set `invert` and `wheel_order`; then on the floor `robot_diag drive vx 0.1`, `vy 0.1`, and `wz 20` must drive straight, strafe, and spin in place (mecanum check, section 12.4).
11. E-stop: press it during `robot_diag drive`; motors stop from the power cut; with a sense line, the program latches SAFE_STOP.
12. Maestros and legs (stretch, only when Matthew gives the leg geometry and channel map): `robot_diag servo <ch> <us>` one channel at a time within limits, then `robot_diag stance <height>` with the robot on a stand.
13. Full program under systemd: `systemctl start robot robot-bridge`, kill the main loop with `kill -STOP` to see the watchdog restart it.
14. Range test (section 7.5), then lock thermal thresholds.
15. Terrain: drive slowly at a box, a 3 to 5 cm step, a gap, and loose debris on the mock rubble; check `robot_diag terrain` prints the expected class, then tune the `terrain.*` values from the raw logs.

## 17. Build order with hour estimates

About 20 hours remain.
"No HW" means one person can do it on a laptop without the robot.

| # | Task | Hours | No HW | Owner suggestion |
| --- | --- | --- | --- | --- |
| 1 | `protocol/pico_link.h`, CRC, frame codec, tests | 1.5 | yes | Camille |
| 2 | Core: config, clock, slots, logger, world, CMake, CI build | 1.5 | yes | Camille |
| 3 | State machine and safety gate, with full unit tests | 2 | yes | Camille (Cayden can pair) |
| 4 | HAL interfaces and all mocks (Pico mock with thermal blob, camera, GPS, light, motion, leg IK mocks) | 2 | yes | Camille |
| 5 | Thermal detector, render, tests | 1.5 | yes | Camille, Eric reviews |
| 6 | Terrain assessor (rules, mock, reporter, gate hook), tests | 2 | yes | Eric with Camille |
| 7 | Localizer and demo paths | 1 | yes | Camille |
| 8 | Mission runner and the four behaviors | 2.75 | yes | Camille |
| 9 | Bridge client, control server, `robotctl`, outbox | 1.5 | yes | Camille |
| 10 | Node bridge: connect, mapping, missions, media, spool, terrain, tests | 3 | yes | Cayden (extra work) or Camille |
| 11 | Mecanum mixing in `drive_only`, tests | 1 | yes | Camille |
| 12 | Laptop end-to-end run (section 16.2) | 1.5 | yes | everyone |
| 13 | Pico firmware: link, heartbeat, watchdog, LD19 and single LiDAR tasks | 2.5 | partly (host test) | Camille |
| 14 | Pico thermal and IMU drivers, once models are known | 2 | no | Camille, Matthew |
| 15 | Real Pico link, libcamera camera and clip writer, gpsd reader on the Pi | 2.5 | no | Camille |
| 16 | Real DC driver protocol and the floor mecanum check | 2 | no | Matthew, Camille |
| 17 | systemd, udev, tmpfiles, bring-up steps 1 to 13 | 2 | no | Matthew, Camille |
| 18 | Range test and thermal threshold tuning | 1 | no | Eric, Camille |
| 19 | Terrain threshold tuning on the mock rubble | 1 | no | Eric |
| 20 | Sensor log `upload-logs` CLI | 0.5 | yes | anyone |
| 21 | Leg IK (stretch): real geometry, stance and lift on a stand | 3 | no | Matthew, Camille |
| 22 | Camera terrain hint (stretch, needs Eric's endpoint) | 1 | yes | Eric |
| 23 | Coverage rule, tests | 1 | yes | Camille |
| 24 | Bridge `client_ref` survivor lookup | 0.5 | yes | Cayden or Camille |
| 25 | Direct HTTP reducer test script (option to test, section 9.10) | 0.5 | yes | anyone |

Items 1 to 12, 20, and 22 to 25 need no hardware (about 24.75 person-hours, parallel across Camille, Eric, and Cayden).
Items 13 to 19 need the robot (about 13 person-hours), and item 21 is a stretch.
Critical path: 2, 3, 4, 8, 12 on the laptop, in parallel with 13 to 17 on the robot, meeting at a real-hardware end-to-end run.
Priority (`docs/MVP.md` "Priority by sponsor track"): the robot's part is priority 3, the find and breathing check, so thermal detection, `inspect` with the 20 s clip, the detection message, and the bridge come before terrain tuning and the camera terrain hint (priority 7).
Cut order if time runs out: leg IK and legged motion (stretch), the camera terrain hint, the direct HTTP test, LD19 logging, GPS (demo mode covers the venue), drive-only (a stationary robot still runs `search_cells` with `search_without_path` and `inspect`).

## 18. Proposed contract changes

Proposed contract changes: none open.
The advisory `terrain_hint` message (section 7b.5) was merged into CONTRACTS.md version 8.1.
