# Matthew: electrical system, assembly, physical demo

Owner of the robot hardware.
Specs: `docs/ROBOT.md` (hardware, pin map, electrical rules), `docs/specs/robot.md` (what the software expects), `docs/specs/demo.md` (the demo set).
Overview and checkpoints: `docs/TASKS.md`.
Total with AI: about 12.5 h (each task 1 to 2 h with coding agents; hardware tasks are bench time, not typing).

Event: HackUTD, Nov 7-8 2026.
Scope is FINAL (`docs/MVP.md`, 2026-11-07); scope changes need a team decision.

Current facts this file assumes (from `docs/ROBOT.md` and `docs/specs/robot.md`):

- Regular camera, not NoIR, with no IR illuminators, so it needs visible light.
- 4 mecanum wheels on 4 DC motors, mounted on legs that servos move with inverse kinematics.
  Wheels first; legs are a stretch.
- 4 FSR force sensors on the ADS1115.
  They are not foot pads, and where they are mounted is TBD.
- No microphone or speaker, no drone, no beacon (no indicator light or buzzer).
- GPS over USB, read with `gpsd`.
- Missions come from the orchestrator (or a coordinator); there is no search agent.
  No agent ever commands motors.

Rules for this file:

- Never invent part numbers, addresses, voltages, or baud rates.
  If a value is not in the docs, write TBD and the way to find it.
- Every value you find goes into the TBD table in `docs/specs/robot.md` section 15.1 (or post it in the team chat for Camille to copy in).
- Photos of the wiring, labels, and part markings go in the shared drive (link TBD, ask Cayden).

## Start here (first hour)

1. Read the part markings and fill the M0 facts list (about 30 min).
   Photograph every board, the battery label, and the motor driver, and post the photos and the filled list in the team chat.
   Camille's config (`/etc/robot/robot.yaml`) and Eric's tests are blocked on these.
2. Measure the battery voltage and decide the rails (M1, steps 1 to 4).
   Do not connect any TX line to the Pi or the Pico until you have measured its logic level.
3. Wire and test the e-stop on the actuator rail before anything moves (M1, steps 8 to 12).
   Nothing spins on the bench until the e-stop cuts the actuators and the Pi stays up.

## Hand-offs

| What | To | From task | By checkpoint |
| --- | --- | --- | --- |
| M0 facts list (drivers, IMU, thermal, LiDARs, GPS, battery, logic levels, FSR placement) | Camille (config), Eric (thermal and terrain) | M0 | Checkpoint 1 |
| Thermal model, resolution, field of view, I2C address | Camille (`thermal.*`), Eric | M0 | Checkpoint 1 |
| DC driver model, interface, and command range | Camille (`dc_driver_tbd.cpp`) | M0, M2 | Checkpoint 1 |
| Every device answering on its bus, with `/dev/servo45`, `/dev/servo25`, `/dev/dcmotorA`, `/dev/dcmotorB`, `/dev/pico`, `/dev/gps0` present | Camille | M2 | Checkpoint 3 |
| Mecanum values (`motion.mecanum.*`), speed limits, `odometry.scale` | Camille | M3 | Checkpoint 3 |
| Light decision (robot white light or room light), and a test clip | Eric (E1 clips, E3) | M4 | Checkpoint 3 |
| Leg geometry and servo channel map (`legs.*`, `servos.*`) | Camille (R8) | M0, M5 | Checkpoint 3 (geometry), Checkpoint 4 (stance tested) |
| `thermal.mask`, `yaw_offset_deg`, LiDAR mounting (`terrain.lidar_single_mode`, `ground_range_m`), `terrain.max_step_m` | Camille, Eric | M2, M3, M7 | Checkpoint 4 |
| Thermal range test table | Camille (thresholds), Eric (score input) | M6 | Checkpoint 4 |
| Mock rubble set built and crossed 3 times | Everyone (rehearsal) | M7 | Checkpoint 4 |
| Outdoor GPS clips and robot footage | Cayden (video edit) | M8 | Checkpoint 5 |
| Power-up checklist and spares box | Whoever is robot handler at the booth | M9 | Checkpoint 5 |

## Phase 0: setup

### M0. Hardware facts the software team is waiting on

Goal: write down every hardware fact the software needs, from part markings and the build.
Why it matters: Camille's config and drivers, Eric's terrain and thermal work, and the robot find (MVP priority 3, NVIDIA and State Farm) all wait on these numbers.
Estimate with AI: 1 h.

Inputs: the robot, the parts box, the photo inventory in `docs/ROBOT.md`, your Athena notes.
Outputs: a filled list in the TBD table of `docs/specs/robot.md` section 15.1 (or the team chat), plus photos in the shared drive.
Receivers: Camille (config keys), Eric (thermal, terrain), Cayden (contracts if a name changes).

Steps:

