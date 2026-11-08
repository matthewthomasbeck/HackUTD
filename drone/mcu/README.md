# Drone MCU firmware

Firmware for the drone's microcontroller, the drone's copy of `pico/`.
It owns the drone's sensors and streams them to the drone's Pi over USB serial, with the same superloop and the same text commands as the dog's Pico.
Build, flash, and the open questions are in `drone/README.md`.

The board and the sensors are not confirmed.
The firmware assumes a Raspberry Pi Pico (RP2040) and the Pico C SDK, like the dog, and has no pin map: `src/config.hpp` holds only timing values.
The only sensor slot is the IMU, and its driver (`src/devices/imu.cpp`) reports NOT_FOUND until the model is known.

## Commands and stream

The Pi sends one text command per line.

| Command | Reply ends with |
| --- | --- |
| `PING` | `PONG <version>` (0.1) |
| `STATUS` | a device report, then one `STATUS imu=<state>` line |
| `INIT` | re-runs every device init, then `STATUS` |
| `READ` | one reading per OK device, then `READ done` |
| `STREAM 1` / `STREAM 0` | `STREAM on` / `STREAM off` |

While streaming, each line is one packet (`<ms>` is the MCU uptime):

```
HB <ms>                                                              20 Hz (cfg::heartbeat_period_ms, TBD)
IMU <ms> <ax_g> <ay_g> <az_g> <gx_dps> <gy_dps> <gz_dps> <temp_c>   50 Hz, once an IMU driver exists
LOG <ms> <text>                                                      a sensor coming back, a watchdog reboot
```

`HB` is the one line the dog's Pico does not send.
The dog's Pi counts any line as the heartbeat, which works there because the IMU streams at 50 Hz; the drone has no confirmed sensor, so `HB` keeps the link alive by itself.
The Pi parses these lines in `drone/pi/src/hal/mcu_text_protocol.cpp`.

## Superloop

One loop on core 0, no OS, as on the dog: read waiting command bytes without blocking, then, while streaming, the heartbeat, IMU, and retry tasks, each due on its own timer, then the LED, then one `watchdog_update()`, then a short sleep.
The hardware watchdog is enabled after the USB wait (`cfg::watchdog_ms`, TBD), so a hung loop resets the MCU, and the next boot logs `rebooted by the watchdog`.
Streaming stops by itself when the port closes, so writes never stall the loop.

## Files

- `src/main.cpp`: command handling, the streaming loop, and the watchdog.
- `src/config.hpp`: timing values, no pins.
- `src/devices/status.hpp`: the per-device status record, copied from `pico/`.
- `src/devices/imu.*`: the IMU slot, a stub until the model is confirmed.
