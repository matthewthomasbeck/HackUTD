# Raspberry Pi software

The robot's C++ main program lives in `robot/`.
The spec is `docs/specs/robot.md`; the tasks are R0 to R9 in `docs/tasks/camille.md`.

What exists so far (R1 and the C++ part of R0):

- Config loading and validation (`robot/config/robot.yaml` for the Pi, `robot.laptop.yaml` with every device mocked).
- The state machine (`src/state/state_machine.cpp`), a pure function with one test per transition.
- The safety gate (`src/state/safety_gate.cpp`), the only path from a behavior to the drivers.
- The fixed-rate main loop (`src/main.cpp`), the local control socket, and `robotctl`.
- Mock devices. Real device drivers are task R2, so a device with `mock: false` reports FAILED and nothing moves.
- The C++ side of the bridge (R3): `src/bridge/bridge_client.*`, `src/bridge/messages.*`, and the localizer (`src/localization/localizer.*`, `src/core/geo.*`). See "Bridge to SpacetimeDB" below.

Not here yet: the Node.js bridge (`bridge/`, the other half of R3) and systemd and udev files (`system/`, R9).
The Pico firmware (`pico/`, R4) has a first version streaming text lines; `pico/README.md` lists what it still lacks.

## Build

Laptop (macOS):

```
brew install cmake yaml-cpp nlohmann-json googletest
```

Pi or Linux laptop (Debian 12). `cmake` and `g++` are enough; CMake downloads yaml-cpp and GoogleTest if they are missing.
To use the system packages instead:

```
sudo apt install build-essential cmake pkg-config libyaml-cpp-dev nlohmann-json3-dev libgtest-dev libsystemd-dev
```

Then:

```
cd raspberrypi/robot
cmake -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build -j
ctest --test-dir build --output-on-failure
```

Add `-DROBOT_WERROR=ON` to treat warnings as errors.
`sd_notify` (the systemd watchdog) is compiled in only when `libsystemd` is found; on macOS it is a no-op.

## Run on a laptop with every device mocked

```
./build/robot --config config/robot.laptop.yaml          # add --verbose for motion and debug lines
```

In a second terminal:

```
./build/robotctl --socket /tmp/robot/control.sock status
./build/robotctl --socket /tmp/robot/control.sock start hold    # READY -> ACTIVE
./build/robotctl --socket /tmp/robot/control.sock estop         # -> SAFE_STOP, latched
./build/robotctl --socket /tmp/robot/control.sock reset         # -> FAULT -> INIT -> READY
```

Mock knobs, to see the safety rules fire:

```
./build/robotctl --socket /tmp/robot/control.sock mock pico_link lost       # ACTIVE -> SAFE_STOP; starts rejected
./build/robotctl --socket /tmp/robot/control.sock mock pico_link ok
./build/robotctl --socket /tmp/robot/control.sock mock stale thermal on     # required sensor goes stale
./build/robotctl --socket /tmp/robot/control.sock mock init pico FAILED     # next device init of pico fails
./build/robotctl --socket /tmp/robot/control.sock mock estop_sense on       # reset is refused while "pressed"
```

Ctrl+C (SIGINT) or SIGTERM stops motion, then ends in SHUTDOWN with exit code 0.
An invalid config exits with code 2 and names the bad key.

## Bridge to SpacetimeDB (C++ side, task R3)

The robot connects to the Node.js bridge's Unix socket and sends one JSON object per line (`docs/specs/robot.md` 9.3): `heartbeat` and `position` at `bridge.heartbeat_hz` and `bridge.position_hz`, and a `device` line per device after init, on every status change, and again after each reconnect.
Every line has `observed_at` (UTC, wall clock) and `seq`. It reads `mission`, `cancel`, `site`, and `terrain_hint` back and ignores any other type with a log line.
It never waits on the bridge: with no bridge running it logs `bridge: cannot connect ... retry in 0.5 s` (then 1, 2, 4, 5 s) and keeps ticking.
While the bridge is down, `detection`, `cell`, and `mission_progress` lines go to the outbox file and are replayed first on the next connect, also after a robot restart.
On connect the outbox is renamed to `<outbox>.replaying`, which is deleted only after its last line is written, so a crash during the replay replays it again; after an unclean drop the last 32 important lines written are replayed too, so the bridge can see a line twice (it dedupes).
Heartbeat and position are not queued while the bridge is down; fresh ones go out on connect.

