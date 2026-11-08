# Drone onboard software

Onboard code for a drone that runs on its own Raspberry Pi and its own microcontroller (MCU), separate from the robot dog.
It mirrors the dog's code in `raspberrypi/robot/`, `raspberrypi/bridge/`, and `pico/` one to one, with the dog-only parts taken out and nothing new put in.
The spec is `docs/specs/drone.md`; the dog's spec, which the drone follows wherever `drone.md` says nothing, is `docs/specs/robot.md`.

Nothing here flies.
There is no flight control (no motor mixing, PID, or attitude control) and no real actuator output, because the airframe is not decided and motion code needs a team decision first.
Every pin, address, baud rate, sensor model, and device path is TBD in the config.

## What is here

| Folder | Mirrors | What it is |
| --- | --- | --- |
| `pi/` | `raspberrypi/robot/` | C++17 main program: state machine, safety gate, fixed-rate main loop, flight and vision threads, control socket, mocks, `dronectl` |
| `bridge/` | `raspberrypi/bridge/` | Node.js bridge to SpacetimeDB; the drone shows up as an ordinary robot, `drone1` |
| `mcu/` | `pico/` | MCU firmware (Pico C SDK superloop), text link to the Pi with a heartbeat and a version check |

What the drone keeps from the dog, unchanged: the tick order (observe, step, behavior, safety gate, send, log), OK, DEGRADED, or FAILED from every device init, the SAFE_STOP rules (stale data, lost MCU heartbeat, loop overrun, out-of-limits command, latched e-stop), latest-value slots instead of queues, `sd_notify` only from the main loop, a mock for every device, the bridge protocol and outbox, the localizer, mission intake, and the `hold` and `teleop` missions.

What the drone leaves out, because it is dog hardware or dog behavior: legs and leg IK, mecanum wheels and the DC drivers, the Maestros, thermal seek, terrain rules and the camera terrain hint, the breathing-clip camera lock, the thermal camera, the lidars, the force sensors, and `robot_diag`.

Where the dog drives motors, the drone has `flight_output` (`pi/src/hal/flight_output.hpp`).
The mock records the last gated command; the real one reports FAILED and refuses every command, so `drone.yaml` never leaves FAULT.

## Build and test

### Pi program (`pi/`)

Laptop (macOS): `brew install cmake yaml-cpp nlohmann-json googletest`.
On Linux, `cmake` and `g++` are enough; CMake downloads yaml-cpp, nlohmann_json, and GoogleTest if they are missing.

```
cd drone/pi
cmake -B build -DDRONE_WERROR=ON
cmake --build build -j
ctest --test-dir build --output-on-failure
python3 tools/check_mock_lifecycle.py     # laptop lifecycle check, every device mocked
```

### Bridge (`bridge/`)

Node 22 or newer.
It imports the generated bindings from `../../backend/spacetimedb-bindings`, like the dog's bridge.

```
cd drone/bridge
npm ci
npm test
npx tsc --noEmit
```

### MCU firmware (`mcu/`)

You need the Pico SDK with its `lib/tinyusb` submodule and `arm-none-eabi-gcc`, as for `pico/`.

```
export PICO_SDK_PATH=/path/to/pico-sdk
cmake -S drone/mcu -B drone/mcu/build
cmake --build drone/mcu/build -j
```

Flash `drone/mcu/build/drone_mcu.uf2` the same way as the dog's Pico (`pico/README.md`).
Check the version with `PING`; expect `PONG 0.1`.
The firmware has not been built for a board yet (no Pico SDK on the machine it was written on), only syntax checked on a laptop against stand-in headers.

## Run on a laptop

Every device is mocked in `pi/config/drone.laptop.yaml`.

```
cd drone/pi
./build/drone --config config/drone.laptop.yaml          # add --verbose for debug lines
```

In a second terminal (READY is the idle state, as on the dog):

```
./build/dronectl --socket /tmp/drone/control.sock status
./build/dronectl --socket /tmp/drone/control.sock start hold      # READY -> ACTIVE
./build/dronectl --socket /tmp/drone/control.sock estop           # -> SAFE_STOP, latched
./build/dronectl --socket /tmp/drone/control.sock reset           # -> FAULT -> INIT -> READY
```

Mock knobs, to see the safety rules fire:

```
./build/dronectl --socket /tmp/drone/control.sock mock mcu_link lost   # ACTIVE -> SAFE_STOP; starts rejected
./build/dronectl --socket /tmp/drone/control.sock mock mcu_link ok
./build/dronectl --socket /tmp/drone/control.sock mock stale imu on    # stale sensor (make imu required first)
./build/dronectl --socket /tmp/drone/control.sock mock init mcu FAILED # next init of the MCU fails
./build/dronectl --socket /tmp/drone/control.sock mock estop_sense on  # reset is refused while "pressed"
```

Remote control, the same commands as the dog:

