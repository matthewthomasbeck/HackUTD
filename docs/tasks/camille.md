# Camille: robot edge software

Owner of the code that runs on the robot: the C++ program on the Pi, the Pico firmware, the Node.js bridge to SpacetimeDB, missions, thermal candidate detection, terrain rules, mecanum drive and legs (with Matthew), and the systemd setup.
Specs: `docs/specs/robot.md` (main spec), `docs/ROBOT.md` (architecture, state machine, safety rules, Pico protocol, working rules), `docs/specs/CONTRACTS.md` (bridge protocol, reducers the bridge calls, roles).
Overview and checkpoints: `docs/TASKS.md`.
Scope and sponsor priority: `docs/MVP.md` (FINAL, 2026-11-07).
Total with AI: about 15.5 h (each task 1 to 2 h with coding agents; hardware tasks are bench time, not typing).
Matthew owns the hardware; ask him for every TBD hardware value instead of guessing.

## How to read this file

- Every task keeps its ID (R0 to R9), its goal, and its "Estimate with AI" line.
- Each step in a checklist should take 10 to 20 minutes; if one takes longer, split it or ask for help in the team chat.
- Where `CONTRACTS.md` (FINAL, version 8) and `robot.md` disagree, `CONTRACTS.md` wins.
- Section numbers like "robot.md 6.4" point at `docs/specs/robot.md`.

## Current facts (do not design around anything else)

- The camera is a regular visible-light camera with no IR illuminators, so the breathing clip needs room light or a white light on the robot (hardware TBD).
- The robot has 4 mecanum wheels on legs; the servos move the legs with inverse kinematics; wheels first, legs as a stretch.
- The four FSRs on the ADS1115 are optional force sensors, not foot pads, and their meaning is TBD; terrain rules keep them off by default.
- No microphone and no speaker on the robot ("Robot bridge local protocol" in `CONTRACTS.md`); no `callout` message, no audio detections.
- No beacon mission (the `mission` table in `CONTRACTS.md`); mission kinds are `search_cells`, `inspect`, `return_home`, `hold`.
- GPS is a USB module read with `gpsd`; the venue is indoors, so the demo uses fixed demo coordinates.
- Missions come from the orchestrator (Nemotron, `backend/agent/`) or a coordinator through SpacetimeDB; the robot never talks to an agent.
- The robot's `participant.name` equals its `robot_id` (`dog1`).

## Working rules (from `docs/ROBOT.md` and robot.md section 0)

- Every device has an interface, a real implementation, and a mock; the whole program runs on a laptop with no hardware.
- Every hardware value lives in config with a placeholder and a `# TBD` comment; never hard-code an I2C address, baud rate, channel map, or dimension.
- Behaviors never touch hardware; they return commands, and only the safety gate passes commands to drivers.
- The main loop never blocks on I/O (Pico, camera, bridge socket, gpsd, disk, network).
- Prefer iterative code over recursive code (the blob flood fill uses an explicit stack).
- No agent can command motors; the only things that reach the robot from the network are `mission`, `cancel`, `site`, and the optional `terrain_hint`.
- Explain every change in the commit or PR body for a learning teammate, and trace one example through it.
- No em dashes in code, comments, docs, or commit messages.

## Start here (first hour, laptop only, every device mocked)

1. Toolchain and skeleton (first 20 minutes of R0).
   - [ ] Clone https://github.com/matthewthomasbeck/HackUTD and create a branch `robot-edge`.
   - [ ] Install the laptop dependencies from robot.md 3.1 (`cmake`, `yaml-cpp`, `nlohmann-json`, `googletest`, `ffmpeg`, Node 22, the `spacetime` CLI).
   - [ ] Paste the R0 agent prompt (below) into your coding agent and let it create the folders.
2. Unblock yourself on other people (10 minutes, in the team chat).
   - [ ] Send Matthew the M0 question list (`docs/tasks/matthew.md` M0) and ask him to answer the thermal camera model and the DC driver interface first, because they decide the most config keys.
   - [ ] Ask Cayden when the SpacetimeDB module skeleton and the bindings in `backend/spacetimedb-bindings/` will be published locally (C1).
   - [ ] Ask Eric for the media server URL and port (robot.md uses `http://localhost:8080`; E2).
3. Start the critical path (last 30 minutes).
   - [ ] Finish R0 so `./build/robot --config config/robot.laptop.yaml` runs and exits cleanly on Ctrl+C.
   - [ ] Start R1 with the pure `state_machine.step()` and its first three tests, since the state machine and safety gate are on the critical path (robot.md 17).

Suggested order after the first hour: R1, R2, R3 (checkpoint 1), then R6 and R5 on mocks (sponsor priority 3), then R4 when the Pico is wired, R8 when the motors are wired, R7, and R9.
Priority from `docs/MVP.md`: the find and breathing check (thermal detection, `inspect` with the 20 s clip, the detection message, the bridge) come before terrain tuning and the camera terrain hint.

## Hand-offs

| Checkpoint | Camille needs | From | Camille owes | To |
| --- | --- | --- | --- | --- |
| 0. Setup | The repo layout agreed (`raspberrypi/robot/`, `raspberrypi/bridge/`, `raspberrypi/system/`, `pico/`, `protocol/`) | Cayden | R0 skeleton pushed, so others can see the folder names | everyone |
| 0. Setup | M0 answers: thermal model and address, IMU model and address, DC driver model and interface, mecanum dimensions, encoders yes or no, LD19 and single LiDAR mounting, FSR meaning, GPS model, voltages and logic levels | Matthew | The list of every TBD key (robot.md 15.1) with what is still missing | Matthew |
| 1. Module and mocks | Module skeleton published locally with the robot reducers, generated bindings in `backend/spacetimedb-bindings/`, a demo-mode site so `register_participant(dog1, robot)` works without `grant_role` | Cayden (C1) | Mock robot heartbeat, position, device rows, and a fake detection visible in SpacetimeDB through the bridge (R3) | Cayden |
| 1. Module and mocks | Media server `POST /media` and `POST /breathing` running on the laptop | Eric (E2) | A mock 20 s MP4 clip (gray, H.264) uploaded by the bridge, so E2 is proven | Eric |
| 2. Whole flow with no robot | Demo coordinates in the `backend/sim/` config (`home`, `anchor`, each house) | Cayden (C3) | `config/scripts/demo_paths.yaml` using the same coordinates (robot.md 8.4) | Cayden |
| 3. Robot on the board | Devices wired with the udev names `/dev/servo45`, `/dev/servo25`, `/dev/dcmotorA`, `/dev/dcmotorB`, `/dev/pico`, `/dev/gps0` (M2); e-stop on actuator power (M1) | Matthew | `robot_diag` for each device, so Matthew can test wiring one device at a time | Matthew |
| 3. Robot on the board | Motor directions and wheel order from spinning each motor (M3); the white light or a decision to use room light (M4) | Matthew | Mecanum mixing that drives straight, strafes, and spins from config (R8) | Matthew |
| 3. Robot on the board | Range test results (M6), and a review of the thermal rule | Matthew, Eric | Thermal frames in the sensor log and `robot_diag thermal --replay` output for the range test (R6); real robot clips at the demo light level (E1, E3) | Eric |
| 4. End to end | Mock rubble set the robot can cross (M7); leg geometry and servo channel map (M5) | Matthew | Terrain rules and raw LD19, IMU, and force logs for tuning (R7); leg IK behind `ILegIK` if the geometry is ready (R8) | Eric, Matthew |
| 5. Demo ready | Rehearsal slots (C7) | Cayden | Cold start under 2 minutes twice (R9); the demo day checklist below run at each rehearsal | everyone |

## Common pitfalls (read once, then again when something is weird)

| Pitfall | What happens | Fix |
| --- | --- | --- |
| Blocking socket writes in the C++ bridge client | A slow or dead bridge freezes the main loop and the systemd watchdog kills the robot | Open the socket with `O_NONBLOCK`, write with `send()`, treat `EAGAIN` as "try next tick", keep the unsent tail of a partial write, and never loop until done |
| `SIGPIPE` when the bridge dies | The robot process exits silently on the next write | Ignore `SIGPIPE` at startup (`signal(SIGPIPE, SIG_IGN)`); on Linux also pass `MSG_NOSIGNAL`; on macOS set `SO_NOSIGPIPE` on the socket |
| Stale Unix socket file | The bridge fails to listen with `EADDRINUSE` after a crash | The bridge `unlink`s `BRIDGE_SOCKET` before `listen`; keep the path short (macOS limits socket paths to about 104 bytes) |
| SpacetimeDB enum spelling | A reducer rejects `safeStop` or `ready` | The module uses `CaseConversionPolicy.None`, so send the contract spelling exactly (`SAFE_STOP`, `partially_searched`, `search_cells`); build enum arguments in the shape the generated bindings demand (the module code uses `{ tag: 'READY' }`); in HTTP or CLI calls the shape is `{"READY":[]}` |
| u64 values in TypeScript | `JSON.stringify` throws on `bigint`, or ids are passed as numbers and the bindings reject them | Convert with `BigInt(x)` when calling reducers, and `Number(x)` in `to_wire.ts` when sending to the robot (ids stay below 2^53) |
| `observed_at` format | The JSON form of a `Timestamp` argument is NOT CONFIRMED (spacetimedb.md section 0) | The robot sends ISO 8601 UTC with a `Z` (for example `2026-11-08T14:03:12.345Z`); the bridge converts with `new Timestamp(BigInt(Date.parse(iso)) * 1000n)` (microseconds, tested in the SDK typings); confirm once against the real bindings |
| Pi clock wrong at boot | The Pi 4 has no real-time clock, so `observed_at` can be far off and the module rejects anything more than 5 s in the future or older than the run start | Make sure the Pi syncs time on the hotspot (`timedatectl` shows synchronized) before the demo; consider `After=time-sync.target` in the bridge unit |
| Reducer rejections retried forever | The spool never drains | Retry only network failures; a `SenderError` is logged and skipped (robot.md 9.2 and 9.7) |
| Pico serial in cooked mode | Binary frames get mangled (newline translation, echo, flow control) | On the Pi, open `/dev/pico` raw (`cfmakeraw`); on the Pico, turn off CRLF translation (`stdio_set_translate_crlf`, check your SDK version) or write through TinyUSB CDC directly |
| Blocking I2C on the Pico | A long thermal frame read starves the watchdog and the Pico resets | Use the timeout versions of the I2C calls (`i2c_read_timeout_us`), read the thermal sensor in chunks across superloop passes, and feed the watchdog once per pass |
| Degrees vs radians, and two angle conventions | The robot spins the wrong way or far too fast | `MotionCommand.wz_dps` is degrees per second counterclockwise; the mecanum formula needs rad/s; headings in messages are degrees clockwise from north (CONTRACTS.md conventions); convert in one helper in `geo.hpp` and test it |
| Zero placeholders in config | Divide by zero in the mecanum mixer when `wheel_radius_m` is 0 | Config validation marks `drive_only` as FAILED with "mecanum dimensions TBD" when any dimension is 0, instead of crashing |
| Type=notify service that never says READY | If the robot goes to FAULT at init, it never sends `READY=1`, and systemd kills it at the start timeout and restarts it in a loop | Decide with Cayden (propose in robot.md 18 if needed): either send `READY=1` once the loop starts in READY or FAULT, or set `TimeoutStartSec` long enough to see the fault in the logs |
| Init longer than `WatchdogSec` | Seven devices at up to 3 s each can exceed the 2 s watchdog | Measure on the Pi; if systemd kills during init, raise `WatchdogSec` or ping between device inits, and record the choice |
| Auto exposure during the clip | Auto exposure or white balance creates a fake periodic signal that looks like breathing | Lock exposure, gain, and white balance before recording (robot.md 12.2); check control names in `libcamera/control_ids.h` |
| `ffmpeg` dies mid-clip | Writes to its stdin raise `SIGPIPE` or block | Write from the clip writer thread only, ignore `SIGPIPE`, check `write()` errors, and mark the clip failed in the note |

