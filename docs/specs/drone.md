# Drone onboard software spec (PROPOSED)

Status: PROPOSED, written 2026-11-08 for the drone direction.
Code: `drone/pi/`, `drone/bridge/`, `drone/mcu/`; how to build, test, and run it, and every open question, is in `drone/README.md`.

## Scope

The drone runs on its own Raspberry Pi and its own microcontroller (MCU), separate from the robot dog.
Its software is the dog's software (`robot.md`) with the dog-only parts taken out and nothing new put in.
Wherever this file says nothing, `robot.md` applies unchanged: the state machine (section 5), the safety gate (section 10.1), the threads (section 4.2, with the movement thread renamed the flight thread), the main loop order (section 4.3), location (section 8), and the bridge (section 9, without the terrain hint).

Not in scope until the team decides (open questions 1 to 4 in `drone/README.md`): flight control of any kind, real actuator output, a vertical axis, and what a stop means in the air.

## Differences from the dog

| Part | Dog (`robot.md`) | Drone |
| --- | --- | --- |
| Actuators | 2 Maestros, 2 DC drivers, mecanum mixer, leg IK | `flight_output`: a mock that records the gated command; the real one reports FAILED |
| Movement thread | writes wheel duties and servo pulses | flight thread: hands the gated command to `flight_output` unchanged |
| Microcontroller | Pico, 5 sensors, text lines, any line is the heartbeat | MCU (board TBD), IMU slot only (model TBD), the same text lines plus `HB <ms>` |
| Safety gate | stops, terrain, leg lift, clamp, acceleration limit | stops, clamp, acceleration limit |
| Missions run | `hold`, `teleop`, `seek_thermal` | `hold`, `teleop` |
| Bridge messages sent | heartbeat, position, device, detection, cell, mission_progress, terrain | the same without terrain |
| Bridge messages read | mission, cancel, site, terrain_hint, teleop | mission, cancel, site, teleop |
| Config | `robot.yaml`, `robot.laptop.yaml` | `drone.yaml`, `drone.laptop.yaml` (every hardware key TBD) |

## Config

Top-level keys of `drone.yaml`: `drone` (`robot_id`, `name`), `loop`, `init`, `fault`, `shutdown`, `flight` (`rate_hz`, `command_timeout_ms`), `vision`, `workers`, `devices` (`required`, `optional`), one block per device (`flight_output`, `mcu`, `camera`, `detector`, `gps`), `stale_ms`, `limits`, `estop`, `teleop`, `missions`, `site`, `location`, `home`, `heading`, `odometry`, `paths_file`, `bridge`, `control`.
Validation and error messages follow `robot.md` section 15; an invalid config exits with code 2 and names the key.

## Proposed contract changes

`CONTRACTS.md` is not changed by this spec.
These are the changes a human should decide on before the drone code is treated as final:

1. Components table: add three rows.

   | Component | Language | Folder in the team repo | Spec |
   | --- | --- | --- | --- |
   | Drone main program | C++ | `drone/pi/` | `drone.md` |
   | Drone bridge to SpacetimeDB | TypeScript (Node.js) | `drone/bridge/` | `drone.md` |
   | Drone MCU firmware | C/C++ (Pico C SDK, board TBD) | `drone/mcu/` | `drone.md` |

   This also adds a new top-level folder, `drone/`, next to `raspberrypi/` and `pico/`.
2. Robot ids: the drone is an ordinary robot with `robot.robot_id` `"drone1"`, a `participant` with role `robot` and name `drone1`, using the existing robot reducers unchanged (`robot_heartbeat`, `robot_report_position`, `robot_report_device`, `report_detection`, `mark_cell`, `mission_progress`, `claim_next_mission`, and the `teleop` row).
3. Device names in `device_status` for `drone1`: `flight_output`, `mcu`, `camera`, `detector`, `gps`, `imu`.
4. Robot bridge local protocol: the drone uses it unchanged, except that it never sends `terrain` and ignores `terrain_hint` as an unknown type. Its default socket is `/run/drone/bridge.sock` (laptop `/tmp/drone-bridge.sock`).
5. Detections from the drone use `source` `camera`, with the thermal fields null.
6. MCU link (local to the drone, like the dog's Pico lines, which are not in `CONTRACTS.md` either): the dog's text protocol plus `HB <ms>` at `mcu.heartbeat_hz`, firmware version `0.1`.