1. - [ ] Leg geometry for inverse kinematics: count the joints per leg and the servos per leg.
   Measure each link length (hip to knee, knee to wheel hub) in meters with calipers or a ruler.
   Write which Maestro (A on `/dev/servo45` for the 45kg servos, B on `/dev/servo25` for the 25kg servos) and which channel drives each joint.
   Config keys: `legs.l1_m`, `legs.l2_m`, `legs.channels`.
   If the leg is not a planar two-link, say so; `leg_ik_2link` is only a guess (robot.md 12.5).
2. - [ ] Count the 25kg servos actually on the robot (the photo shows only the 4x 45kg).
3. - [ ] DC motors: check for encoder wires (more than 2 wires per motor).
   Write "no encoders" if there are none; the software assumes none (robot.md 8.2).
4. - [ ] DC motor driver: read the model from the board marking.
   From its datasheet, write the interface (UART, or PWM plus direction), the baud rate if UART, the command range, and whether it has a serial timeout.
   Config keys: `dc_driver_a.protocol`, `dc_driver_a.baud`, same for `dc_driver_b`.
5. - [ ] LD19: write the planned mounting height above the floor in meters and which way 0 degrees points.
   This decides which debris the LiDAR can see (robot.md 7b.3, rule 4).
6. - [ ] Single-point LiDAR: read the model from the marking.
   Decide forward or angled down at the ground (`terrain.lidar_single_mode: forward | down`).
7. - [ ] Thermal camera: read the model from the marking.
   From its datasheet, write the resolution (`thermal.width`, `thermal.height`), horizontal field of view (`thermal.fov_h_deg`), frame rate, and default I2C address.
8. - [ ] IMU: read the model from the marking and write its default I2C address and the axis printed on the board.
   Note how it is mounted (which board axis points forward) for the heading sign (robot.md 8.2).
9. - [ ] Tell the two small I2C breakouts apart (IMU vs ADS1115; the photo does not show which is which).
   The ADS1115 default address is 0x48 (`docs/ROBOT.md`).
10. - [ ] FSRs: write where each of the 4 FSRs is mounted (or will be), what pushes on it, and which ADS1115 input (A0 to A3) it uses.
    They are not foot pads; do not describe them as ground contact.
    If they have no job yet, write "unmounted, no job" so `terrain.use_force` stays false.
11. - [ ] GPS module: read the model, and whether it connects through a USB-to-TTL adapter or is a USB dongle.
12. - [ ] Battery: read the chemistry, cell count (you have 2S and 6S packs), nominal voltage, and capacity from the label.
    Write which pack powers the robot.
13. - [ ] Rails: from the servo, motor, and driver datasheets, write the voltage each actuator needs and how you will make it (direct from the pack, or a buck converter).
    Identify the unlabelled board with power leads from the photo inventory (buck converter or power module).
14. - [ ] Logic levels: for each TX line that reaches the Pi or the Pico (Maestro A, Maestro B, DC driver A, DC driver B, LD19, single-point LiDAR, GPS adapter), write 3.3 V or 5 V from the datasheet.
    Confirm with a meter in M1 step 6.
15. - [ ] Thermal and LiDAR alignment: write whether the single-point LiDAR points the same way as the thermal camera (robot.md 7.1, step 5).

Done when: every item above is written into the TBD table in `docs/specs/robot.md` (or posted in the team chat for Camille to copy in).

Common failure modes and quick fixes:

- No marking on a board: search the board's silkscreen text and chip markings, or ask in the team chat with a photo; leave it TBD rather than guess.
- Datasheet disagrees with a seller listing: trust the datasheet, and note the source next to the value.
- Leg geometry is not decided yet: post "wheels only for now" so Camille ships `motion.impl: drive_only`.

## Phase 1: build

### M1. Power and safety

Goal: a battery, an actuator rail, a logic rail, common ground, an e-stop on actuator power only, and safe logic levels.
Why it matters: the MVP "must have" list starts with the electrical system; without it nothing on the demo runs.
Estimate with AI: 2 h.

Inputs: M0 battery, rail, and logic level facts; the wiring map (private artifact linked in `docs/ROBOT.md`).
Outputs: a wired power system, a short wiring note with photos in the shared drive, the e-stop sense decision (`estop.sense`).
Receivers: Camille (e-stop behavior in software, `estop.sense`), everyone (safety).

Safety notes:

- The Pi 4B and the Pico are 3.3 V logic and not 5 V tolerant.
  A 5 V TX line into a Pi or Pico RX pin can destroy it.
- One common ground across the battery, every rail, the Pi, the Pico, and every device.
- The e-stop cuts actuator power only (servos and DC motors).
  The Pi and the Pico stay on.
- Battery handling: never short the leads, insulate every exposed connector with heat shrink, never leave a pack charging unattended, and stop using a pack that is swollen, hot, or damaged.
  Charge only with a charger set to the pack's chemistry and cell count.