---

## Phase 0: setup

### R0. Build setup

Owner of the C++ part (`raspberrypi/robot/` CMake, config, logger): Eric (2026-11-07), because R1 needs it.
The bridge and Pico skeletons stay with Camille.

Estimate with AI: 1 h.

Goal: one command builds and runs the robot program on a laptop with every device mocked, and the bridge and Pico projects build.

Why it matters: every other task, and checkpoint 1 ("the robot program runs on a laptop with mock devices"), stands on this.
It also proves the public repo (required to win the SpacetimeDB track) has a clean build.

Inputs and dependencies:
- The team repo layout (`raspberrypi/`, `pico/`, `backend/` already exist; `protocol/` is new).
- Nothing from teammates; the bridge can build before Cayden's bindings exist if the import is stubbed.

Outputs and who uses them:
- Folder skeleton and build files used by every later task.
- `raspberrypi/README.md` with build and run commands, used by Matthew and Cayden to run the robot on their laptops.

Files to create (robot.md section 2):
- `protocol/pico_link.h` (empty skeleton with the protocol version constant; filled in R2 and R4).
- `raspberrypi/robot/CMakeLists.txt`, `raspberrypi/robot/src/main.cpp`, `raspberrypi/robot/config/robot.yaml`, `raspberrypi/robot/config/robot.laptop.yaml`, `raspberrypi/robot/config/scripts/demo_paths.yaml`, `raspberrypi/robot/tests/test_config.cpp`, `raspberrypi/robot/src/core/config.hpp/.cpp`, `raspberrypi/robot/src/core/log.hpp/.cpp`.
- `raspberrypi/bridge/package.json`, `raspberrypi/bridge/tsconfig.json`, `raspberrypi/bridge/.env.example`, `raspberrypi/bridge/src/index.ts`.
- `pico/CMakeLists.txt`, `pico/src/main.cpp`.
- `raspberrypi/README.md`.
- A `.gitignore` entry for `build/`, `node_modules/`, `dist/`, `.env`, `.data/`.

Build and run commands (robot.md 3.2 to 3.4):

```
cd raspberrypi/robot
cmake -B build -DCMAKE_BUILD_TYPE=RelWithDebInfo
cmake --build build -j
ctest --test-dir build --output-on-failure
./build/robot --config config/robot.laptop.yaml

cd raspberrypi/bridge
npm install && npm run build && npm test

cd pico
cmake -B build -DPICO_SDK_PATH=<path> && cmake --build build
```

Config keys introduced: the whole robot.md section 15 file, with every TBD key present and commented; `robot.laptop.yaml` sets `mock: true` for every device, sockets and logs under `/tmp/robot/`, and `site.demo_mode_default: true`.

Checklist:
- [ ] 1. Create the folders and empty files above, and the `.gitignore` entries.
- [ ] 2. Write `CMakeLists.txt`: C++17, `-Wall -Wextra -Wpedantic`, find `yaml-cpp`, `nlohmann_json`, `Threads`, `GTest` (fall back to `FetchContent`), options `ROBOT_WITH_LIBCAMERA` and `ROBOT_WITH_SYSTEMD`, static library `robot_core`, executables `robot`, `robotctl`, `robot_diag`, test binary `robot_tests`.
- [ ] 3. Copy the robot.md section 15 config into `robot.yaml`, mark every TBD, and derive `robot.laptop.yaml` from it.
- [ ] 4. Write `config.cpp` to load and validate the file (types, ranges, `breathing.clip_s >= 15`), and make `main.cpp` print the loaded robot id and exit non-zero on an invalid config.
- [ ] 5. Write the three `test_config.cpp` tests below and get `ctest` green.
- [ ] 6. Create the bridge `package.json` (scripts `build`, `test`, `start`, `dev`, `upload-logs`; dependency `spacetimedb`), `tsconfig.json`, and `.env.example` with the keys from robot.md 9.2.
- [ ] 7. Create the Pico CMake project that builds an empty superloop with the watchdog, and check it builds if the Pico SDK is installed (skip on the laptop if not, and say so in the README).
- [ ] 8. Write `raspberrypi/README.md` with the commands above and test them from a fresh clone in a new folder.

Tests:
- `ConfigTest.LaptopConfigLoads`: `robot.laptop.yaml` loads and every device is mocked.
- `ConfigTest.ClipUnder15sRejected`: `breathing.clip_s: 10` fails validation with a clear message.
- `ConfigTest.MissingKeyNamesTheKey`: removing `loop.rate_hz` gives an error that names `loop.rate_hz`.

Done when: `README.md` in `raspberrypi/` lists the build and run commands, and they work on a fresh clone.

Agent prompt:

```
You are setting up the build for the robot edge software in the HackUTD team repo.
Read docs/specs/robot.md sections 0, 1, 2, 3, and 15, and docs/ROBOT.md "How to work on this repo".
Create only the skeleton for task R0:
- protocol/pico_link.h with a PICO_LINK_PROTOCOL_VERSION constant and a TODO for the frame codec.
- raspberrypi/robot/CMakeLists.txt exactly as robot.md 3.2 describes (C++17, warnings, yaml-cpp, nlohmann_json, Threads, GTest with FetchContent fallback, options ROBOT_WITH_LIBCAMERA and ROBOT_WITH_SYSTEMD, library robot_core, executables robot, robotctl, robot_diag, test binary robot_tests).
- raspberrypi/robot/src/main.cpp, src/core/config.hpp/.cpp, src/core/log.hpp/.cpp, tests/test_config.cpp.
- raspberrypi/robot/config/robot.yaml copied from robot.md section 15, and robot.laptop.yaml with every device mock: true, sockets and logs under /tmp/robot/, site.demo_mode_default: true.
- raspberrypi/robot/config/scripts/demo_paths.yaml from robot.md section 15, coordinates left at 0.0 with a TBD comment.
- raspberrypi/bridge/package.json, tsconfig.json, .env.example (keys from robot.md 9.2), src/index.ts that only logs "bridge starting".
- pico/CMakeLists.txt and pico/src/main.cpp with an empty superloop that calls watchdog_enable at boot and feeds it each pass.
- raspberrypi/README.md with build, test, and run commands.
Rules: every hardware value stays in config with a placeholder and a "# TBD" comment; never invent I2C addresses, baud rates, channel maps, or dimensions.
Config validation must reject breathing.clip_s below 15 and name any missing key.
Write the tests ConfigTest.LaptopConfigLoads, ConfigTest.ClipUnder15sRejected, ConfigTest.MissingKeyNamesTheKey.
No em dashes anywhere.
When done, explain what you created and why, and trace how main.cpp loads robot.laptop.yaml.
```

Pitfalls:
- `yaml-cpp` and `nlohmann-json` package names differ between Homebrew and apt; put both install lines in the README.
- On macOS, `libcamera` and `libsystemd` are missing; the two CMake options must default OFF there, and `sd_notify` must compile to a no-op.
- Do not copy the SpacetimeDB bindings into the bridge folder; import them from `../../backend/spacetimedb-bindings` (robot.md 3.3).

---

## Phase 1: build on mocks

### R1. State machine, safety gate, main loop

Owner: Eric (taken over from Camille on 2026-11-07).

Estimate with AI: 2 h.

Goal: the states BOOT, INIT, READY, ACTIVE, SAFE_STOP, FAULT, SHUTDOWN, with the loop order observe, step, behavior, safety gate, send, log, plus the local control socket and `robotctl`.

Why it matters: it is the safety core; it is what keeps "no agent can ever command motors" true, and every demo beat with the robot runs through it.
The `robot.state` column on the dashboard comes straight from this state machine.

Inputs and dependencies: R0.
No teammate inputs.

Outputs and who uses them:
- `state_machine` and `safety_gate` (pure functions) used by every later task.
- `robotctl` used by you, Matthew, and Cayden to start, stop, e-stop, and reset the robot during tests and the demo.

Files to create:
- `src/core/clock.hpp` (SteadyClock and FakeClock), `src/core/latest_slot.hpp`, `src/core/world.hpp`, `src/core/commands.hpp`.
- `src/state/state_machine.hpp/.cpp`, `src/state/safety_gate.hpp/.cpp`.
- `src/bridge/control_server.hpp/.cpp`, `tools/robotctl.cpp`.
- `src/main.cpp` (the fixed-rate loop).
- `tests/test_state_machine.cpp`, `tests/test_safety_gate.cpp`.

