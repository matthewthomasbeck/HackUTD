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
CMake finds libcamera, OpenCV, and the Edge TPU runtime (libedgetpu plus TensorFlow Lite) if installed and prints `robot backends: ...`; without them the real devices report FAILED and the mocks still work.

## How one tick works

`src/main.cpp` runs at `loop.rate_hz` (50 Hz). Each tick:

1. Observe: copy device status, sensor ages, and the Pico heartbeat age into a `WorldSnapshot`.
2. Step: `step(machine, snapshot, events)` returns the next state and what to do (start init, start or abort a mission).
3. Behavior: in ACTIVE, the mission behavior proposes a `MotionCommand`.
4. Safety gate: `SafetyGate::filter` zeroes, clamps, or ramps it, and raises safety events for the next step.
5. Send: the movement thread takes only a `GatedCommand`, which only the gate can create.
6. Log: state changes, gate interventions (at most once per second), and a 1 Hz summary.