- Wheels off the ground (robot on a stand or box) for every powered test in this task.

Steps:

1. - [ ] Measure the battery voltage at rest with a multimeter and write it down next to the label value.
2. - [ ] Plan the rails on paper: battery, then the main switch, then a split into the actuator rail (through the e-stop) and the logic rail (Pi and Pico supply).
   Post a photo of the sketch in the team chat.
3. - [ ] Choose a fuse on the battery lead sized for the actuator current from the datasheets (rating TBD from M0).
   If no fuse is on hand, write it in the M9 spares list and buy one.
4. - [ ] Set the buck converter (if used) to the rail voltage from M0 with no load connected, and measure it before connecting anything.
5. - [ ] Wire the logic rail to the Pi (and the Pico through the Pi's USB, or its own supply, per the wiring map).
   Power up the Pi alone and confirm it boots.
6. - [ ] For each TX line from M0 step 14, power the device alone and measure its idle TX voltage to ground with the meter.
   Write the measured value next to the datasheet value.
7. - [ ] Add a level shifter (or a resistor divider) on every TX line that measures above 3.3 V before it reaches a Pi or Pico RX pin.
   Measure again at the Pi or Pico side of the shifter; it must read 3.3 V or less.
8. - [ ] Wire the e-stop in series with the actuator rail only (feeding the Maestros' servo power and the DC drivers' motor power).
   The logic rail must not pass through it.
9. - [ ] Run common ground: one wire from each rail, the Pi, the Pico, both Maestros, both DC drivers, and every sensor back to one ground point.
10. - [ ] Continuity check with the meter: every ground point to the battery negative reads near 0 ohms.
11. - [ ] E-stop test 1: Pi booted, actuator rail live (wheels off the ground), press the e-stop.
    Measure the actuator rail: it must read 0 V.
    The Pi and the Pico must stay on (Pi still answers SSH, Pico LED or USB serial still present).
12. - [ ] E-stop test 2: release, confirm the rail returns, then repeat step 11.
13. - [ ] Decide the e-stop sense line: none (default), or a divider from the actuator rail to a free Pico GPIO or ADC input.
    Write `estop.sense: none` or the Pico input in the TBD table (robot.md 10.4).
14. - [ ] Battery monitor: there is no sensor in the inventory, so write `battery_pct` as "none" in the TBD table unless you add a divider to a spare input.
15. - [ ] Label every connector with tape and a marker (rail name and voltage).

Done when: the e-stop cuts the servos and motors while the Pi and Pico stay up, verified twice.

Common failure modes and quick fixes:

- Pi reboots when motors start: the logic rail sags; give the Pi its own regulator from the battery, or add bulk capacitance at the actuator rail (value TBD from the driver datasheet).
- E-stop also kills the Pi: the logic rail is wired after the e-stop; move the split before it.
- A device works alone but not with others: missing common ground; re-run step 10.
- Buck converter gets hot: it is under-rated for the load; move the actuators to the pack directly if their rated voltage allows, or use a larger converter.

### M2. Sensor and actuator bring-up

Goal: every device wired to its pin, powered, and answering a simple test.
Why it matters: checkpoint 3 ("robot on the board") needs real thermal detections and a breathing clip; Camille swaps her mocks for real devices one at a time.
Estimate with AI: 2 h.

Inputs: M0 facts, M1 power, the proposed pin map in `docs/ROBOT.md`, Camille's `robot_diag` tool (robot.md 16.3) when it is ready.
Outputs: each device answering, the udev names present, Maestros in UART mode, notes on every measured value.
Receivers: Camille (device paths, `KERNELS` addresses, USB ids), Eric (thermal frames, camera clip).

Pin map (PROPOSED in `docs/ROBOT.md`; verify before wiring):

| Device | Bus | Pins | Name |
| --- | --- | --- | --- |
| Maestro A (45kg servos) | Pi UART3 | GPIO4 TX / GPIO5 RX, physical 7 / 29 | `/dev/servo45` |
| Maestro B (25kg servos) | Pi UART5 | GPIO12 TX / GPIO13 RX, physical 32 / 33 | `/dev/servo25` |
| DC driver A (motors 1 and 2) | Pi UART4 | GPIO8 TX / GPIO9 RX, physical 24 / 21 | `/dev/dcmotorA` |
| DC driver B (motors 3 and 4) | Pi UART0 | GPIO14 TX / GPIO15 RX, physical 8 / 10 | `/dev/dcmotorB` |
| Pico | USB serial | `/dev/ttyACM*` | `/dev/pico` |
| GPS | USB | adapter or dongle | `/dev/gps0` |
| LD19 | Pico UART0, 230400 baud | GP0 TX / GP1 RX, physical 1 / 2 | |
| Single-point LiDAR | Pico UART1, 115200 default | GP4 TX / GP5 RX, physical 6 / 7 | |
| Thermal camera | Pico I2C0 (own bus) | GP8 SDA / GP9 SCL, physical 11 / 12 | |
| IMU and ADS1115 (0x48) | Pico I2C1 (shared) | GP2 SDA / GP3 SCL, physical 4 / 5 | |

Remember: TX of a device goes to RX of the Pi or Pico, and RX to TX.

Safety notes:

- Power off before moving any wire.
- Every TX line into the Pi or Pico must be measured at 3.3 V or less (M1 step 7) before it is connected.
- UART4 shares pins with SPI0, so no SPI devices on the Pi.
- Skip Pi UART2 (pins 27/28 are for HAT ID EEPROMs) and UART1 (the mini UART drifts).

Steps:

1. - [ ] Pi boot config: confirm `/boot/firmware/config.txt` has `enable_uart=1`, `dtoverlay=disable-bt`, `dtoverlay=uart3`, `dtoverlay=uart4`, `dtoverlay=uart5`.
   Run `sudo systemctl disable hciuart` and turn off the serial login console in `raspi-config`.
   Reboot and check that `ls /dev/ttyAMA*` lists the UARTs.
   (Camille owns the software side; pair with her on this step.)
2. - [ ] Maestros: plug each Maestro into a laptop over USB, open Maestro Control Center, and switch the serial mode to UART.
   Write the baud rate you set (`maestro_a.baud`, `maestro_b.baud`) and turn on the serial timeout if the setting exists (robot.md 10.5).
3. - [ ] Wire Maestro A to UART3 and Maestro B to UART5, with servo power from the actuator rail.
4. - [ ] Test each Maestro with one servo, horn off or leg free to move: `robot_diag servo <ch> <us>` within a safe range, or Maestro Control Center over USB if `robot_diag` is not ready.
   Write the safe min and max pulse width per channel you tried (`servos.<ch>.min_us`, `max_us`).
5. - [ ] Wire DC driver A to UART4 and DC driver B to UART0 (or, if M0 found PWM plus direction, write which pins you used and tell Camille so she drops the UART4 and UART0 overlays).
6. - [ ] Pico: flash Camille's firmware (hold BOOTSEL, copy the `.uf2`), plug it into the Pi, and check `ls /dev/serial/by-id/` shows it.
7. - [ ] Wire the LD19 to Pico UART0, the single-point LiDAR to Pico UART1, the thermal camera alone on I2C0, and the IMU plus ADS1115 on I2C1.
8. - [ ] Wire the 4 FSRs to ADS1115 A0 to A3 through their divider resistors (value TBD from the FSR datasheet), and write which FSR is on which input.
9. - [ ] Camera: connect the ribbon to the Pi CSI port (contacts facing the right way for the Pi 4B), and run `rpicam-still -o test.jpg` (or `robot_diag camera --still out.jpg`).
10. - [ ] GPS: plug the USB adapter or dongle into the Pi, run `udevadm info -a -n /dev/ttyUSB0` (or `/dev/ttyACM1`), and write the `idVendor` and `idProduct` for the `gps0` udev rule.
    Set `DEVICES="/dev/gps0"` in `/etc/default/gpsd`.
11. - [ ] udev names: with Camille, run `udevadm info -a -n /dev/ttyAMAx` for each UART and the Pico, fill the `KERNELS` and USB ids in `99-robot.rules` (robot.md 14.4), reload, and confirm `/dev/servo45`, `/dev/servo25`, `/dev/dcmotorA`, `/dev/dcmotorB`, `/dev/pico`, `/dev/gps0` exist.
12. - [ ] Run the per-device tests in order (robot.md 16.3), and tick each one:
    - [ ] `robot_diag pico`: VERSION, heartbeats both ways, `DEV_STATUS` for each device.
    - [ ] `robot_diag thermal`: ASCII frame, and a hand in front at 1 m shows a blob.
    - [ ] `robot_diag imu`: gyro near 0 at rest.
    - [ ] `robot_diag lidar_single` and `robot_diag ld19`: sane ranges against a wall at a measured distance.
    - [ ] `robot_diag camera --clip 20 out.mp4`: plays back, and the log shows the frame rate.
    - [ ] GPS outdoors: `cgps -s` shows a fix, then `robot_diag gps`.
    - [ ] ADS1115: pressing each FSR changes only its own channel.
13. - [ ] Thermal mask: look at a thermal frame with the robot powered and write the pixel rectangles where the Pi or motor drivers show as hot (`thermal.mask`).
14. - [ ] Thermal yaw offset: point the robot at a warm object straight ahead and write the column offset as `thermal.yaw_offset_deg`.
15. - [ ] Post each passed device in the team chat as it passes, so Camille can switch that mock off.

Done when: each device answers a simple test (Camille's mocks can be swapped for the real device one at a time).

Common failure modes and quick fixes:

- No data on a UART: TX and RX swapped, wrong baud, or no common ground; swap the pair first.
- Maestro ignores serial: still in USB mode; redo step 2 and power-cycle it.
- `/dev/ttyAMAx` missing: overlay not applied or Bluetooth still on UART0; recheck step 1 and reboot.
- I2C device not found: SDA and SCL swapped, missing pull-ups, or a wrong address; scan the bus from a Pico test firmware (ask Camille) and compare against the datasheet address.
- Thermal frames frozen or slow: frame reads block the bus; it must stay alone on I2C0.
- Grid-EYE style sensor reads oddly at power-up: its output takes about 15 s to stabilize (robot.md 7.5); wait.
- Camera not detected: ribbon reversed or loose; reseat with power off.
- gpsd shows no device: wrong path in `/etc/default/gpsd`; run `gpsmon /dev/gps0` to check raw data.

### M3. Drive on mecanum wheels

Goal: the robot drives straight, strafes, and turns in place from a script.
Why it matters: the robot must cross the mock rubble to find the teammate (demo beat 0:50 to 1:50, MVP priority 3).
Estimate with AI: 1 h.

Inputs: M2 DC drivers answering, Camille's `drive_only` motion code (R8), a tape measure.
Outputs: `motion.mecanum.*` values, speed limits, `odometry.scale`.
Receivers: Camille (config), Eric (terrain tuning needs a moving robot).

Safety notes:

- Wheels off the ground, e-stop in hand, for steps 1 to 4.
- On the floor, start at the default limits (`limits.max_lin_mps: 0.2`, `max_ang_dps: 45`) and keep people's feet clear.

Steps:

1. - [ ] Measure the wheel radius (`wheel_radius_m`), half the left-right wheel spacing (`half_track_lx_m`), and half the front-back spacing (`half_base_ly_m`) at the default stance, in meters.
2. - [ ] Mark each wheel with tape as front-left, front-right, rear-left, rear-right, and note the roller direction seen from above.
3. - [ ] Wheels off the ground: `robot_diag motor A1 0.1`, then A2, B1, B2, one at a time.
   Write which physical wheel spins and whether it spins forward.
4. - [ ] With Camille, fill `wheel_order` (the physical wheel for paper index 1 to 4, robot.md 12.4) and `invert` (true for any wheel that spins backward).
5. - [ ] On the floor of the demo area: `robot_diag drive vx 0.1` must drive straight forward.
6. - [ ] `robot_diag drive vy 0.1` must strafe left with no turning.
7. - [ ] `robot_diag drive wz 20` must spin in place counterclockwise.
   If any of steps 5 to 7 is wrong, fix `wheel_order` or `invert`, not the code, and repeat.
8. - [ ] Odometry: command a 2 m straight drive, measure the real distance, and write `odometry.scale = real / commanded`.
9. - [ ] Speed limits: raise `limits.max_lin_mps` and `max_ang_dps` in small steps until the robot is still controlled on the demo floor; write the highest safe values.
10. - [ ] Write `motion.mecanum.max_wheel_rad_s` from the motor datasheet or the fastest clean run.
11. - [ ] Post every value in the team chat and the TBD table.

Done when: the robot drives forward, sideways, and turns in place from a script, on the floor of the demo area.

Common failure modes and quick fixes:

- Strafes diagonally: one wheel's roller direction is mounted wrong (mecanum needs an X pattern from above), or one wheel is inverted; swap the wheel or fix `invert`.
- Robot curves when driving straight: wheels slip or one motor is weaker; check wheel set screws and floor grip.
- Motors twitch but do not turn: actuator rail too low under load; measure it while driving.
- A motor never moves: driver channel mapping wrong; re-run step 3.

### M4. Light for the camera

Goal: enough steady visible light on the chest for a 20 s breathing clip in the demo lighting.
Why it matters: the breathing check (demo beat 0:50 to 1:50, MVP priority 3) uses a regular camera; with no light, perception returns `unknown` with "clip too dark".
Estimate with AI: 1 h.

Inputs: the demo booth lighting (dim, blanket over a frame, `docs/specs/demo.md` Part 3), a candidate white LED light, a teammate to lie in the set.
Outputs: the light decision (`light.impl: mock | maestro_digital | manual`, `light.maestro_channel`), a test clip.
Receivers: Eric (E1 clips, E3 tuning), Camille (light config).

Safety notes:

- A light switched from a Maestro channel needs a logic-level MOSFET between the channel and the light; never power the light from the Maestro signal pin.
- Keep the light's power on the logic rail or a separate supply decided with Camille; if it sits on the actuator rail, the e-stop turns it off too.

Steps:

1. - [ ] Pick the light: a small white LED panel or strip switched by a MOSFET from a spare Maestro channel (`light.impl: maestro_digital`), or a USB LED light switched by hand and left on (`light.impl: manual`) (robot.md 12.3).
   The part is TBD; use what the team has or can buy at the event.
2. - [ ] Mount it next to the camera, pointed where the camera points, so the chest is lit from the front.
3. - [ ] Check for flicker: film the light with a phone camera in slow motion; banding or pulsing means it flickers.
   Steady light matters more than bright light (flicker fakes a breathing signal).
4. - [ ] If using a Maestro channel, write `light.maestro_channel`, and test that a target of 6000 or more turns it on (robot.md 12.3).
5. - [ ] In the dim set, with a teammate lying chest visible about 1 m away, record `robot_diag camera --clip 20 out.mp4` with exposure locked.
6. - [ ] Send the clip to Eric (shared drive, labelled "M4 light test, dim set, chest visible, <light on or off>").
7. - [ ] Also record one clip with the light off, so Eric has a "too dark" clip (E1).

Done when: Eric confirms a breathing clip recorded by the robot in the demo lighting is bright enough (not rejected as "too dark").

Common failure modes and quick fixes:

- Clip rejected as too dark: move the light closer, open a gap in the blanket, or raise the room light a little.
- Clip comes back "lighting or exposure changed": the light flickers or auto exposure was on; use a steady light and confirm the exposure lock.
- Light glares off a shiny surface: angle it down or diffuse it with paper.

## Phase 2: integrate

### M5. Legs (with Camille)

Goal: raise and lower the body on command, and lift one leg, through inverse kinematics.
Why it matters: raising the body helps the robot clear debris on the rubble (MVP "could have"); wheels alone still pass the demo.
Estimate with AI: 2 h.

Inputs: M0 leg geometry, M2 Maestros answering with safe pulse ranges, Camille's `ILegIK` code (robot.md 12.5).
Outputs: `legs.*` and `servos.*` values (stance height, link lengths, channel map, per-channel `min_us`, `max_us`, `zero_us`, direction, `max_rate_us_per_s`), a go or no-go on legs.
Receivers: Camille (R8), the team (go or no-go).

Safety notes:

- Robot on a stand with the wheels off the ground for every first leg move.
- Start with low `servos.max_rate_us_per_s` so a wrong target moves slowly.
- Keep fingers out of the joints; the 45kg servos can pinch hard.
- While a leg is lifted, translation is zero (the safety gate enforces it).

Steps:

1. - [ ] Give Camille the geometry from M0 step 1 and agree on the leg-plane frame (x forward, z down from the hip).
2. - [ ] For each channel, find the pulse width where the joint is at its zero pose and write `zero_us` and the direction (+1 or -1).
3. - [ ] Find the mechanical limits per channel by moving slowly toward each end, and set `min_us` and `max_us` a little inside them.
4. - [ ] On the stand: `robot_diag stance <height>` at the default stance height; measure the real hub height and compare.
5. - [ ] Try a lower and a higher stance; write the working range and the default `legs.stance_height_m`.
6. - [ ] On the stand: lift one leg a small height; confirm only that leg moves and the others hold.
7. - [ ] On the floor: raise the body, then drive slowly (`robot_diag drive vx 0.1`); check it stays stable.
8. - [ ] Measure how high a step the robot can cross with the body raised and write `terrain.max_step_m`.
9. - [ ] Stretch: step over a low obstacle.
10. - [ ] If stance is not reliable by checkpoint 4, call "wheels only" in the team chat, so Camille keeps `motion.impl: drive_only`.

Done when: the robot can raise its body for clearance on command, or the team agrees wheels only.

Common failure modes and quick fixes:

- Joint moves the wrong way: flip its direction in config, not the wiring.
- Servo buzzes or gets hot holding stance: it is at a mechanical limit or overloaded; lower the stance or tighten `min_us` and `max_us`.
- Body tilts at stance: one leg's `zero_us` is off; recalibrate it.
- Brownout when all servos move at once: the servo rail sags; check the rail under load and slow `max_rate_us_per_s`.

### M6. Thermal range test (with Eric)

Goal: measure how far and how covered the thermal camera still sees a person, and set the thresholds from it.
Why it matters: the robot's find (demo beat 0:50 to 1:50, MVP priority 3, NVIDIA and State Farm) depends on these thresholds; no threshold is locked before this test (robot.md 7.5).
Estimate with AI: 1 h.

Inputs: M2 thermal camera working, the sensor log on the robot, `robot_diag thermal --replay <file>`, a tape measure, a thin blanket, boxes, a teammate.
Outputs: a results table, values for `thermal.delta_c`, `min_blob_px`, `min_c`, `max_c`, `person_width_m`, `size_tolerance`, and the approach distance `inspect.standoff_m`.
Receivers: Camille (thresholds), Eric (thermal confidence feeds the critical score).

Steps:

1. - [ ] Power the robot and wait at least 15 s for the thermal output to stabilize (robot.md 7.5).
2. - [ ] Mark 0.5, 1, 2, 3, and 4 m on the floor from the thermal camera with tape.
3. - [ ] Turn the lights off (thermal works in the dark).
4. - [ ] At each distance, record 30 s of thermal frames in each condition: uncovered, under a thin blanket, and partly behind boxes.
   That is 15 recordings; the sensor log saves them (`thermal.bin`).
5. - [ ] Record one 30 s empty scene (no person) as the baseline.
6. - [ ] For each recording, run `robot_diag thermal --replay <file>` and write the blob stats: max temperature, background, contrast, blob area, blob width in pixels.
7. - [ ] Fill this table:

   | Distance (m) | Condition | Blob found (yes/no) | Contrast (C) | Area (px) | Width (px) | Notes |
   | --- | --- | --- | --- | --- | --- | --- |
   | 0.5 | uncovered | | | | | |
   | ... | ... | | | | | |

8. - [ ] With Camille, set `delta_c` from the lowest contrast that still separates the person from the empty scene, and `min_blob_px` from the smallest real blob.
9. - [ ] Set `min_c` and `max_c` from the measured temperatures (they are placeholders now, not physiological facts).
10. - [ ] Set `inspect.standoff_m` to a distance where the person is found in every condition you plan to show (the docs start at 1.0 m).
11. - [ ] Check for false positives: point the camera at the robot's own electronics and any heater at the venue; add a mask if needed.

Done when: the results table is in `docs/specs/perception.md`, and the robot's approach distance is set from it.
(`docs/specs/robot.md` section 7.5 also says to note the table in `docs/ROBOT.md` open questions; ask the doc owner to add a one-line pointer there.)

Common failure modes and quick fixes:

- No blob behind boxes: expected, thermal cannot see through boxes, glass, or rubble; the set must leave part of the person in line of sight.
- Blob at every distance from the robot itself: hot electronics in view; add them to `thermal.mask`.
- Contrast too low in a warm room: test at the real venue temperature, and lower the standoff distance.

### M7. Mock rubble set

Goal: a physical set the robot can cross, with a person hidden but partly visible, labelled to match the demo map.
Why it matters: it is the stage for the robot's find and breathing check (demo beat 0:50 to 1:50) and shots 1 and 2 of the video.
Estimate with AI: 1 h.

Inputs: boxes, foam blocks, bricks, blankets, a frame for the blanket, tape, printed signs, M3 drive working, M4 light decision.
Outputs: the built set, photos in the shared drive, LiDAR mounting values from driving it (`terrain.ground_range_m` if the single LiDAR points down).
Receivers: everyone (rehearsal), Eric and Camille (terrain tuning from the raw logs).

Steps:

1. - [ ] Build three labelled "houses" (piles of boxes, foam blocks, blankets).
   The real pile is "house 3" in `backend/sim/demo-site.json`; label the signs to match the demo map ("House 3").
2. - [ ] Make the robot's path into house 3 crossable: low debris first, with a 3 to 5 cm step, a patch of loose debris, and one box to steer around, so Eric and Camille can tune terrain (robot.md 16.3, step 15).
3. - [ ] Build the hiding spot: a blanket over a frame so it is dim inside, not fully dark, with the teammate's chest or back in line of sight of the robot.
4. - [ ] Leave a gap in the blanket or use the robot light (M4) so the camera has visible light.
5. - [ ] Mark the "house 3 front door" start spot on the floor with tape (the robot starts here before each judge group).
6. - [ ] Drive the robot through the set three times in a row by script; note any spot where it sticks and fix the set, not the robot.
7. - [ ] Record raw logs while driving (the sensor log does it) and tell Eric which run is which.
8. - [ ] Photograph the set from above and from robot height, and upload the photos.
9. - [ ] Write a one-line build list (what goes where) so the set can be rebuilt at the booth in under 10 minutes.

Done when: the robot crosses the set three times in a row without getting stuck.

Common failure modes and quick fixes:

- Robot sticks on a box edge: lower the step, or round the edge with foam.
- Mecanum rollers jam on loose cloth: tape the blanket edges down on the path.
- Terrain says `blocked` on every run: the LD19 sees the blanket frame; widen the entrance or move the frame.
- Set falls apart between runs: tape the pile together underneath.

## Phase 3: demo

### M8. Outdoor test and footage (PROPOSED)

Goal: real GPS on the robot and the rescuer's phone outdoors, and the robot footage for the video.
Why it matters: the venue is indoors (fixed coordinates), so real GPS and outdoor driving appear only in the video (shot 11); robot footage is shot 2.
Estimate with AI: 1 h.

Inputs: M2 GPS working, M3 drive, M7 set, Cayden with the glasses and phone, the dashboard on a laptop, a phone for filming.
Outputs: labelled clips in the shared drive, listed in `docs/specs/demo.md`.
Receivers: Cayden (video edit).

Safety notes:

- Drive at the floor-test speed limits on an open lot away from cars and people.
- Carry the e-stop; a lost network does not stop the robot by itself.

Steps:

1. - [ ] Pick an open lot near the venue with open sky.
2. - [ ] Run with `site.demo_mode` false, and wait for a GPS fix (`cgps -s` shows a 2D or 3D fix).
3. - [ ] Confirm the robot's live marker appears on the dashboard map and moves when it drives.
4. - [ ] Cayden walks for about 2 minutes; confirm his marker moves, the glasses switch from map to arrow when close, and the arrow points the right way (GPS is about 2.5 m in open sky).
5. - [ ] Film shot 11: `dog1` and Cayden with live markers moving on the dashboard.
6. - [ ] Film shot 2 at the set: a low shot following `dog1` across the mock rubble into the dim pile, phone at robot height.
7. - [ ] Film shot 1: a wide shot of the pile with lights on, the teammate climbing in, then the lights dimming.
8. - [ ] Keep strangers' faces, house numbers, and license plates out of frame.
9. - [ ] Upload each clip with a name like `shot02_robot_crossing_take1.mp4`, and post the list in the team chat for Cayden.

Done when: the clips are in the shared drive and listed in `docs/specs/demo.md`.

Common failure modes and quick fixes:

- No fix: buildings block the sky; move to a more open spot and wait a few minutes.
- Marker jumps around: normal GPS noise at about 2.5 m; keep the clip short.
- Shaky robot shot: brace the phone on a box or a skateboard at robot height.

### M9. Hardware reliability for judging

Goal: the robot cold-starts at the booth quickly, and every likely break has a spare.
Why it matters: the robot find is a beat that is never cut; a robot that will not start forces the rehearsal-video fallback.
Estimate with AI: 0.5 h.

Inputs: everything above, the M9 spares list from M1.
Outputs: the power-up checklist below, a packed spares box.
Receivers: the robot handler at the booth.

Steps:

1. - [ ] Charge the main and spare batteries and label them.
2. - [ ] Pack the spares box (see "Demo day" below).
3. - [ ] Check that `robot.service` and `robot-bridge.service` start on boot (Camille's R9).
4. - [ ] Time a cold start with the power-up order below, twice, and write the times.
5. - [ ] Tug-test every connector and add hot glue or zip ties to any loose one.

Done when: a cold start at the demo table takes under 3 minutes, tried twice.

Common failure modes and quick fixes:

- A device is missing after boot: a loose connector; check `/dev/servo45`, `/dev/servo25`, `/dev/dcmotorA`, `/dev/dcmotorB`, `/dev/pico`, `/dev/gps0`.
- Robot shows offline on the dashboard: it is not on the team hotspot; check Wi-Fi first.
- Battery runs low during judging: swap packs between judge groups, not during.

## Demo day

What to bring:

- [ ] The robot, the e-stop, and the stand for wheels-off tests.
- [ ] Main battery and spare battery, both charged, and the charger.
- [ ] Spare fuse (rating from M1), spare connectors, jumper wires, servo extension leads, heat shrink, zip ties, tape.
- [ ] One spare servo of each size if available.
- [ ] Multimeter, small screwdrivers, hex keys for the wheels, hot glue.
- [ ] USB cables for the Pico and the GPS, a micro-USB or USB cable for each Maestro (for Maestro Control Center).
- [ ] A copy of the Pi SD card (image backup), labelled.
- [ ] The robot white light (if used) and its cable.
- [ ] Mock rubble materials, blankets, the frame, signs, and the floor tape for the start spot.
- [ ] A laptop that can SSH into the Pi.

Power-up order (target under 3 minutes):

1. - [ ] Press the e-stop in (actuators off).
2. - [ ] Connect the battery; the logic rail powers the Pi and the Pico.
3. - [ ] Wait for the Pi to boot and join the team hotspot.
4. - [ ] SSH in and check the device names exist and `systemctl status robot robot-bridge` is active.
5. - [ ] Check the dashboard: `dog1` online, state READY.
6. - [ ] Wait at least 15 s after power-up before trusting the thermal camera.
7. - [ ] Place the robot on the "house 3 front door" mark.
8. - [ ] Release the e-stop.
9. - [ ] Light on (if used), then tell the presenter the robot is ready.

Before each judge group: check the battery, the set (teammate in place, blanket gap or light on), and that the robot is on its mark.

Power-down order: e-stop in, `sudo shutdown now` on the Pi, wait for the Pi to stop, then disconnect the battery.