```
./build/dronectl --socket /tmp/drone/control.sock start teleop
./build/dronectl --socket /tmp/drone/control.sock drive 0.1 0 0 2      # m/s, m/s, deg/s for 2 s
./build/dronectl --socket /tmp/drone/control.sock teleop               # keyboard
```

The drone stops 300 ms after the last command (`teleop.deadman_ms`), and the safety gate's limits still apply.
Ctrl+C (SIGINT) or SIGTERM ends in SHUTDOWN with exit code 0; an invalid config exits with code 2 and names the bad key.

With SpacetimeDB on the laptop (a local server with the module published and a demo-mode site, as for the dog's bridge):

```
cd drone/bridge
cp .env.example .env        # ws://localhost:3000, assess-0hw81, ROBOT_ID=drone1, /tmp/drone-bridge.sock
npm run dev
# then start ./build/drone --config config/drone.laptop.yaml in drone/pi
spacetime sql assess-0hw81 "SELECT robot_id, state, online, lat, lon FROM robot" --server local
spacetime sql assess-0hw81 "SELECT device, status FROM device_status WHERE robot_id = 'drone1'" --server local
```

`drone1` appears in the `robot` table with its heartbeat and demo position, and one `device_status` row per device.
Run this against a scratch database, not one another person is using, because the `drone1` row stays (offline) after the run.

## Open questions

Each one needs a team decision before it is locked in code.

1. Which drone? The root `README.md` and the Devpost draft name a DJI Mini 4 Pro, which has no Raspberry Pi or user MCU on board, so this code cannot run on it. This code assumes a drone with its own Pi and MCU. The conflict is not resolved here.
2. Flight control: how does the Pi reach the rotors (an off-the-shelf flight controller, ESCs driven from the MCU, a vendor SDK, or nothing)? Who writes it? `flight_output` has no real implementation, and the flight thread passes the gated request on unchanged (`TODO(flight)` in `pi/src/flight/flight_thread.cpp` and `pi/src/hal/flight_output_unimplemented.cpp`). Ask before any motion code.
3. What does a stop mean in the air: hover, land, return home, or cut the motors? This covers SAFE_STOP, the flight thread's dead-man, the teleop dead-man, and a latched e-stop. The code sends only a zero velocity request.
4. Vertical motion and altitude: the command has no vertical axis, because the teleop contract (CONTRACTS.md 8.3) has none, and the `position` reducer has no altitude.
5. The MCU board and its toolchain (the firmware assumes an RP2040 and the Pico SDK, like the dog), the link (USB serial like the dog, or a UART with a baud rate), and its udev name (`/dev/drone_mcu` is a placeholder).
6. The MCU's sensors: only an IMU slot exists, and its driver reports NOT_FOUND until the model, bus, and address are known. A barometer, GPS, rangefinder, or thermal camera is not assumed. The Devpost draft says the drone carries a thermal camera; the root README says the drone streams DJI video to a laptop.
7. The camera: which one, and is it on the drone's Pi at all (the README plans DJI Fly RTMP to a laptop)? The detector model and runtime (the dog plans a Coral) are TBD.
8. GPS: none is confirmed, and there is no driver (the dog has none either). Outside demo mode the drone sends no position.
9. Which devices are required and which optional (`devices.required`, `devices.optional`).
10. Every number in `drone.yaml`: the speed and acceleration limits are the dog's floor limits, not flight limits; also the loop and flight thread rates, `stale_ms`, the MCU heartbeat rate and link timeout, and the MCU watchdog timeout.
11. The e-stop: is there a sense line, and on which MCU input (`estop.sense`)?
12. Battery monitoring: `battery_pct` is always null, as on the dog.
13. The MCU firmware feeds its hardware watchdog once per pass, as `docs/ROBOT.md` asks; the dog's firmware does not yet, so the timeout has not been tested on any board.
14. The MCU sends an `HB <ms>` line, which the dog's firmware does not: the dog's Pi counts its 50 Hz IMU lines as the heartbeat, and the drone has no confirmed sensor to stream. Confirm this as the drone's link protocol.
15. Missions: the drone runs only `hold` and `teleop`, like the dog; `search_cells`, `inspect`, and `return_home` are stored and logged. Should the orchestrator ever lease them to `drone1`? `inspect` includes a breathing check, which the root README says a hovering drone cannot do.
16. The dashboard shows `drone1` as an ordinary robot; the `robot` table carries dog terrain columns. How the dashboard should present a drone is for the dashboard's owner.
17. Demo coordinates: `backend/sim` has no drone yet, so `home` and the demo anchor are the site center and there are no waypoints.
18. Deployment on the drone's Pi: OS, systemd units, udev rules, and the wall clock sync that `observed_at` needs (the dog's R9 and clock items are open too).
19. This is a copy of the dog's code, not a shared library. Decide whether to factor the shared parts (state machine, gate, bridge client, localizer, bridge) into one place once both settle.