Config keys: `loop.rate_hz`, `loop.overrun_factor`, `loop.overrun_ticks`, `fault.max_retries`, `shutdown.timeout_ms`, `devices.required`, `devices.optional`, `stale_ms.*`, `pico.link_timeout_ms`, `limits.*`, `estop.sense`, `control.socket`, `missions.auto_start`.

Run:

```
./build/robot --config config/robot.laptop.yaml
./build/robotctl --socket /tmp/robot/control.sock status
./build/robotctl start hold
./build/robotctl estop
./build/robotctl reset
```

Checklist:
- [x] 1. Write `LatestSlot<T>` (mutex, value, steady-clock write time, `age(now)`), `Clock` with `FakeClock`, and a `WorldSnapshot` struct with the fields robot.md 4.3 needs.
- [x] 2. Write the state and event enums and the pure `step(state, snapshot, events)` returning next state, reason, and `latched`, with the transition table from robot.md section 5.
- [x] 3. Write one test per transition row, plus the latch, reset, retry, and SIGTERM tests below.
- [x] 4. Write `MotionCommand` and the pure `SafetyGate::filter(state, snapshot, output)` with the rules from robot.md 10.1 (terrain rules can be a stub until R7).
- [x] 5. Write the safety gate tests below.
- [ ] 6. Finish the main loop in `main.cpp`: the fixed rate, steps, overrun detection and summary exist, but logging can block the main loop. The 2026-11-08 completed-item audit reproduced a control timeout over 2 s with a full stderr pipe. Move blocking log output off the main loop before closing this step; see `docs/notes/2026-11-08-eric-completed-task-audit.md`.
- [x] 7. Write the control server (non-blocking Unix socket, NDJSON commands `start`, `stop`, `estop`, `reset`, `status`) and `robotctl`.
- [x] 8. Handle SIGTERM and SIGINT: raise the `sigterm` event, stop motion, then SHUTDOWN within `shutdown.timeout_ms`.
- [ ] 9. Run the scripted check below on mocks and paste the log into the PR.

Tests (GoogleTest, `FakeClock`, no hardware):
- `StateMachine.BootConfigValidGoesToInit`, `StateMachine.BootConfigInvalidGoesToShutdown`.
- `StateMachine.InitAllRequiredOkGoesToReady`, `StateMachine.InitOptionalDegradedStillReady`, `StateMachine.InitRequiredFailedGoesToFault`.
- `StateMachine.ReadyStartWithHealthOkGoesToActive`, `StateMachine.ReadyStartWithStaleSensorStaysReady`.
- `StateMachine.ActiveMissionDoneGoesToReady` (and the same for failed, cancelled, stop).
- `StateMachine.ActiveSafetyEventsGoToSafeStop` (parameterized over estop, stale_sensor, pico_link_lost, loop_overrun, command_out_of_limits).
- `StateMachine.EstopLatchSurvivesEveryEventExceptReset`, `StateMachine.ResetWhileSenseAssertedDoesNothing`.
- `StateMachine.FaultRetriesThenLatchedSafeStop`: after `fault.max_retries`, SAFE_STOP latched.
- `StateMachine.SigtermFromEveryStateEndsInShutdown`.
- `StateMachine.MissionInNonReadyStateRejected`: the output carries a `failed` progress with note `robot not ready: <state>`.
- `SafetyGate.ZeroOutsideActive`, `SafetyGate.ZeroOnEstop`, `SafetyGate.ZeroOnStaleRequiredSensor`, `SafetyGate.ZeroOnPicoLinkLost`, `SafetyGate.ZeroWhileClipRecording`.
- `SafetyGate.ClampsSpeedAndAcceleration`.
- `SafetyGate.NanOrHugeCommandRaisesOutOfLimits`: a NaN or a command over `limits.reject_factor` times the limit raises the event instead of being clamped.
- `SafetyGate.InterventionsLoggedOncePerSecond`.

Manual check: on mocks, `robotctl start hold` moves READY to ACTIVE, `robotctl estop` moves to SAFE_STOP latched, `robotctl reset` goes SAFE_STOP to FAULT to INIT to READY, and Ctrl+C ends in SHUTDOWN with exit code 0.

Done when: the tests pass on a laptop, and a scripted run on mocks goes BOOT to READY to ACTIVE to SAFE_STOP and back.

Agent prompt:

```
Implement task R1 for the robot program in raspberrypi/robot/.
Follow docs/specs/robot.md section 4 (startup, threads, main loop), section 5 (state machine), section 10.1 (safety gate), and 10.4 (e-stop), plus docs/ROBOT.md "State machine" and "Loop shape".
Create: src/core/clock.hpp (SteadyClock, FakeClock), src/core/latest_slot.hpp, src/core/world.hpp, src/core/commands.hpp, src/state/state_machine.hpp/.cpp, src/state/safety_gate.hpp/.cpp, src/bridge/control_server.hpp/.cpp, tools/robotctl.cpp, the loop in src/main.cpp, tests/test_state_machine.cpp, tests/test_safety_gate.cpp.
state_machine.step() and SafetyGate::filter() are pure: no I/O, no clock reads; time comes in the snapshot.
The main loop runs observe, step, behavior, safety gate, send, log in that order at loop.rate_hz, never blocks on I/O, detects overrun with loop.overrun_factor and loop.overrun_ticks, and only the gated output reaches motion.apply().
The control server is a non-blocking Unix socket at control.socket accepting NDJSON commands start, stop, estop, reset, status.
Every limit and timeout is a config key from robot.md section 15; do not hard-code numbers, and keep hardware values TBD.
Write one test per transition table row and the tests listed in docs/tasks/camille.md R1.
Prefer iterative code.
No em dashes.
When done, explain the change for a learning teammate and trace one estop from robotctl through the control server, the event list, step(), and the gate.
```

Pitfalls:
- Reading the clock inside `step()` makes tests flaky; pass `now` in the snapshot.
- Holding a `LatestSlot` mutex while copying a big thermal frame blocks the Pico reader; copy under the lock, process after.
- A SAFE_STOP that is not latched must still wait until motion is zero before FAULT (robot.md section 5).

### R2. Device layer with mocks

Estimate with AI: 1.5 h.

Goal: interfaces with a real and a mock version for each device: Maestros, DC drivers, Pico link, camera, GPS, light.
Every hardware value in the config file, marked TBD until Matthew confirms it.

Why it matters: it lets the whole robot run on a laptop for checkpoint 1, and lets Matthew swap in one real device at a time during bring-up (M2).

Inputs and dependencies:
- R0, R1.
- Matthew's M0 answers where they exist; until then, placeholders.

