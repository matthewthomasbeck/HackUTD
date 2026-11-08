# Robot Project Brief

Source: the team's Claude Code brief, pasted by Cayden on 2026-11-07, which records the Nov 7 whiteboard.
This file is the source of truth for the robot project.
`docs/IDEAS.md` and `docs/notes/` are the history of how the team got here.

Student hackathon robot.
Tracks as of 2026-11-07: NVIDIA, State Farm, and SpacetimeDB (see below). The backend is SpacetimeDB.
Use case (LOCKED 2026-11-07): rubble search and rescue, described in `docs/PROJECT.md`.
The robot dog stays in the project (Cayden, 2026-11-07). Proposed role: it searches places responders cannot safely or quickly enter (dark, unpowered, or damaged buildings), finds people with the thermal camera (which works in the dark), confirms them with the camera, maps rooms with the LD19 LiDAR, and reports each finding to the shared board.
Earlier candidates (a firefighter-assistance robot, then a field inspector for EOG's challenge) are dropped.
The MVP is not chosen yet.
Build reusable robot plumbing first and keep the application layer swappable.

Wiring map (private, the owner shares it): https://claude.ai/artifact/TPJhh4AAyqmeM8VweMzUh5

## How to work on this repo

- Confirmed vs proposed.
  Treat anything marked PROPOSED or TBD as open.
  Ask before locking it in code.
- Explain your changes.
  The team learns by reading code.
  Explain what you changed and why, and trace one example through it.
  When someone is learning a piece (S2 especially), give hints before full solutions.
- Prefer iterative over recursive code.
- Never assume hardware details like I2C addresses, baud rates (other than the ones listed below), driver protocols, or servo channel maps.
  Put them in config and mark them TBD.
- Every device gets a mock.
  The full state machine must run on a laptop with no hardware attached.
- No em dashes in docs, comments, or commit messages.

## Team

These roles may change.

| Who | Role |
| --- | --- |
| S0 | Analytics, electrical systems, assembly |
| S1 | Architecture lead; teaches S2 |
| S2 | Software, learning |

## Confirmed decisions

- Main computer: Raspberry Pi 4B (8GB), Debian 12, C++.
- Microcontroller: Raspberry Pi Pico (RP2040), C/C++ using the Pico C SDK.
- Autostart: systemd service on boot.
- Motion: inverse kinematics, not reinforcement learning.
- No URDF dependency.
  A previous URDF took about a week to build, so do not depend on one.
- Program shape: main program = startup device init, then a state machine control loop.
- Device split: per the Nov 7 whiteboard, below.
- First target track: NVIDIA, "Use Nemotron Beyond a Chatbot" (LOCKED 2026-11-07).
  The project must use Nemotron, with multi-step agent workflows, tool integration, and real-world use.
  Details are in [the NVIDIA track notes](notes/2026-11-07-nvidia-track.md).
- Second target track: State Farm (chosen by Cayden, 2026-11-07).
  "The Worst Day, at Scale": when a disaster hits thousands of people at once, use AI to identify the most urgent needs, coordinate assistance, and make sure no one is overlooked.
  Details and the proposed use case: [State Farm notes](notes/2026-11-07-state-farm-track.md).
- Third target track: SpacetimeDB main track (back in on 2026-11-07); SpacetimeDB must power the app's primary functionality ([notes](notes/2026-11-07-spacetime-track.md)).
- Dropped 2026-11-07: Photon phone calls ([notes](notes/2026-11-07-photon-track.md)) and the short-lived Supabase backend plan.
  Confirm with the organizers that one project can enter 3 sponsor tracks.
- Dropped on 2026-11-07: EOG "Beat the Shutdown" ([notes](notes/2026-11-07-eog-track.md)), CBRE, T-Mobile, and NMC².
  Their notes stay in `docs/notes/` as history.

## Hardware inventory

| Device | Bus | Lives on | Notes |
| --- | --- | --- | --- |
| Pololu Maestro A | UART | Pi | Drives 45kg servos. The legs use 12 (Cayden, 2026-11-07); the Maestro model and channel count are TBD |
| Pololu Maestro B | UART | Pi | Drives 25kg servos (quantity TBD). They are not used in the legs (Cayden, 2026-11-07); what they drive is TBD |
| Dual DC motor driver A | UART (TBC) | Pi | Motors 1 and 2. Model TBD. Interface may be PWM + direction instead of UART |
| Dual DC motor driver B | UART (TBC) | Pi | Motors 3 and 4 |
| Pico | USB serial | Pi | Shows up as `/dev/ttyACM*`; use its `/dev/serial/by-id` path |
| Camera (regular, not NoIR) | CSI ribbon (TBC) | Pi | Corrected 2026-11-07: a regular camera, with no IR illuminators, so it needs visible light. Model TBD. Capture through the libcamera C++ API |
| Intel NCS2 (or Coral, TBD) | USB 3 | Pi | Both are USB accelerators. NCS2 is discontinued and newer OpenVINO releases dropped it; verify the toolchain on Debian 12 first |
| IMU | I2C | Pico | Model and address TBD |
| Thermal camera | I2C | Pico | Model and address TBD. This is the heat sensor |
| ADS1115 ADC | I2C | Pico | Default address 0x48. Reads 4 FSRs (force sensors) on A0 to A3 through divider resistors. They are not foot pads (Cayden, 2026-11-07); where they are mounted and what force they measure is TBD |
| Single-point LiDAR | UART | Pico | Model TBD (TF-Luna/TFmini style), 115200 default |
| LD19 360 degree LiDAR | UART | Pico | 230400 baud, streams packets. Verify the packet format against the datasheet |
| GPS module | USB (PROPOSED) | Pi | Added 2026-11-07 (Cayden: the robot has GPS). Proposed: Matthew's module through a USB-to-TTL adapter (or a USB GPS dongle), read with `gpsd`, so no UART is needed. Fallback: a receive-only PIO software UART on a free Pico pin. Model and baud rate TBD. Position only, about 2.5 m in open sky, no fix indoors or under rubble (`docs/research/platform.md`) |

### Photo inventory (2026-11-07)

Cayden listed the parts in a photo of the robot dog's hardware on 2026-11-07.
It matches the table above, with these details:

- 4x DSServo 45kg coreless digital servos in the photo.
  Corrected 2026-11-07 (Cayden): the team has 12x 45kg servos.
  The 25kg servos are on the whiteboard but not in the photo, quantity unknown, and they are not used in the legs.
- 4x small silver DC gear motors and 4x mecanum wheels (confirmed by Cayden, 2026-11-07).
- The Coral accelerator is on the whiteboard but not in the photo.
- Two small I2C breakout boards are the IMU and the ADS1115, but the photo does not show which is which.
- One unidentified board with power leads, possibly a buck converter or power module.
- Servo extension leads, jumper wires, hookup wire, and heat shrink.

Confirmed 2026-11-07 (Cayden): the robot has 4 mecanum wheels on legs, and the servos move the legs with inverse kinematics.

### Legs (confirmed 2026-11-07, Cayden)

The frame is Matthew's Athena quadruped (`3d_parts/Robot_Parts_Athena` in the team repo), with new leg parts in `3d_parts/Rubble_Dog`.
Each leg has 3 DSServo 45kg servos, 12 in total:

- Abduction: in the body, turns the hip about the body's long axis (unchanged from Athena).
- Hip: in the hip part, turns the femur.
- Knee: at the knee, above the tibia, turns the tibia directly.
  Athena drove the knee from a second servo at the hip through a tie rod; that is gone.

Link lengths (PROPOSED, from the CAD, same as Athena): hip axis to knee axis 110 mm, knee axis to the foot bolt holes 140 mm.
The servo channel map and joint limits are TBD.
Ask Matthew before writing motion code.

## Pin map (PROPOSED, verify before wiring)

### Pi 4B UARTs

| UART | TX / RX GPIO | Physical pins | Device |
| --- | --- | --- | --- |
| UART3 | GPIO4 / GPIO5 | 7 / 29 | Maestro A (45kg) |
| UART5 | GPIO12 / GPIO13 | 32 / 33 | Maestro B (25kg) |
| UART4 | GPIO8 / GPIO9 | 24 / 21 | DC driver A |
| UART0 | GPIO14 / GPIO15 | 8 / 10 | DC driver B |

Rules for the Pi UARTs:

- Skip UART2: its pins (27/28) are reserved for HAT ID EEPROMs.
- Skip UART1, the mini UART: its baud rate drifts with the CPU clock.
- UART4 shares pins with SPI0, so no SPI devices.

`/boot/firmware/config.txt`:

```
enable_uart=1
dtoverlay=disable-bt
dtoverlay=uart3
dtoverlay=uart4
dtoverlay=uart5
```

Also:

- Run `sudo systemctl disable hciuart`.
- Turn off the serial login console in `raspi-config`.
- Give each UART a stable name with udev rules keyed to `KERNELS=="fe20xxxx.serial"`.
  Verify each address with `udevadm info -a -n /dev/ttyAMAx`.
- Config refers only to `/dev/servo45`, `/dev/servo25`, `/dev/dcmotorA`, `/dev/dcmotorB`, `/dev/pico`.

### Pico

| Bus | Pins (GP / physical) | Device |
| --- | --- | --- |
| UART0 | GP0 TX, GP1 RX / 1, 2 | LD19 |
| UART1 | GP4 TX, GP5 RX / 6, 7 | Single-point LiDAR |
| I2C0 | GP8 SDA, GP9 SCL / 11, 12 | Thermal camera (own bus so big frame reads never block the IMU) |
| I2C1 | GP2 SDA, GP3 SCL / 4, 5 | IMU + ADS1115 (shared) |

## Electrical rules

- 3.3V logic only.
  The Pi and Pico are 3.3V and not 5V tolerant.
  Maestro and driver TX lines may be 5V; check before wiring.
- Maestro serial mode.
  Maestros ship in USB serial mode.
  Switch them to UART mode in Maestro Control Center.
- Common ground across the battery, every rail, the Pi, the Pico, and all devices.
- E-stop placement.
  The physical e-stop cuts actuator power only.
  The Pi and Pico stay up.
- Power is all TBD: battery voltage and capacity, servo rail voltage, motor rail voltage.

## Software architecture (Nov 7 whiteboard)

### Pi side: "Edge Software C++ - Pi"

Whiteboard step 1, systemd unit:

- `ExecStartPre` steps: set device addresses or paths, clean up stale V4L2/camera state, reset the NCS2/Coral.
- The unit itself sets `Restart=on-failure` and `WatchdogSec=`.
- The service user needs the `dialout`, `i2c`, `video`, and `plugdev` groups.

Whiteboard step 2-A, initialize Pi devices:

- Runs on the main thread, opening ephemeral init threads.
- Order: Maestro A, Maestro B, DC driver A, DC driver B, Pico, camera, NCS2/Coral.
- Each returns OK | DEGRADED | FAILED.
  A required device that fails sends the state machine to FAULT.

Whiteboard step 2-B, initialize Pico devices:

- Ephemeral thread, started after the Pico link is up.
- The Pi asks the Pico to bring up the IMU, thermal cam, ADS1115, single-point LiDAR, and LD19, and collects a status for each.
- Version handshake first.
  A mismatched firmware version counts as FAILED.

Whiteboard step 3, state machine:

- Fixed-rate loop on the main thread.
- One of its inputs is "Listen to Pico", a reader thread that parses Pico frames into latest-value slots.

### Pico side: "Edge Software C++ - Pico"

Whiteboard step 4, Pico listener:

- Thread A: link to the Pi (framing, heartbeat, commands).
- Threads B to F: thermal cam, ADS1115/FSRs, single-point LiDAR, LD19, IMU.

Important: the RP2040 has no OS by default.
"Threads A to F" should be non-blocking tasks in one superloop on core 0.
Each task is a `poll()` that returns quickly and is driven by timers and UART IRQ ring buffers.
Core 1 is optional, for example for LD19 parsing.
Use FreeRTOS SMP only if the team explicitly picks it.

Hardware watchdog: call `watchdog_enable()` at boot and feed it once per loop.

### Threading model on the Pi (PROPOSED)

| Thread | Job |
| --- | --- |
| Main | Init, then the state machine loop at a fixed rate |
| Pico reader | Blocking read on `/dev/pico`. Parses frames, writes each sensor into a mutex-guarded latest-value slot with a timestamp |
| Camera capture | libcamera frames into a latest-frame slot |
| Inference (optional) | NCS2/Coral on the latest frame |

Rules:

- Use latest-value slots, not queues, so stale data never piles up.
- The main loop never blocks on I/O.
- Data older than its timeout counts as stale and triggers SAFE_STOP during ACTIVE.

### Loop shape

Each tick runs these steps in order:

1. Observe: snapshot the world state from the latest-value slots.
2. Step: the state machine decides whether to transition.
3. Behavior: the current state's behavior proposes commands.
4. Safety gate: filter or zero the commands.
5. Send: write to the actuators.
6. Log.

Behaviors never touch hardware directly.
They return commands, and only the safety gate passes commands on to the drivers.

## State machine

| From | Event / condition | To |
| --- | --- | --- |
| BOOT | config valid | INIT |
| BOOT | config invalid | SHUTDOWN (log reason) |
| INIT | all required devices OK (optional ones may be DEGRADED) | READY |
| INIT | required device FAILED | FAULT |
| READY | start command AND health OK | ACTIVE |
| ACTIVE | behavior done OR stop command | READY |
| ACTIVE | e-stop, stale sensor, Pico heartbeat lost, loop overrun, command out of limits | SAFE_STOP |
| any | e-stop | SAFE_STOP (latched until a human resets it) |
| SAFE_STOP | stopped and cause recoverable | FAULT |
| FAULT | retries < N: reinit the failed device | INIT |
| FAULT | retries exhausted | SAFE_STOP latched + alert |
| any | SIGTERM / shutdown | SAFE_STOP, then SHUTDOWN |

Open question: what SAFE_STOP physically does (hold pose, sit, or cut torque) is undecided and depends on the hardware.

ACTIVE sub-states are examples only until the use case is picked:

- Inspection: MOVE_TO_POSE, then SCAN, then REPORT.
- Inventory: CAPTURE, then DETECT, then COMPARE_CHECKLIST, then REPORT.
- Follow: SEARCH, then TRACK, then TARGET_LOST (timeout returns to READY).

## Pi to Pico protocol (PROPOSED, not built)

Frame format:

```
[0xAA 0x55][type u8][dev u8][len u16 LE][payload][crc16]
```

Message types:

- HELLO / VERSION: handshake.
- INIT_DEV: the Pi asks the Pico to init one device.
- DEV_STATUS: the Pico reports OK | DEGRADED | FAILED.
- DATA: one sensor reading, with the Pico's timestamp in microseconds.
- HEARTBEAT: sent in both directions.
- ERROR.

Rules:

- Heartbeat at about 20 Hz each way.
  Missing more than about 250 ms counts as link lost, and the Pi goes to SAFE_STOP.
  Tune both numbers.
- On a bad CRC, drop the frame and resync on `0xAA 0x55`.
  Count errors.
  A high error rate is a fault.
- The Pico sends parsed values, not raw bytes, except for LD19 scans, which can be batched per revolution.

## Safety without an actuator watchdog chip

In this plan the Pi drives the actuators directly, so nothing independent stops them if the Pi process hangs.
Layer these protections:

- Device timeouts.
  Turn on the serial timeout in the Maestros and DC drivers, if supported (TBD per model).
- systemd watchdog.
  Set `WatchdogSec=`, and call `sd_notify("WATCHDOG=1")` from the main loop only.
- OS watchdog.
  Set `RuntimeWatchdogSec=` in `/etc/systemd/system.conf` so a frozen OS reboots.
- Physical e-stop on the actuator power rail.

Alternative still on the table: move the actuators onto the Pico, so its heartbeat stop covers all motion.

## Suggested repo layout (PROPOSED)

```
pi/
  CMakeLists.txt
  src/main.cpp            # init + loop
  src/state_machine.*     # states, transitions
  src/safety_gate.*
  src/hal/                # interfaces + real + mock per device
    actuator_maestro.*  dc_driver.*  camera_libcamera.*  pico_link.*
  src/perception/
  src/behaviors/          # Idle, Pose, ScriptedMotion, app-specific
  src/motion/ik.*         # IK solver, joint limit clamp, rate limiter
  config/robot.yaml       # device paths, required/optional, timeouts, TBD fields
  systemd/robot.service
  udev/99-robot.rules
pico/
  CMakeLists.txt          # Pico C SDK
  src/main.cpp            # superloop + watchdog
  src/link.*              # framing, heartbeat
  src/tasks/              # imu, thermal, ads1115, lidar_single, ld19
protocol/
  messages.h              # shared frame + message definitions (used by both sides)
```

## MVP proposals (not decided)

- Primary: operator-triggered inspection pass.
  Boot to READY, run a short scripted motion (or stay stationary), detect targets with the camera, flag hotspots with the thermal cam if its range test passes, report, and return to READY.
- Fallback: a stationary camera inventory checker against a checklist.
  It reuses the same perception, telemetry, and state machine with mock actuators.
  Fiducial tags (ArUco/AprilTag) on items make detection reliable.
- Go/no-go gate: if IK-commanded poses are not reliable by the first checkpoint, ship the fallback.
- Dropped as impractical: extinguisher carrying and hose connection.

## Open questions

- The robot has no microphone or speaker (removed 2026-11-07); do not add audio hardware without a team decision.
- Leg servo channel map and joint limits (Matthew). Joints per leg and link lengths are in "Legs" above.
- Maestro model for the 12 leg servos (12 channels needed), and what the 25kg servos drive.
- Where the 4 FSRs are mounted and what force they measure.
- A white light on the robot for the regular camera in dim rubble (hardware TBD), or demo in room light.
- GPS model, and confirm the USB plan with Matthew.
- The Pi-side Node.js bridge to SpacetimeDB and its local socket protocol with the C++ program (see `docs/PROJECT.md`).
- How the robot talks to the operator at the site (Wi-Fi, range extender, hotspot, or other radio). GPS gives position, not communication.
- Use case and MVP.
- Confirm the proposed catastrophe response use case as a team, and ask State Farm how they judge and whether they provide data.
- The robot dog's search mission in detail, and a thermal range test for detecting a person (distance and confidence).
- Confirm with the organizers that a project can enter 3 sponsor tracks.
- Where Nemotron runs, and which robot actions the agent can call as tools.
- What the servos move, and whether the DC motors are the drivetrain.
- DC driver model and interface (UART or PWM + direction).
- IMU and thermal camera models and addresses.
- NCS2 or Coral.
- Battery and rail voltages.
- SAFE_STOP physical behavior.
- Operator interface: how start and stop are triggered.
- Logic levels on every TX line.