Missions: only `hold` runs today (through the state machine, with `mission_progress` active, failed, or done). Other kinds are stored and logged, not started, until the mission runner (R6).
With `missions.auto_start: false`, a bridge `hold` mission is stored too and starts on `robotctl start`.
The bridge resends the current mission on every connect: a resend of the running, stored, or already finished (done or failed this boot) mission is ignored with a log line. Cancelled ids are not remembered, so a re-leased mission starts again.
`robotctl stop` during a bridge mission sends `mission_progress(failed, "stopped by operator")`.
A `site` message sets demo mode for the localizer; before one arrives, `site.demo_mode_default` applies.

Config keys (both YAML files):

| Key | Pi | Laptop | Meaning |
| --- | --- | --- | --- |
| `bridge.socket` | `/run/robot/bridge.sock` | `/tmp/robot-bridge.sock` | the bridge listens, the robot connects (laptop path matches the Node bridge's laptop default) |
| `bridge.heartbeat_hz`, `bridge.position_hz` | 1 | 1 | heartbeat must stay at 0.5 Hz or more (the module marks a robot offline after 5 s) |
| `bridge.outbox` | `/var/lib/robot/outbox.jsonl` | `/tmp/robot/outbox.jsonl` | unsent important lines; empty disables it |
| `bridge.test_mission_id` | 0 | 0 | TEST HOOK, see below |
| `site.*` | | | demo mode and site center until the bridge sends `site` |
| `location.force_demo` | false | false | demo positions even if the site is not in demo mode |
| `home.*` | | | home coordinates (TBD, copy from `backend/sim`) |
| `heading.source` | `imu` | `commanded` | heading from the IMU gyro, or from the commanded turn rate (the mock IMU never turns) |
| `heading.gyro_axis`, `heading.gyro_sign` | `z`, -1 | `z`, -1 | TBD per IMU mounting |
| `heading.initial_deg`, `heading.gps_min_speed_mps` | 0, 0.5 | 0, 0.5 | start heading; above this speed the GPS track sets the heading |
| `odometry.scale` | 1.0 | 1.0 | TBD: drive 2 m and measure |

Demo coordinates come from `paths_file` (`config/scripts/demo_paths.yaml`, all zeros and TBD until copied from `backend/sim`).
There is no GPS driver yet (R2), so outside demo mode the location is unknown and no `position` lines are sent (the reducer needs lat and lon).

To watch the lines without the Node bridge:

```
python3 -c "import socket,os; p='/tmp/robot-bridge.sock'; os.path.exists(p) and os.unlink(p); s=socket.socket(socket.AF_UNIX); s.bind(p); s.listen(1); c,_=s.accept(); [print(l, end='') for l in c.makefile()]"
```

Test hook, for the R3 laptop check before the inspect behavior exists: `robotctl test_detection [MISSION_ID]` queues one fake thermal detection (made-up temperature and confidence, no media files).
It uses the given mission id, else the running mission, else `bridge.test_mission_id`; it refuses mission 0, which the bridge drops.

```
./build/robotctl --socket /tmp/robot/control.sock test_detection 42
```

`robotctl status` also shows `bridge` (connected, queue sizes, site demo mode, stored mission) and `location` (mode, lat, lon, heading, note).

## Threads

| Thread | File | Job |
| --- | --- | --- |
| main | `src/main.cpp` | The orchestrator. Drains the Pico link each tick without blocking, reads the newest camera frame age and detections, runs the state machine and safety gate, and hands the gated command to the movement thread |
| movement | `src/motion/movement_thread.*` | The only writer to the Maestros and DC drivers. Applies the newest command at `movement.rate_hz`; stops the wheels by itself if main goes quiet for `movement.command_timeout_ms` |
| vision | `src/vision/vision_thread.*` | Newest camera frame -> detector (OpenCV + Coral) -> detections slot. Skips frames it was too slow for |

libcamera delivers frames on its own thread (the mock camera uses a small `camera-mock` thread), and device init runs on short-lived threads.
Threads share data only through `LatestSlot<T>` (`src/core/latest_slot.hpp`): one value, one lock, newest wins.
Workers derive from `Worker` (`src/core/worker.hpp`) and stamp a heartbeat each pass; a stuck movement thread raises `worker_stalled` and stops the systemd watchdog ping.

Stubs to fill (each says `TODO(R2)`, `TODO(R8)`, or `TODO(vision)`): `hal/servo_maestro.cpp`, `hal/camera_libcamera.cpp`, `vision/detector_coral.cpp`, and the leg checks in `state/safety_gate.cpp`.

Real now (2026-11-08):

- `hal/pico_link_serial.cpp` reads the Pico firmware's text stream (`hal/pico_text_protocol.*`) and checks its version (`pico.firmware_version`). Each Pico sensor's device status comes from the Pico's `STATUS` reply.
- `hal/dc_driver_gpio.cpp` drives the two H-bridges on GPIO PWM through `pigpiod` (pins in `dc_driver_a` / `dc_driver_b`). Install with `sudo apt install pigpio && sudo systemctl enable --now pigpiod`, then rebuild; CMake prints `pigpio=ON`.
- `motion/mecanum.hpp` mixes with eq. 20. The wheels stay at 0 until `motion.mecanum.wheel_radius_m`, `half_track_lx_m`, `half_base_ly_m` and `max_wheel_rad_s` are measured.
- Until the udev rules exist (R9), point `pico.path` at the `/dev/serial/by-id/usb-Raspberry_Pi_Pico_*` path.

## Drive bring-up and calibration (`robot_diag`, task R8)

Stop the robot program first; `robot_diag` drives the devices directly. Ctrl+C stops the motors.

```
./build/robot_diag --config config/robot.yaml pico 3              # Pico streams and newest values
./build/robot_diag --config config/robot.yaml motor a0 0.4        # one driver channel, no mixer
./build/robot_diag --config config/robot.yaml wheel fl 0.4        # one wheel, + rolls the robot forward
./build/robot_diag --config config/robot.yaml calibrate           # guided, prints motion.mecanum values
./build/robot_diag --config config/robot.yaml drive 0.1 0 0 2     # after calibrating: about 20 cm
./build/robot_diag --config config/robot.yaml drive 0 0 45 2      # about 90 degrees
```

`calibrate` runs 4 steps: wheel directions (on blocks, fixes `invert`), top wheel speed (on blocks, count turns of a tape mark), `lx + ly` (spin on the floor, measured with the IMU gyro), and an optional radius check (drive at a wall, measured with the TF-Luna).
Only `lx + ly` appears in the mixer, so the spin measures exactly what it needs at the real stance.
Calibrate at the stance the robot drives in: moving the legs changes the wheel spacing.

## Leg bring-up and calibration (`robot_diag`, task R8)

Each leg has 3 servos on Maestro A (abduction, hip, knee). Each servo maps an angle to a pulse with its own calibration in `legs.joints` (`pulse_us = zero_us + direction * us_per_rad * angle`). The zero pose comes from the Rubble Dog assembly: femur straight down, tibia in line with the femur, leg hanging straight.

```
./build/robot_diag --config config/robot.yaml servo a 3 1500      # one channel to a raw pulse (ramped)
./build/robot_diag --config config/robot.yaml legcal              # guided, all 12 joints
./build/robot_diag --config config/robot.yaml legcal FL_knee      # or one joint
./build/robot_diag --config config/robot.yaml joint FL_knee 45    # check a calibrated joint
```

Each leg now has a hip (femur) and a knee servo; press Enter at the abduction joints, which were removed (2026-11-08).
`legcal` per joint: which channel it is on, jog to the zero pose, jog to a known reference angle (90 degrees is easiest; it measures `us_per_rad` and `direction`), then jog to each end and stop short of hitting (`min_us` / `max_us`, kept 20 us inside). Every jog is ramped at 400 us/s, so a typo cannot slam a leg.
When all 12 are pasted in, set `legs.impl: two_link`, `legs.stance_height_m`, and `servos.max_rate_us_per_s`. The IK then rejects (never clamps) any goal the leg cannot reach or that would pass a limit, and the movement thread moves each servo no faster than that rate. While a leg is lifted, the safety gate holds translation at zero.

## Remote driving (`robotctl start teleop`)

A person drives the robot from UnderDog's Camera View (Take over; `docs/specs/dashboard.md`, "Camera View and Take over"), through SpacetimeDB (`take_over`, `teleop_drive`) and the bridge's `teleop` message (CONTRACTS.md 8.3). On the Pi it also works without the website:

```
./build/robotctl start teleop
./build/robotctl teleop                 # w/s forward/back, a/d strafe, q/e turn, space stop, x quit
./build/robotctl drive 0.1 0 0 2        # or one command for 2 s (m/s, m/s, deg/s)
./build/robotctl stop
```

The robot stops by itself 300 ms after the last command (`teleop.deadman_ms`), and the safety gate's limits still apply.

To see the thermal feed while driving, run the preview in robot mode (`raspberrypi/preview/README.md`, "Later integration with the C++ robot"), never `--standalone`: the robot program owns the Pico, and two Pico readers each get garbage.
Tested on a laptop: `./build/robot --config config/robot.laptop.yaml`, the bridge on the same database, and `python3 raspberrypi/preview/server.py --socket /tmp/robot/control.sock --no-camera --port 8081`, then the dashboard with `?robotPreview=http://127.0.0.1:8081`.

## Autonomous thermal seek (`robotctl start seek_thermal`)

The robot finds a warm, person-sized shape with the thermal camera and drives up to it on its own:
scan (turn in steps, pausing to look) -> turn toward the target -> approach, steering to keep it centered -> stop at `inspect.standoff_m` (1.0 m) -> the mission is done and the robot returns to READY. It gives up after `seek.scan_max_s` with nothing found.

- Detection follows docs/specs/robot.md section 7: 4 C above the frame's median, person-sized, seen in 3 of the last 5 frames (`thermal.*`).
- With several warm shapes it goes to the closest, measured by the LD19 at each one's bearing (or the biggest blob without the LD19), and stays locked on it.
- Distance to the target: LD19 at its bearing, else the TF-Luna once it is centered, else blob size (`seek.close_frac`).
- While approaching, anything nearer than `seek.blocked_m` ahead that is not the target stops forward motion.
- The safety gate still applies: speed limits, and every fault stops it.

Laptop test with mocks:

```
./build/robot --config config/robot.laptop.yaml &
./build/robotctl --socket /tmp/robot/control.sock start seek_thermal
./build/robotctl --socket /tmp/robot/control.sock mock thermal_blob 28   # fake warm body on the right
./build/robotctl --socket /tmp/robot/control.sock mock thermal_blob 16   # now straight ahead
./build/robotctl --socket /tmp/robot/control.sock stop
```

Set on the robot before trusting it (all in robot.yaml): `thermal.flip_x` (a warm hand on the right must give a positive bearing), `seek.ld19_front_deg` and `seek.ld19_clockwise` (where the LD19's 0 degrees points), and the section 7.5 range test for `thermal.delta_c`, `min_c`, `max_c`, `min_blob_px`.
## Terrain (task R7)

Every tick the robot classifies the ground ahead as `flat`, `debris`, `step`, `gap`, `blocked`, or `unknown` from the LD19, the single LiDAR, and the IMU (docs/specs/robot.md section 7b, `src/terrain/`).
The safety gate applies the result whatever the mission behavior asks for: a stop zeroes translation (and turning, unless the robot is blocked with a clear side), and slow caps the speed at `limits.max_lin_mps * terrain.slow_scale`.
The behaviors do not steer around obstacles yet; that is motion code and waits for the team's go-ahead.
Every `terrain.*` threshold and the sensor mounting are TBD; `terrain.camera_hint.enabled` and `terrain.use_force` stay false.

Laptop test with mocks (`robot.laptop.yaml` has `terrain.impl: mock`):

```
./build/robotctl --socket /tmp/robot/control.sock mock terrain blocked   # also flat, debris, step, gap, unknown
./build/robotctl --socket /tmp/robot/control.sock status                 # "terrain": class, action, inputs, camera hint
./build/robotctl --socket /tmp/robot/control.sock mock terrain off       # back to terrain.mock_sequence, else flat
```

On the robot, with the robot program stopped, `./build/robot_diag terrain 30` runs the rules on the live sensors for 30 s, prints each class change and the inputs once a second, and moves nothing.

CMake finds libcamera, OpenCV, and the Edge TPU runtime (libedgetpu plus TensorFlow Lite) if installed and prints `robot backends: ...`; without them the real devices report FAILED and the mocks still work.

## How one tick works

`src/main.cpp` runs at `loop.rate_hz` (50 Hz). Each tick:

1. Observe: copy device status, sensor ages, and the Pico heartbeat age into a `WorldSnapshot`.
2. Step: `step(machine, snapshot, events)` returns the next state and what to do (start init, start or abort a mission).
3. Behavior: in ACTIVE, the mission behavior proposes a `MotionCommand`.
4. Safety gate: `SafetyGate::filter` zeroes, clamps, or ramps it, and raises safety events for the next step.
5. Send: the movement thread takes only a `GatedCommand`, which only the gate can create.
6. Log: state changes, gate interventions (at most once per second), and a 1 Hz summary.
