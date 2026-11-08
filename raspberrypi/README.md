# Raspberry Pi software

The robot's C++ main program lives in `robot/`.
The spec is `docs/specs/robot.md`; the tasks are R0 to R9 in `docs/tasks/camille.md`.

What exists so far (R1 and the C++ part of R0):

- Config loading and validation (`robot/config/robot.yaml` for the Pi, `robot.laptop.yaml` with every device mocked).
- The state machine (`src/state/state_machine.cpp`), a pure function with one test per transition.
- The safety gate (`src/state/safety_gate.cpp`), the only path from a behavior to the drivers.
- The fixed-rate main loop (`src/main.cpp`), the local control socket, and `robotctl`.
- Mock devices. Real device drivers are task R2, so a device with `mock: false` reports FAILED and nothing moves.

Not here yet: the bridge to SpacetimeDB (`bridge/`, R3) and systemd and udev files (`system/`, R9).
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

`legcal` per joint: which channel it is on, jog to the zero pose, jog to a known reference angle (90 degrees is easiest; it measures `us_per_rad` and `direction`), then jog to each end and stop short of hitting (`min_us` / `max_us`, kept 20 us inside). Every jog is ramped at 400 us/s, so a typo cannot slam a leg.
When all 12 are pasted in, set `legs.impl: two_link`, `legs.stance_height_m`, and `servos.max_rate_us_per_s`. The IK then rejects (never clamps) any goal the leg cannot reach or that would pass a limit, and the movement thread moves each servo no faster than that rate. While a leg is lifted, the safety gate holds translation at zero.

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
CMake finds libcamera, OpenCV, and the Edge TPU runtime (libedgetpu plus TensorFlow Lite) if installed and prints `robot backends: ...`; without them the real devices report FAILED and the mocks still work.

## How one tick works

`src/main.cpp` runs at `loop.rate_hz` (50 Hz). Each tick:

1. Observe: copy device status, sensor ages, and the Pico heartbeat age into a `WorldSnapshot`.
2. Step: `step(machine, snapshot, events)` returns the next state and what to do (start init, start or abort a mission).
3. Behavior: in ACTIVE, the mission behavior proposes a `MotionCommand`.
4. Safety gate: `SafetyGate::filter` zeroes, clamps, or ramps it, and raises safety events for the next step.
5. Send: the movement thread takes only a `GatedCommand`, which only the gate can create.
6. Log: state changes, gate interventions (at most once per second), and a 1 Hz summary.
