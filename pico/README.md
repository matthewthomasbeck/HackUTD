# Pico firmware

Firmware for the Raspberry Pi Pico 1.0 (RP2040) that owns the robot's sensors and streams them to the Pi over USB serial.
It is the starting point for task R4 in `docs/tasks/camille.md`.
It was written and bench tested on Nov 7 and 8, 2026 in Camille's hardware test repo (`C_Hardware_Testing`), and is copied here unchanged apart from comments and the library path.

## What it does

- Initializes the MPU6050 IMU, the ADS1115 with 4 FSRs, the MLX90640 thermal camera, the LD19 lidar and the TF-Luna single-point lidar, and reports OK, NotFound or Error for each.
- Streams readings as text lines while the Pi has sent `STREAM 1`.
- Captures thermal frames on core 1, so the 40 ms frame reads never delay the IMU.
- Receives both lidars through UART IRQ ring buffers, so they never overflow during a thermal read.
- Recovers a jammed I2C bus (9 SCL pulses and a STOP after 3 failures) and retries missing chips every 3 s while streaming.
- Ignores lines that contain binary bytes, so a Maestro driver probing the wrong port gets no reply.

## Wiring as tested on the bench

This is how the bench rig was wired, not a confirmed team pin map (`docs/ROBOT.md` still lists the pin map as proposed).
The pins live in `src/config.hpp`.

| Device | Bus | Pico pins (physical) | Address or baud |
| --- | --- | --- | --- |
| MPU6050 IMU | I2C0 at 100 kHz | SDA GP4 (6), SCL GP5 (7) | 0x68 |
| ADS1115 and 4 FSRs | I2C0 | SDA GP4 (6), SCL GP5 (7) | 0x48, ADDR tied to GND |
| MLX90640 thermal | I2C1 at 400 kHz | SDA GP14 (19), SCL GP15 (20) | 0x33, 8 Hz |
| LD19 lidar | UART0, receive only | RX GP1 (2), CTL to GND | 230400 |
| TF-Luna | UART1, receive only | RX GP9 (12) | 115200 |

The I2C devices take 3V3 (pin 36), and both lidars take 5 V from VBUS (pin 40).
A floating ADS1115 ADDR pin drifts between 0x48 and 0x4B, so tie it to GND.

## Commands and stream

The Pi sends one text command per line.

| Command | Reply ends with |
| --- | --- |
| `PING` | `PONG <version>` |
| `STATUS` | a device report, then one `STATUS ...` line |
| `INIT` | re-runs every device init, then `STATUS` |
| `SCAN` | `SCAN i2c0: ... i2c1: ...` |
| `READ` | one reading per device, then `READ done` |
| `STREAM 1` / `STREAM 0` | `STREAM on` / `STREAM off` |
| `LIDARPROBE` | which lidar is on which pin, then `LIDARPROBE done` |

While streaming, each line is one packet (`<ms>` is the Pico uptime):

```
IMU <ms> <ax_g> <ay_g> <az_g> <gx_dps> <gy_dps> <gz_dps> <temp_c>   about 50 Hz
ADS <ms> <v0> <v1> <v2> <v3>                                         about 20 Hz
THM <ms> <seq> <ta_c> <min_c> <max_c> <p0> .. <p767>                 about 8 Hz, tenths of a degree C, 32x24
LDP <ms> <94 hex chars>                                              every raw LD19 packet, about 450 Hz
TFL <ms> <dist_cm> <strength> <temp_c>                               about 50 Hz
LOG <ms> <text>                                                      bus recoveries, chips coming back
```

## Build and flash

You need the Pico SDK with its `lib/tinyusb` submodule and `arm-none-eabi-gcc`.

```
export PICO_SDK_PATH=/path/to/pico-sdk
cmake -S pico -B pico/build
cmake --build pico/build -j
```

Flash by holding BOOTSEL while plugging in the Pico and copying `pico/build/argos_pico.uf2` onto the `RPI-RP2` drive.
From a Pi with the Pico already running, `stty -F <port> 1200` reboots it into BOOTSEL without pressing the button.
Check the version with `PING`; expect `PONG 0.9`.

Build with `-DARGOS_THERMAL_ON_GP2=ON` if the thermal camera is wired to GP2 and GP3.

## Status

- Versions up to 0.8 were flashed and tested on the bench: IMU, ADS1115 and thermal stream to the Pi.
- 0.9 adds the `LDP` and `TFL` lidar lines. It has not been built or flashed yet.
- Known problem: the IMU and ADS1115 drop out within seconds while the thermal camera streams, even on separate buses.
  The IMU reports odd temperatures after recoveries, which points to the IMU board browning out.
  The next test is powering the IMU differently.

## Gaps against `docs/ROBOT.md` and R4 (for the team to decide)

- Protocol: this firmware uses the text lines above.
  `docs/ROBOT.md` proposes binary frames (`0xAA 0x55`, type, device, length, payload, CRC16) with HELLO/VERSION, DEV_STATUS, DATA and HEARTBEAT.
  Either the firmware moves to the binary frames, or the text protocol is proposed as a contract change.
- Heartbeat: there is no heartbeat yet.
  The Pi can use packet freshness for now, but R4 asks for a 20 Hz heartbeat each way.
- Hardware watchdog: the loop does not call `watchdog_enable()` or feed it yet.
- The Pi side in `raspberrypi/robot/src/hal/pico_link_serial.cpp` is still a stub and does not read this stream.

## Files

- `src/main.cpp`: command handling, the streaming loop and lidar forwarding.
- `src/config.hpp`: pins, addresses and timeouts.
- `src/bus/`: I2C helpers with bus recovery, and the UART IRQ ring buffer.
- `src/devices/`: one driver per sensor.
- `third_party/mlx90640/`: the Melexis MLX90640 library (Apache 2.0), used by `src/devices/thermal.cpp`.