Outputs and who uses them:
- The HAL used by every behavior and by `robot_diag` (Matthew's bring-up tool).
- The Pi side of the Pico frame codec, which R4 shares through `protocol/pico_link.h`.

Files to create (robot.md section 2):
- `src/hal/device.hpp`, `servo_bus.hpp`, `servo_maestro.cpp`, `servo_mock.cpp`, `dc_driver.hpp`, `dc_driver_tbd.cpp`, `dc_driver_mock.cpp`, `pico_link.hpp`, `pico_link_serial.cpp`, `pico_link_mock.cpp`, `camera.hpp`, `camera_mock.cpp`, `gps.hpp`, `gps_gpsd.cpp`, `gps_mock.cpp`, `light.hpp`, `light_maestro_digital.cpp`, `light_mock.cpp`.
- `src/motion/motion.hpp`, `src/motion/motion_mock.cpp`.
- `protocol/pico_link.h` (frame header, message types, device ids, payload structs, CRC16, all PROPOSED values from robot.md 12.1).
- A device factory that reads `mock: true|false` per device.
- `tools/robot_diag.cpp` (one subcommand per device, mock or real).
- `tests/test_pico_frame.cpp`.

Config keys: `maestro_a.*`, `maestro_b.*`, `dc_driver_a.*`, `dc_driver_b.*`, `pico.*`, `camera.*`, `gps.*`, `light.*`, `init.device_timeout_ms`, `motion.impl`.

Checklist:
- [ ] 1. Write `IDevice` (`init()`, `status()`, `name()`) and `DeviceStatus {OK, DEGRADED, FAILED}` with a detail string.
- [ ] 2. Write the frame codec in `protocol/pico_link.h`: header `0xAA 0x55`, type, dev, length, payload, CRC-16/CCITT-FALSE, and a streaming parser that resyncs on bad CRC.
- [ ] 3. Write the `test_pico_frame.cpp` tests below.
- [ ] 4. Write `IPicoLink` with latest-value slots for IMU, thermal, ADS1115, single LiDAR, and LD19, then `pico_link_mock.cpp` with synthetic data and a warm-blob toggle.
- [ ] 5. Write `pico_link_serial.cpp`: raw termios on `pico.path`, reader thread, heartbeat writer at `pico.heartbeat_hz`, HELLO and VERSION handshake, INIT_DEV and DEV_STATUS collection.
- [ ] 6. Write `servo_maestro.cpp` with the compact Set Target command (`0x84, channel, target & 0x7F, (target >> 7) & 0x7F`, quarter microseconds) and `servo_mock.cpp`.
- [ ] 7. Write `dc_driver_tbd.cpp` that returns FAILED with "protocol TBD", and `dc_driver_mock.cpp` that records the last command per channel.
- [ ] 8. Write `camera_mock.cpp` (gray gradient plus a rectangle whose brightness follows a 0.25 Hz sine), `gps_gpsd.cpp` (TCP to `localhost:2947`, `?WATCH={"enable":true,"json":true};`, TPV objects, reconnect with backoff), `gps_mock.cpp` (fixed fix with an "indoors" toggle), and the light mock.
- [ ] 9. Write the factory and the INIT order (Maestro A, Maestro B, DC driver A, DC driver B, Pico, camera, GPS), each in a `std::async` task with `init.device_timeout_ms`.
- [ ] 10. Write `robot_diag` subcommands (`pico`, `thermal`, `imu`, `lidar_single`, `ld19`, `camera`, `gps`, `servo`, `motor`), and run the full program with all mocks.

Tests:
- `PicoFrame.EncodeDecodeEachMessageType`.
- `PicoFrame.CrcKnownAnswer`: CRC-16/CCITT-FALSE of `"123456789"` is `0x29B1`.
- `PicoFrame.ResyncAfterGarbage` and `PicoFrame.ResyncAfterCorruptedFrame`.
- `PicoFrame.RejectsOverMaxLength`: payloads over 4096 bytes are dropped and counted.
- `PicoFrame.SplitReadsAcrossBuffers`: a frame delivered one byte at a time still parses.
- `Devices.FactoryBuildsMockWhenMockTrue` and `Devices.InitTimeoutReturnsFailed` (a mock that sleeps past the timeout).
- `Devices.RequiredFailedSendsInitToFault` (wired through the state machine).
- `Gps.ParsesTpvMode3` and `Gps.IgnoresNonTpvClasses` (feed recorded gpsd JSON lines).

Manual check: `./build/robot --config config/robot.laptop.yaml` logs one OK status per device and reaches READY; changing one device to `mock: false` with a missing path gives FAILED for that device only, and READY or FAULT by `devices.required`.

Done when: the full program runs with all mocks, and swapping one mock for a real device is a config change.

Agent prompt:

```
Implement task R2, the device layer, in raspberrypi/robot/ and protocol/.
Follow docs/specs/robot.md sections 2 (file names), 4.1 (init order and timeouts), 12.1 (Pico link frame, message types, device ids, payloads, CRC-16/CCITT-FALSE), 12.2 (camera mock only; real libcamera comes later), 12.3 (light), 8.1 (gpsd protocol), and 12.4 (Maestro compact Set Target), plus docs/ROBOT.md "Pi to Pico protocol" and "Threading model on the Pi".
Create every file listed in docs/tasks/camille.md R2, a device factory keyed on each device's mock flag, and tools/robot_diag.cpp.
Every device gets an interface, a mock, and a real version; dc_driver_tbd.cpp returns FAILED with "protocol TBD" because the driver model is unknown.
Every path, baud rate, timeout, and channel is a config key; leave unknown values as placeholders with "# TBD"; never guess hardware facts.
Sensor data goes into LatestSlot values with timestamps; the reader threads never touch the main loop.
Open /dev/pico in raw mode (cfmakeraw) and never block the main loop.
Write the tests listed in R2 (frame codec, CRC known answer 0x29B1, resync, split reads, factory, init timeout, gpsd parsing).
No em dashes.
When done, explain the change and trace one IMU DATA frame from bytes to the WorldSnapshot.
```

Pitfalls:
- `std::async` with the default policy may run lazily; pass `std::launch::async` so the timeout works.
- A `std::future` from `std::async` blocks in its destructor; keep timed-out futures alive in a list instead of letting them block INIT.
- The Pico shows up as `/dev/ttyACM*` and the number can change; always use `/dev/pico` (udev, R9) or the `/dev/serial/by-id` path.

### R3. Bridge to SpacetimeDB

Estimate with AI: 2 h.

Goal: Node.js bridge using the SpacetimeDB TypeScript SDK and the robot's identity, the local socket protocol from `CONTRACTS.md`, spooling to the SD card when offline, media upload to Eric's media server.
Includes the C++ side (`bridge_client`, `messages`) and the localizer that fills `position` messages.

Why it matters: SpacetimeDB must power the primary functionality (SpacetimeDB track), and this is the only way the robot's finds reach the board, the agents, and the glasses.
The spool is what keeps "no one overlooked" true through a network drop.

Inputs and dependencies:
- Cayden's module published locally, and bindings in `backend/spacetimedb-bindings/` (C1); a site in demo mode so the `robot` role needs no `grant_role`.
- Eric's media server (`POST /media`, `POST /breathing`, E2); until it runs, uploads fail and the bridge still calls `report_detection` with no URLs.
- R1, R2.

Outputs and who uses them:
- `robot` row, `device_status` rows, positions, detections, cell marks, mission progress, and terrain fields in SpacetimeDB, used by Cayden's dashboard, the orchestrator, and the glasses.
- Uploaded clips posted to `/breathing`, used by Eric's breathing pipeline.

Files to create:
- C++: `src/bridge/bridge_client.hpp/.cpp`, `src/bridge/messages.hpp/.cpp`, `src/localization/localizer.hpp/.cpp`, `src/core/geo.hpp/.cpp`, `tests/test_bridge_client.cpp`, `tests/test_localizer.cpp`.
- Bridge: `src/index.ts`, `src/stdb.ts`, `src/local_socket.ts`, `src/mapping.ts`, `src/to_wire.ts`, `src/spool.ts`, `src/media.ts`, `src/missions.ts`, `test/mapping.test.ts`, `test/to_wire.test.ts`, `test/spool.test.ts`, `test/survivor_lookup.test.ts`.

Config keys:
- Robot: `bridge.socket`, `bridge.heartbeat_hz`, `bridge.position_hz`, `bridge.outbox`, `site.*`, `location.force_demo`, `home.*`, `heading.*`, `odometry.scale`.
- Bridge `.env`: `STDB_URI`, `STDB_DATABASE` (`assess-0hw81`), `ROBOT_ID` (`dog1`), `BRIDGE_SOCKET`, `MEDIA_URL`, `BRIDGE_TOKEN_FILE`, `SPOOL_FILE`, `SPOOL_MAX_MB`, `MEDIA_RETRIES`, `CLAIM_INTERVAL_MS`, `STDB_MODE`.

Run (robot.md 3.4):

```
spacetime start                      # or Cayden's command from specs/spacetimedb.md
cd raspberrypi/bridge && cp .env.example .env && npm run dev
cd raspberrypi/robot && ./build/robot --config config/robot.laptop.yaml
spacetime sql assess-0hw81 "SELECT * FROM robot"
```

Checklist:
- [ ] 1. C++ `messages.cpp`: build every robot-to-bridge message from robot.md 9.3 with `observed_at` (ISO 8601 UTC with `Z`) and `seq`, and parse `mission`, `cancel`, `site`, and `terrain_hint`, ignoring unknown types with a log line.
- [ ] 2. C++ `bridge_client.cpp`: non-blocking connect with backoff (0.5 s doubling to 5 s), `telemetry` queue (64, drop oldest) and `important` queue (256), partial writes kept, and `important` messages also appended to the outbox file and replayed on reconnect.
- [ ] 3. C++ localizer and `geo.cpp`: demo, GPS, indoor, and unknown modes, equirectangular offsets, and the location note (robot.md section 8).
- [ ] 4. Write the C++ tests below with a `socketpair`.
- [ ] 5. Bridge `local_socket.ts`: listen on `BRIDGE_SOCKET` (unlink first), one client at a time, NDJSON line parsing.
- [ ] 6. Bridge `stdb.ts`: connect with the builder from robot.md 9.2, save the token with mode 0600, print the identity hex, call `registerParticipant` with name `ROBOT_ID` and role `robot`, and subscribe to the six SQL queries in robot.md 9.2.
- [ ] 7. Bridge `mapping.ts` (pure): each local message to a reducer name and argument object, converting ids to `bigint`, enums to the contract spelling, and `observed_at` to a `Timestamp`.
- [ ] 8. Bridge `to_wire.ts` and `missions.ts`: forward `leased` missions once (dedupe by id), forward `cancelled` as `cancel`, send `site` on connect and change, and call `claimNextMission` every `CLAIM_INTERVAL_MS` only when connected, robot READY, no current mission, and the C++ client connected.
- [ ] 9. Bridge `media.ts`: upload each file with `POST {MEDIA_URL}/media` (field `file`, plus `run_id`, `robot_id`, `kind`), retry 1, 2, 4, 8 s, then `report_detection`, then find `survivor_id` by `client_ref` (wait up to 10 s), then `POST /breathing` with `clip_url`, `survivor_id`, `detection_id`.
- [ ] 10. Bridge `spool.ts`: append JSON lines while disconnected, `fsync` after detection, cell, and mission_progress, keep only the newest position, never spool heartbeats, replay in order on reconnect awaiting each call, skip rejections, truncate after replay, and cap at `SPOOL_MAX_MB` by dropping positions first.
- [ ] 11. Write the bridge tests below and run `npm test`.
- [ ] 12. Run the laptop end-to-end check below with Cayden's local module.

Tests:
- C++ `BridgeClient.NonBlockingWriteNeverStalls`: with the peer not reading, `poll()` returns within 1 ms.
- C++ `BridgeClient.TelemetryDropsOldest`, `BridgeClient.OutboxReplaysAfterReconnect`, `BridgeClient.UnknownTypeIgnored`.
- C++ `Localizer.GpsMode`, `Localizer.FixLossGoesIndoorWithOffset`, `Localizer.DemoModeUsesWaypoints`, `Localizer.UnknownModeOmitsLatLon`, `Geo.OffsetMathAtSiteScale`.
- `mapping.test.ts`: every message type gives the right reducer and arguments with `observed_at` passed through; unknown types rejected; `seq` stripped.
- `to_wire.test.ts`: bigint to number, optional to `null`, enum to its string, Timestamp to ISO.
- `spool.test.ts`: append, crash-safe reopen, ordered replay with original `observed_at`, rejection skipped, cap drops positions before detections.
- `survivor_lookup.test.ts`: the `client_ref` lookup finds `survivor_id`; `0` skips `/breathing`.

Manual check (robot.md 16.2 steps 4 and 7):
- Within 5 s of starting, the `robot` row for `dog1` is online with state `READY`, `device_status` rows exist for every device, and positions arrive at 1 Hz.
- `robotctl mock thermal_blob on` during a local inspect produces one `detection` row with media URLs that open.
- Stop SpacetimeDB for 60 s, restart it, and the spooled cells and detection arrive in order with their original `observed_at`.

Done when: heartbeat, position, and a fake detection appear on the dashboard (or in the SpacetimeDB CLI) from the mock robot, and a network drop followed by a reconnect delivers the spooled messages in order.

Agent prompt:

```
Implement task R3: the C++ bridge client and localizer in raspberrypi/robot/, and the Node.js bridge in raspberrypi/bridge/.
Follow docs/specs/robot.md sections 8 (location), 9.1 to 9.8 (bridge job, connection, local messages both ways, leasing, media and breathing, spool, tests), 10.2 (what keeps working when the network is down), and 11 only for the outbox path.
Follow docs/specs/CONTRACTS.md "Conventions", "Reducers", "Robot bridge local protocol", and "Media server" (FINAL, version 8: no callout, no beacon, no stale-area timer, no search agent).
Use the generated bindings from ../../backend/spacetimedb-bindings; check exact reducer and field spellings there; do not copy them.
Enums use the contract spelling exactly (the module sets CaseConversionPolicy.None); ids are bigint in reducer calls; observed_at arrives as ISO 8601 UTC and becomes a Timestamp in microseconds.
Do not retry a reducer that throws a SenderError; retry only network failures.
The bridge never reads agent_task and never sends anything to the robot except mission, cancel, site, and terrain_hint.
The C++ client never blocks: non-blocking socket, two bounded queues, partial writes kept, outbox file for important messages, ignore SIGPIPE.
Keep hardware values in config as TBD.
Create the files listed in docs/tasks/camille.md R3 and the tests listed there.
No em dashes.
When done, explain the change and trace one detection message from the C++ inspect step to report_detection and POST /breathing.
```

Pitfalls:
- `withAutomaticReconnect` behavior is UNCONFIRMED (robot.md 9.2); keep your own backoff loop for the first connect and test a real drop.
- Tokens are per server: keep separate token files for Maincloud and the local fallback, or the robot gets a new identity and loses its role.
- Positions are current state only ("Recording and replay" in `CONTRACTS.md`); replaying every spooled position wastes time, so send only the newest.
- Live messages that arrive during replay go to the end of the spool, not straight to SpacetimeDB, or order breaks.

### R4. Pico firmware

Estimate with AI: 2 h.

Goal: superloop with non-blocking tasks (link, thermal, ADS1115, single-point LiDAR, LD19, IMU), hardware watchdog, framing with CRC and heartbeat, version handshake.

Why it matters: the thermal camera is on the Pico, and it is how the robot finds a person in the dark (demo beat 2, sponsor priority 3).
The Pico heartbeat is also a safety input: losing it sends the robot to SAFE_STOP.

Inputs and dependencies:
- R2 (`protocol/pico_link.h`, the Pi-side parser).
- Matthew: Pico wired per the proposed pin map (M2), thermal and IMU models and addresses (M0).
- Thermal and IMU drivers stay stubs that report FAILED until the models are known.

Outputs and who uses them:
- Thermal frames, IMU, LiDAR, and FSR data on the Pi, used by R6, R7, and R5.
- `robot_diag pico` output, used by Matthew during bring-up.

Files to create (robot.md section 2 and 13):
- `pico/src/main.cpp`, `pico/src/link.c/.h`, `pico/src/tasks/imu.c`, `thermal.c`, `ads1115.c`, `lidar_single.c`, `ld19.c` (one `poll()` each), `pico/test/` (host-side test of `link.c`).
- A `pico/src/pins.h` or config header with every pin and address, PROPOSED and TBD values marked.

Build and flash:

```
cd pico
cmake -B build -DPICO_SDK_PATH=<path>
cmake --build build
# hold BOOTSEL, plug in, copy build/*.uf2 to the RPI-RP2 drive
cd ../raspberrypi/robot && ./build/robot_diag pico
```

Values (from `docs/ROBOT.md`, PROPOSED): LD19 on UART0 (GP0, GP1) at 230400, single LiDAR on UART1 (GP4, GP5) at 115200 default, thermal alone on I2C0 (GP8, GP9), IMU and ADS1115 (0x48) on I2C1 (GP2, GP3).
Thermal address, IMU address, and the single LiDAR model are TBD.

Checklist:
- [ ] 1. Superloop on core 0 with `watchdog_enable()` at boot and one feed per pass; a loop-time counter sent in the heartbeat payload for debugging.
- [ ] 2. `link.c`: USB CDC binary I/O with CRLF translation off, frame encode and streaming decode using `protocol/pico_link.h`, HELLO answered with VERSION, heartbeat at about 20 Hz.
- [ ] 3. Host test in `pico/test/` that compiles `link.c` natively and checks frames against the Pi parser.
- [ ] 4. INIT_DEV handling that calls each task's `init()` and answers DEV_STATUS with OK, DEGRADED, or FAILED and a detail string.
- [ ] 5. UART IRQ ring buffers for UART0 and UART1.
- [ ] 6. `ld19.c`: parse packets per the LD19 datasheet (verify the format first), batch one revolution, send one DATA frame.
- [ ] 7. `lidar_single.c`: parse the model's frame (model TBD, start with the TF-Luna style format and mark it TBD), send `dist_mm` and `strength`.
- [ ] 8. `ads1115.c`: read A0 to A3 at address 0x48 with I2C timeouts, send `raw[4]`.
- [ ] 9. `imu.c` and `thermal.c` as stubs that report FAILED with "model TBD"; fill them in when Matthew names the parts (thermal: the Pico does the vendor calibration math and sends `centi_deg_c`).
- [ ] 10. On the Pi, run `robot_diag pico`, then unplug the Pico while the robot is ACTIVE on a test mission and confirm SAFE_STOP.

Tests:
- Host `LinkTest.FrameRoundTripMatchesPiParser`: frames from `link.c` decode with the Pi codec.
- Host `LinkTest.HeartbeatSeqIncrements`.
- Host `Ld19Test.ParsesRecordedPacket`: one recorded packet from the datasheet example (or a capture) gives the expected angles and distances.
- Host `RingBufferTest.WrapsWithoutLoss`.
- Pi `PicoLink.HeartbeatTimeoutRaisesLinkLost` (mock serial with no heartbeats for `pico.link_timeout_ms`).

Manual check:
- `robot_diag pico` shows VERSION, heartbeats both ways, and a DEV_STATUS per device.
- `robot_diag thermal` prints an ASCII frame and a hand at 1 m shows a blob (once the thermal driver exists).
- `robot_diag imu` shows gyro near 0 at rest; `robot_diag ld19` and `robot_diag lidar_single` show sane ranges.
- Unplugging the Pico during ACTIVE gives SAFE_STOP within `pico.link_timeout_ms` plus one tick.

Done when: the Pi reads live thermal frames, LiDAR, and IMU from the Pico at the expected rates, and unplugging the Pico sends the robot to SAFE_STOP.

Agent prompt:

```
Implement task R4, the Pico firmware in pico/, using the Pico C SDK (no FreeRTOS).
Follow docs/ROBOT.md "Pico side", "Pin map (Pico)", and "Pi to Pico protocol", and docs/specs/robot.md sections 12.1 (frame, types, device ids, payloads, CRC-16/CCITT-FALSE, little-endian) and 13.
Use protocol/pico_link.h for every constant and the CRC; do not redefine them.
Superloop on core 0, each device task a non-blocking poll() driven by timers and UART IRQ ring buffers; watchdog_enable at boot and one feed per pass; I2C calls with timeouts.
USB CDC must carry raw binary (turn off CRLF translation; check the SDK version).
Answer HELLO with VERSION, INIT_DEV with DEV_STATUS, send HEARTBEAT at about 20 Hz, and send parsed values, except LD19 scans batched per revolution.
The thermal camera, IMU, and single-point LiDAR models are TBD: put every address, pin, and baud rate in pico/src/pins.h marked TBD, and make the thermal and IMU drivers stubs that report FAILED with "model TBD".
Verify the LD19 packet format against its datasheet before writing the parser and cite the page in a comment.
Create the files listed in docs/tasks/camille.md R4, a host-side test in pico/test/ that compiles link.c natively, and the tests listed there.
No em dashes.
When done, explain the change and trace one LD19 revolution from UART bytes to the DATA frame the Pi receives.
```

Pitfalls:
- The Grid-EYE output takes about 15 s to stabilize after power-up (robot.md 7.5); if that is the sensor, report DEGRADED until then.
- A 32x24 thermal frame is 1536 bytes of temperatures plus header, well under the 4096-byte max, but do not grow the max without bumping the protocol version on both sides.
- Bump the protocol version constant on any frame change, or the Pi will count a mismatch as FAILED (which is the point).

---

## Phase 2: missions and integration

### R5. Missions from the orchestrator

Estimate with AI: 2 h.

Goal: `search_cells` (scripted path, thermal scan, mark cells, `partially_searched` when the view is blocked), `inspect` (stop, hold still, 20 s clip with locked exposure, stills, detection), `return_home`, `hold`.

Why it matters: this is demo beats 2 to 4 (the robot drives in, stops at the warm body, records about 20 seconds, a survivor appears) and the robot's part of the agent hand-off chain (the orchestrator creates the mission, the robot reports the find).
Marking blocked cells `partially_searched`, never `searched`, is part of "no one is overlooked" (State Farm).

Inputs and dependencies:
- R1, R2, R3, and R6 (the thermal detector).
- Missions created by the orchestrator (Eric's E7) or a coordinator on Cayden's dashboard (C2), leased by the bridge.
- Demo coordinates from `backend/sim/` (C3) for `demo_paths.yaml`.
- Eric's breathing pipeline (E3) to accept the clip; light for the camera (M4).

Outputs and who uses them:
- `mission_progress`, `cell`, and `detection` messages, used by the module, the orchestrator, the dashboard, and the glasses.
- The 20 s MP4 clip, used by Eric's `/breathing`.

Files to create:
- `src/mission/mission.hpp`, `src/mission/mission_runner.hpp/.cpp`, `src/mission/behaviors/behavior.hpp`, `idle.cpp`, `follow_path.cpp`, `scan.cpp`, `inspect.cpp`, `search_cells.cpp`, `return_home.cpp`, `hold.cpp`.
- `src/hal/camera_libcamera.cpp` (real camera, compiled with `ROBOT_WITH_LIBCAMERA`), `src/recorder/clip_writer.hpp/.cpp`, `third_party/stb_image_write.h`.
- `tests/test_mission_runner.cpp`.
- `config/scripts/demo_paths.yaml` filled with the demo coordinates.

Config keys: `missions.*`, `scan.*`, `inspect.*`, `breathing.clip_s`, `nav.*`, `hold.*`, `camera.width`, `camera.height`, `camera.clip_fps`, `light.*`, `media_dir`, `paths_file`.

Run on mocks:

```
./build/robotctl start search_cells
./build/robotctl mock thermal_blob on
./build/robotctl status
```

Checklist:
- [ ] 1. `mission.hpp`: parse the mission JSON into the `Mission` struct and validate it (robot id, kind is one of the four, 1 to `missions.max_cells` cells, target present for `inspect`, target distance limits); reject with `failed` and `rejected: <why>`.
- [ ] 2. `mission_runner`: own one mission at a time, send `active` on accept, `done` or `failed` on finish, nothing for id 0 or for a cancelled mission, and `failed` with `safe stop: <reason>` if SAFE_STOP interrupts.
- [ ] 3. `follow_path.cpp` and `GoTo`: load `demo_paths.yaml`, match by end waypoint within `nav.match_radius_m` or by cell label, run `drive`, `turn_to`, `stop`, and `scan` steps through `IMotion`, and stop when the single LiDAR reads under `nav.min_clearance_m`.
- [ ] 4. `scan.cpp`: `still` or `rotate` mode, run the detector on each new frame, return the best confirmed candidate, and keep the coverage tracker (`fresh_frac`, `clear_frac`).
- [ ] 5. `search_cells.cpp`: the sub-states from robot.md 6.3, dedupe candidates by bearing and range, the coverage rule for `searched` vs `partially_searched`, and the cancel rule.
- [ ] 6. `inspect.cpp`, part 1: APPROACH, SETTLE (gyro below `inspect.still_gyro_dps` for `inspect.settle_s`), CONFIRM (thermal over `thermal.confirm_s`).
- [ ] 7. `inspect.cpp`, part 2: STILLS (false-color thermal PNG and camera JPEG), CLIP (light on, lock exposure, gain, and white balance, record `breathing.clip_s` seconds), REPORT (one `detection` message with `client_ref` and three paths), then unlock and light off.
- [ ] 8. `clip_writer.cpp`: spawn `ffmpeg` with the command from robot.md 12.2 and write Y planes from its own thread.
- [ ] 9. `return_home.cpp` and `hold.cpp` per robot.md 6.5 and 6.6.
- [ ] 10. Write the `test_mission_runner.cpp` tests below.
- [ ] 11. `camera_libcamera.cpp` on the Pi: one stream, Y plane to the latest frame slot, still capture, and the control lock; check names in `libcamera/control_ids.h`.
- [ ] 12. Laptop end to end: create a `search_cells` mission for two cells from the dashboard or `spacetime call`, turn the mock blob on during the second cell, and check the result in SpacetimeDB.
- [ ] 13. On the robot: record one clip of a teammate in the demo light, and send it to Eric.

Tests:
- `MissionRunner.SearchCellsMarksInOrder`: two cells go `searching` then `searched` in order, and the mission ends `done`.
- `MissionRunner.SearchInspectsMockBlobOnce`: one detection with a clip path, not one per frame.
- `MissionRunner.BlockedViewMarksPartiallySearched`: mock LD19 sectors under `scan.min_view_m` give `partially_searched` with a note.
- `MissionRunner.ScanFromOutsideIsAtMostPartial`: `reached_cell = false` never gives `searched`.
- `MissionRunner.CancelAfterScanStartedMarksPartial`, `MissionRunner.CancelBeforeScanSendsNothing`.
- `MissionRunner.ThermalStaleWholeScanFailsAndDoesNotMark`.
- `MissionRunner.InspectNoBlobEndsDoneWithNote`: note `no warm blob confirmed`.
- `MissionRunner.ClipZeroesMotion`: the gate output is zero for the whole clip.
- `MissionRunner.BeaconKindRejected`, `MissionRunner.TargetFiveKmAwayRejected`, `MissionRunner.WrongRobotIdRejected`.
- `MissionRunner.ReturnHomeFailsWithNoPath`: note `no scripted path to target`.
- `MissionRunner.HoldRunsUntilCancel`.
- `MissionRunner.SafeStopSendsFailedProgress`.

Manual check (robot.md 16.2 steps 5, 6, 11, 12):
- The mission goes `leased`, `active`, `done`; cells go `searching` then `searched`; one `detection` row has three media URLs that open; a `survivor` row exists; perception got a 20 s clip on `/breathing` and wrote `report_breathing`.
- A mission with an unknown kind and one with a target 5 km away are both rejected with `failed` notes.
- An orchestrator mission is leased by `dog1` and runs; with `require_mission_approval` true it waits as `proposed` until a coordinator approves.

Done when: a mission created on the dashboard runs on the real robot and reports `done`, and an inspect mission produces a breathing clip that Eric's service accepts.

Agent prompt:

```
Implement task R5, the mission runner and behaviors, in raspberrypi/robot/.
Follow docs/specs/robot.md sections 5 (mission events when not ACTIVE), 6.0 to 6.6 (mission sources, intake and validation, GoTo, FollowPath, Scan, search_cells with the coverage rule, inspect, return_home, hold), 12.2 (camera, still, clip lock, ffmpeg clip writer), 12.3 (light), and 10.1 (clip recording zeroes motion).
Missions come from the orchestrator or a coordinator through the bridge; there is no search agent and no beacon mission (CONTRACTS.md version 8).
Mission kinds are exactly search_cells, inspect, return_home, hold; anything else is rejected.
A mission never carries speeds, poses, joint angles, or durations that reach motors; speed and limits come only from config.
Behaviors return commands and never touch hardware; only the safety gate passes commands on.
The camera is a regular visible-light camera; lock exposure, gain, and white balance before the clip and check control names in libcamera/control_ids.h; camera_libcamera.cpp compiles only with ROBOT_WITH_LIBCAMERA.
Every threshold (scan, inspect, nav, coverage, clip length) is a config key from robot.md section 15; keep hardware values TBD.
Create the files listed in docs/tasks/camille.md R5 and the tests listed there, using mocks and FakeClock.
No em dashes.
When done, explain the change and trace one search_cells mission from the bridge's mission message to the cell, detection, and done messages.
```

Pitfalls:
- An `inspect` in a dark set fails the breathing check without light; test at the booth's real light level (demo.md "Booth setup").
- Stop motion before CONFIRM; the per-frame median background is for moving, background subtraction is for standing still (robot.md 7.2).
- `client_ref` must be unique across reboots (`<robot_id>-<boot_id>-<seq>`), or two detections get the same media file names.
- The mock camera's 0.25 Hz brightness sine is a fake 15 breaths per minute; perception should read about 15 on it end to end.

### R6. Thermal candidate detection

Estimate with AI: 1 h.

Goal: warm, person-size blob above background, every threshold a config value; tune with Matthew and Eric's range test.
Includes the false-color render and the raw thermal log for replay.

Why it matters: it is how the robot finds a person in the dark (demo beat 2, sponsor priority 3), and its `thermal_confidence` feeds the critical score.
It must never claim a blob is a person; it reports a warm, person-sized shape with a confidence.

Inputs and dependencies:
- R2 (thermal slot from the mock or the Pico), R4 for real frames.
- Matthew: thermal model, resolution, and field of view (M0); range test with Eric (M6); `thermal.mask` and `yaw_offset_deg` from frames on the robot.

Outputs and who uses them:
- Candidates for R5, `max_temp_c` and `thermal_confidence` on the detection, a false-color PNG for the dashboard.
- `thermal.bin` logs and `robot_diag thermal --replay` output for the range test (Eric, Matthew).

Files to create:
- `src/perception/thermal_detector.hpp/.cpp`, `src/perception/thermal_render.hpp/.cpp`, `src/recorder/sensor_log.hpp/.cpp` (thermal and LD19 binary logs, CSV for IMU, single LiDAR, and force, `messages.jsonl`, `manifest.json`), `tests/test_thermal_detector.cpp`.
- `robot_diag thermal --replay <file>` subcommand.

Config keys: `thermal.*` (width, height, fov_h_deg, yaw_offset_deg, delta_c, min_c, max_c, min_blob_px, max_blob_frac, person_width_m, size_tolerance, persist_frames, persist_window, persist_px, confirm_s, confirm_min_frames, contrast_full_c, render_scale, mask), `recorder.*`.

Checklist:
- [ ] 1. Per-frame rule from robot.md 7.1: mask, median background, hot pixel test, 4-connected blobs with an explicit-stack flood fill, size check, blob stats.
- [ ] 2. LiDAR size check with `expected_px(r)` when the single LiDAR is fresh and aligned (alignment TBD, behind a config flag).
- [ ] 3. Persistence over `thermal.persist_window` frames, background subtraction when still, bearing math (robot.md 7.2 and 7.3), and the confidence formula (robot.md 7.4), logging every input.
- [ ] 4. `thermal_render`: false-color PNG with nearest-neighbor upscale by `thermal.render_scale`.
- [ ] 5. `sensor_log`: per-boot folder, `thermal.bin` records, bounded queue, drop and count when full, `recorder.max_gb` cap.
- [ ] 6. Write the tests below, then the replay subcommand.
- [ ] 7. Range test with Matthew and Eric (robot.md 7.5): 0.5, 1, 2, 3, 4 m, uncovered, under a blanket, partly behind boxes, lights off, 30 s each; set thresholds from the replay output and record the table where M6 says (`docs/specs/perception.md`).

Tests:
- `ThermalDetector.NoBlobInUniformFrame`, `ThermalDetector.OneBlobFound`, `ThermalDetector.TooSmallBlobRejected`, `ThermalDetector.TooHotBlobRejected` (above `max_c`), `ThermalDetector.MaskedBlobIgnored`, `ThermalDetector.TwoBlobsBothReported`.
- `ThermalDetector.PersistenceNeedsKofN`: a blob in 2 of 5 frames is not a candidate; in 3 of 5 it is.
- `ThermalDetector.ConfidenceMonotonicInContrast`.
- `ThermalDetector.BearingMath`: a blob centered in the right half gives a positive offset matching the formula.
- `ThermalDetector.FloodFillIsIterative`: a frame where every pixel is hot does not overflow the stack.
- `SensorLog.DropsWhenQueueFull`: the counter goes up and the caller never blocks.

Manual check: with the real sensor, a teammate at the tested distance gives a candidate in 3 tries, and a warm laptop at the same distance gives none (add a `thermal.mask` rectangle or raise `min_blob_px` if needed).

Done when: the robot stops for a teammate at the tested distance, and does not stop for a warm laptop in three tries.

Agent prompt:

```
Implement task R6, thermal candidate detection, in raspberrypi/robot/.
Follow docs/specs/robot.md section 7 (7.1 per-frame rule, 7.2 confirmation over time, 7.3 bearing, 7.4 confidence, 7.5 range test) and section 11 (raw sensor logs).
Create src/perception/thermal_detector.hpp/.cpp, src/perception/thermal_render.hpp/.cpp, src/recorder/sensor_log.hpp/.cpp, tests/test_thermal_detector.cpp, and a "thermal --replay <file>" subcommand in tools/robot_diag.cpp.
The thermal sensor model is TBD: frame width, height, field of view, and every threshold come from the thermal.* config keys; do not hard-code any of them.
Use an iterative flood fill with an explicit stack, never recursion.
The detector reports a warm, person-sized shape with a confidence; it never claims a person.
Log every input to the confidence formula with each detection.
The sensor log never blocks the main loop: bounded queue, drop and count when full.
Write the tests listed in docs/tasks/camille.md R6.
No em dashes.
When done, explain the change and trace one synthetic 32x24 frame with a 4 C warm blob through mask, background, hot pixels, blobs, size check, and confidence.
```

Pitfalls:
- The robot's own Pi and motor drivers show up warm; mask them, do not raise `delta_c` until a person disappears.
- Thermal cannot see through boxes, glass, or blankets; the demo leaves the chest or back in line of sight (demo.md).
- `min_c` and `max_c` are placeholders, not physiological facts; set them from the range test only.

### R7. Terrain rules

Estimate with AI: 1.5 h.

Goal: classes flat, debris, step, gap, blocked, unknown from LD19, single-point LiDAR, and IMU; actions continue, slow, steer, stop; reported (rate-limited) over the bridge.

Why it matters: terrain recognition is a should-have that judges can see (the terrain marker beside the robot changes to debris in demo.md), and it keeps the robot from driving off a drop.
It is sponsor priority below the find and breathing check, so build it after R5 and R6 work on mocks.

Inputs and dependencies:
- R1 (gate hook), R2 (LD19, single LiDAR, and IMU slots), R3 (terrain messages).
- Matthew: LD19 and single LiDAR mounting height and direction (`terrain.lidar_single_mode`, `ground_range_m`), `terrain.max_step_m`, FSR meaning (optional, off by default), the mock rubble set (M7).
- Eric: owns terrain tuning overall and the optional camera hint (E9).

Outputs and who uses them:
- `snapshot.terrain` used by behaviors and the safety gate.
- `report_terrain` updates on the `robot` row, used by the dashboard and the orchestrator.

Files to create: `src/terrain/terrain.hpp`, `terrain_rules.cpp`, `terrain_mock.cpp`, `terrain_hint.hpp/.cpp`, `terrain_reporter.cpp`, `tests/test_terrain.cpp`, a `robot_diag terrain` subcommand, and `robotctl mock terrain <class>`.

Config keys: every `terrain.*` key in robot.md section 15, including `terrain.impl`, `terrain.use_force: false`, and `terrain.camera_hint.enabled: false`.

Checklist:
- [ ] 1. Write the `TerrainClass`, `TerrainAction` (C++ `kContinue`, wire `continue`), and `TerrainAssessment` types and the `ITerrainAssessor` interface from robot.md 7b.1.
- [ ] 2. Write rules 1 to 3 (blocked with steer or stop, gap, tilt limit) in order, first match wins.
- [ ] 3. Write rules 4 to 7 (step, debris, flat, unknown), the confidence math, missing-input penalties, and hysteresis that delays class changes but never a stop.
- [ ] 4. Hook terrain into the safety gate: `safety_stop` zeroes translation (rotation allowed only for blocked with a clear side), `slow` caps speed.
- [ ] 5. Write `terrain_reporter`: send on change, at most `terrain.report_max_hz`, keep-alive while moving, `important` queue only for `stop`.
- [ ] 6. Write the terrain hint slot (disabled by default) that can only make the action more cautious and never clears a safety stop.
- [ ] 7. Write the tests below and the `terrain` mock commands.
- [ ] 8. On the mock rubble with Eric and Matthew: drive slowly at a box, a 3 to 5 cm step, a gap, and loose debris; check `robot_diag terrain`; tune from the raw logs.

Tests:
- `Terrain.BlockedWithClearSideSteers`, `Terrain.BlockedWithNoClearSideStops`.
- `Terrain.GapIsSafetyStop`, `Terrain.TiltOverLimitIsStepStop`.
- `Terrain.SmallStepSlows`, `Terrain.BigStepStops`, `Terrain.DebrisSlows`, `Terrain.FlatContinues`, `Terrain.AllInputsMissingIsUnknown`.
- `Terrain.HysteresisDelaysClassChangeButNotStop`.
- `Terrain.ReporterSendsOnChangeAtMostOneHz`.
- `Terrain.StaleCameraHintIgnored`, `Terrain.FreshHintOnlyMoreCautious`, `Terrain.HintNeverClearsSafetyStop`.
- `Terrain.GateZeroesTranslationOnStopEvenIfBehaviorDrives`.
- `Terrain.ForceSensorsIgnoredWhenUseForceFalse`.

Manual check (robot.md 16.2 step 10): `robotctl mock terrain blocked` during a drive step stops the robot, the `robot` row reads `blocked` with action `stop`, and one `terrain` event appears; `robotctl mock terrain debris` gives `slow` and one more event, not one per tick.

Done when: the robot slows on debris and stops before a drop on the mock rubble set.

Agent prompt:

```
Implement task R7, the rule-based terrain assessor, in raspberrypi/robot/.
Follow docs/specs/robot.md section 7b (7b.1 interface, 7b.2 inputs, 7b.3 rules in order, 7b.4 how behaviors and the safety gate use it, 7b.5 optional camera hint, 7b.6 reporting) and section 10.1 for the gate hook.
Spell classes and actions as in CONTRACTS.md (flat, debris, step, gap, blocked, unknown; continue, slow, steer, stop); the C++ enum value for continue is kContinue.
report_terrain updates only the robot's latest terrain fields (the robot table in CONTRACTS.md version 8); there is no terrain history table.
The FSR force sensors are not foot pads and their meaning is TBD: keep terrain.use_force false and never treat them as ground contact.
Mounting, ground range, and max step are TBD from Matthew: keep them as config keys with placeholders.
assess() is pure on the WorldSnapshot with no I/O; a terrain stop is not a state machine fault.
The camera hint is disabled by default and may only make the action more cautious; it never clears a safety_stop.
Create the files listed in docs/tasks/camille.md R7 and the tests listed there.
No em dashes.
When done, explain the change and trace one LD19 scan with a box 0.2 m ahead through the rules, the gate, and the reporter.
```

Pitfalls:
- LD19 angles are in the sensor frame; the forward sector depends on how Matthew mounts it, so add a `terrain` mounting yaw if needed and mark it TBD rather than rotating in code.
- Gyro noise at rest can look like debris; measure the noise with `robot_diag imu` before setting `bump_gyro_dps`.
- Reporting every tick floods the bridge; the reporter, not the assessor, owns the rate limit.

### R8. Mecanum drive and legs (with Matthew)

Estimate with AI: 2 h.

Goal: mixing matrix for mecanum drive first; leg IK behind its interface as a stretch.

Why it matters: the robot driving into the mock rubble is demo beat 2, and wheels are a must-have; legs that raise the body or step are a could-have.

Inputs and dependencies:
- R1, R2, and a real DC driver protocol (model and interface TBD from Matthew; `dc_driver_tbd.cpp` stays FAILED until then).
- Matthew: wheel radius, half track, half wheelbase, wheel order, motor directions (M3); leg geometry, servo count per leg, channel map, servo limits (M5); Maestros in UART mode (M2).

Outputs and who uses them:
- `motion_drive_only` used by every mission behavior.
- `ILegIK` and `motion_legged` (stretch) used by Matthew's leg tests.

Files to create: `src/motion/motion_drive_only.cpp`, `src/motion/leg_ik.hpp`, `leg_ik_mock.cpp`, `leg_ik_2link.cpp`, `motion_legged.cpp`, `tests/test_motion.cpp`, `robot_diag motor`, `robot_diag drive`, `robot_diag servo`, `robot_diag stance` subcommands.

Config keys: `motion.impl`, `motion.drive_only.hold_stance`, `motion.mecanum.*` (wheel_radius_m, half_track_lx_m, half_base_ly_m, wheel_order, invert, max_wheel_rad_s), `dc_driver_a.*`, `dc_driver_b.*`, `legs.*`, `servos.*`, `limits.*`, `safe_stop.servo_action`.

Checklist:
- [ ] 1. Write the mecanum mixer from robot.md 12.4 (eq. 20), with `wz` converted from deg/s to rad/s, scaling that keeps direction when a wheel saturates, and `wheel_order` and `invert` applied.
- [ ] 2. Write the `test_motion.cpp` mixer tests below.
- [ ] 3. Make `drive_only` report FAILED with "mecanum dimensions TBD" while any dimension is 0.
- [ ] 4. With Matthew: fill the DC driver protocol from the real datasheet in `dc_driver_tbd.cpp` (rename once known), with the serial timeout enabled if the model supports it.
- [ ] 5. With Matthew, wheels off the ground and e-stop in hand: `robot_diag motor A1 0.1` for each motor, then set `invert` and `wheel_order`.
- [ ] 6. On the floor: `robot_diag drive vx 0.1`, `vy 0.1`, and `wz 20` must drive straight, strafe, and spin in place; fix with config only.
- [ ] 7. Calibrate `odometry.scale` by driving 2 m and measuring.
- [ ] 8. Stretch: `leg_ik_mock`, then `leg_ik_2link` with geometry from config, every output clamped and rate-limited by the gate, and translation zero while a leg is lifted.
- [ ] 9. Stretch, robot on a stand: `robot_diag servo <ch> <us>` one channel at a time within limits, then `robot_diag stance <height>`.

Tests:
- `Mecanum.PureVxAllWheelsSameSign`, `Mecanum.PureVyAlternatesSigns`, `Mecanum.PureWzOpposesSides` (all checked against eq. 20).
- `Mecanum.SaturationKeepsDirection`.
- `Mecanum.WheelOrderAndInvertApplied`.
- `Mecanum.ZeroDimensionsReportFailed`.
- `Mecanum.WzDegreesConvertedToRadians`.
- `LegIK.MockRecordsStanceAndLift`, `LegIK.TwoLinkUnreachableReturnsFalse`, `LegIK.TwoLinkKnownPoseMatchesLawOfCosines`.
- `SafetyGate.ZeroTranslationWhileLegLifted`, `SafetyGate.ServoClampedAndRateLimited`.

Manual check: on the demo area floor, a scripted `drive`, `turn_to`, `drive` path from `demo_paths.yaml` ends within a hand's width of the mark twice in a row, and the e-stop stops all motors from the power cut.

Done when: drive works from missions; legs raise the body for clearance if Matthew's geometry is ready.

Agent prompt:

```
Implement task R8, mecanum drive and the leg IK interface, in raspberrypi/robot/.
Follow docs/specs/robot.md sections 12.4 (IMotion, MotionCommand, the mecanum inverse kinematics eq. 20, scaling, wheel_order and invert, the floor check), 12.5 (ILegIK, leg_ik_mock, leg_ik_2link, LegCommand, gate rules), 10.1 (servo clamp and rate limit, translation zero while a leg is lifted), and 10.4 (SAFE_STOP motor and servo behavior).
MotionCommand.wz_dps is degrees per second counterclockwise; the mixer needs rad/s.
Every dimension, wheel order, motor direction, servo channel, and limit is TBD from Matthew: keep them as config keys with placeholders; drive_only reports FAILED with "mecanum dimensions TBD" while any dimension is 0 instead of dividing by zero.
The DC driver model and protocol are unknown: keep dc_driver_tbd.cpp returning FAILED until a datasheet is in hand; do not guess a protocol.
Behaviors ask for leg moves as LegCommand, never pulse widths; unreachable IK targets are rejected, not clamped.
Create the files listed in docs/tasks/camille.md R8 and the tests listed there, and add robot_diag subcommands motor, drive, servo, and stance.
No em dashes.
When done, explain the change and trace one MotionCommand {vx 0.1, vy 0, wz 20} through the mixer to the four wheel commands.
```

Pitfalls:
- With legs, `lx` and `ly` change with stance, so read them from the current stance, not only from config defaults.
- Mecanum wheels slip on debris and when strafing; dead reckoning drifts, and the location note must say "low accuracy" (robot.md 8.2).
- Test motors with the wheels off the ground first; a sign error at full speed throws the robot off the table.

---

## Phase 3: demo

### R9. systemd and cold start

Estimate with AI: 0.5 h.

Goal: the robot program and bridge start on boot with the watchdog settings from `docs/ROBOT.md`.

Why it matters: a judge sees the robot go from power-on to online on the dashboard without anyone typing; a crash restarts by itself during the demo.

Inputs and dependencies:
- R1 to R3 at least; Matthew's devices wired (M2) for udev names.
- The team hotspot or travel router (never the venue Wi-Fi).

Outputs and who uses them:
- A Pi that boots to READY and online, used by everyone at rehearsals and judging.

Files to create (robot.md section 14): `raspberrypi/system/robot.service`, `robot-bridge.service`, `robot-tmpfiles.conf`, `99-robot.rules`, `config.txt.snippet`, `prestart.sh`.

Install commands (adjust paths to the repo checkout):

```
sudo useradd -r -m robot && sudo usermod -aG dialout,i2c,video,plugdev robot
sudo install -d /opt/robot/bin /opt/robot/system /etc/robot
sudo cp raspberrypi/robot/build/robot /opt/robot/bin/
sudo cp raspberrypi/system/prestart.sh /opt/robot/system/
sudo cp raspberrypi/robot/config/robot.yaml /etc/robot/robot.yaml
sudo cp raspberrypi/system/robot-tmpfiles.conf /etc/tmpfiles.d/robot.conf
sudo cp raspberrypi/system/99-robot.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger
sudo cp raspberrypi/system/robot.service raspberrypi/system/robot-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now robot robot-bridge
```

Config keys: `WatchdogSec` (start 2 s, TBD), `RuntimeWatchdogSec` in `/etc/systemd/system.conf` (TBD), the bridge env file `/etc/robot/bridge.env`.

Checklist:
- [ ] 1. Write the six system files from robot.md section 14, with every udev `KERNELS` value and USB id left TBD.
- [ ] 2. On the Pi, fill each `KERNELS` value and the Pico and GPS USB ids with `udevadm info -a -n`, reload, and confirm every `/dev/` name exists.
- [ ] 3. Install and enable both services, set `RuntimeWatchdogSec`, and reboot.
- [ ] 4. Kill the main loop with `kill -STOP` and confirm systemd's watchdog restarts the robot; kill the bridge and confirm it restarts alone.
- [ ] 5. Time two cold starts from power to READY and online.

Tests:
- `prestart.sh` exits 0 with an optional device missing, and non-zero with `/etc/robot/robot.yaml` missing (run it by hand).
- `systemd-analyze verify robot.service robot-bridge.service` prints no errors.

Manual check: `journalctl -u robot -b` shows BOOT, INIT, one status per device, READY; `systemctl status robot` shows the watchdog active.

Done when: power on to READY on the board in under 2 minutes, twice in a row.

Agent prompt:

```
Implement task R9, the Pi system files, in raspberrypi/system/.
Follow docs/specs/robot.md section 14 (robot.service, robot-bridge.service, robot-tmpfiles.conf, 99-robot.rules, boot config snippet, prestart.sh) and section 10.5 (watchdogs), and docs/ROBOT.md "Pi side" (systemd unit, groups) and "Pin map (Pi 4B UARTs)".
Every udev KERNELS address and USB vendor, product, and serial id is TBD: leave "TBD" with a comment on how to read it (udevadm info -a -n).
WatchdogSec starts at 2 s and RuntimeWatchdogSec is TBD; mark both.
The robot service does not depend on the bridge service; either can start or crash alone.
prestart.sh logs each check and exits 0 unless /etc/robot/robot.yaml is missing.
Add install steps to raspberrypi/README.md.
No em dashes.
When done, explain each file and trace what happens from power-on to the robot row going online.
```

Pitfalls:
- Type=notify with `READY=1` only on READY means a FAULT at init looks like a start timeout; see the pitfall table above and decide with Cayden.
- `WATCHDOG=1` must come from the main loop only, after a tick finishes in time, or a frozen loop is never caught.
- The Pi has no real-time clock; wait for time sync before the bridge sends `observed_at` (pitfall table).

---

## Demo day checklist

Cold start (do it once at least 30 minutes before judging, and again before each group if the robot was powered off):
- [ ] Team hotspot or travel router on; the Pi and Laptop A on it; never the venue Wi-Fi.
- [ ] Laptop A runs the SpacetimeDB server (Maincloud or the local fallback), the perception service and media server, the agents, and the sim console (demo.md "Booth setup").
- [ ] The bridge's `STDB_URI` matches the server in use (Maincloud or `ws://<laptop-a-lan-ip>:3000`), with the matching token file.
- [ ] `MEDIA_URL` in `/etc/robot/bridge.env` points at Laptop A's LAN IP and port, not `localhost`.
- [ ] Robot e-stop released, battery charged (TBD monitor, so check by hand), white light on if used.
- [ ] Power on; within 2 minutes `robotctl status` says READY and the sim console `status` shows `dog1` online.
- [ ] `timedatectl` on the Pi says the clock is synchronized.
- [ ] Every required `device_status` row is OK on the dashboard; optional ones may be DEGRADED.
- [ ] Robot placed at the house 3 front door mark; `demo_paths.yaml` coordinates match `backend/sim/`.

Logs to watch (one terminal on the Pi over SSH):

```
journalctl -u robot -u robot-bridge -f
```

- The robot's 1 Hz summary line: state, tick time, gate interventions, Pico heartbeat age, thermal age.
- Bridge lines for `claim_next_mission`, forwarded missions, reducer rejections (`SenderError`), spool size, and media upload retries.
- Any `SAFE_STOP` or `FAULT` line with its reason; a `stale_sensor` or `pico_link_lost` means a cable, not code.

During the run:
- [ ] Mission goes `leased`, `active`; cells go `searching`; the terrain marker changes on the debris.
- [ ] The robot stops at the warm body, the clip runs about 20 s with motion zero, and one detection appears.
- [ ] `robotctl estop` is ready in a terminal if the robot heads somewhere unsafe; the physical e-stop is in the robot handler's hand.

Fallback to the simulator robot (demo.md "Simulated robot" and the 0:50 to 1:50 beat):
- [ ] If the robot stalls or breaks, say so honestly, then in the sim console run `rr` (`robot replay house3`), which reports the house 3 detection with the rehearsal media and runs the real breathing method on the rehearsal clip.
- [ ] If the whole robot is out for the rest of the session, stop its bridge on the Pi (`sudo systemctl stop robot-bridge`) so `dog1` goes offline cleanly, and run `rb` to start `sim-dog`.
- [ ] Missions created for `dog1` are not taken by `sim-dog`; create new ones for `sim-dog` or for any robot (`robot_id` empty).
- [ ] Show the rehearsal robot video on a phone while the sim robot runs.
- [ ] After the session, `rbx` stops `sim-dog`, and `sudo systemctl start robot-bridge` brings `dog1` back.

After each run:
- [ ] Copy the sensor log boot folder and run `npm run upload-logs -- --dir /var/lib/robot/logs/<boot folder>` so Eric can tune thermal and terrain thresholds.
