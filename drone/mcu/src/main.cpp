// Drone MCU firmware (the drone's copy of pico/src/main.cpp, Pico C SDK).
//
// The same job as the dog's Pico: own the sensors and report them to the Pi. The board and the
// sensors are not confirmed (drone/README.md), so only the IMU slot exists, and its driver
// reports NOT_FOUND until the model is known. The Pi talks to this firmware over USB serial,
// one text line per command:
//
//   PING      -> PONG <version>
//   STATUS    -> human-readable report + one "STATUS ..." line
//   INIT      -> re-run every device init, then STATUS
//   READ      -> one reading from each OK device, then "READ done"
//   STREAM 1  -> "STREAM on", then heartbeat and sensor packets until STREAM 0 (or the port closes)
//   STREAM 0  -> "STREAM off"
//
// Every reply ends with a line starting "STATUS", "PONG", "READ", "STREAM" or "ERR", so the Pi can
// wait for that prefix.
//
// Stream packets (one text line each, space separated):
//   HB <ms>                                                               cfg::heartbeat_period_ms
//   IMU <ms> <ax_g> <ay_g> <az_g> <gx_dps> <gy_dps> <gz_dps> <temp_c>     cfg::imu_period_ms
//   LOG <ms> <text>          occasional notes, e.g. a sensor coming back
// A device that is not OK sends nothing. <ms> = MCU uptime in milliseconds.
// HB is the one addition to the dog's lines: the dog's Pi counts any line as the heartbeat, which
// works there because the IMU streams at 50 Hz; the drone has no sensor yet, so HB keeps the link
// alive on its own.
//
// The superloop (no OS, as on the dog): non-blocking poll tasks driven by timers, and the hardware
// watchdog fed once per pass, so a hung loop resets the MCU.

#include <cctype>
#include <cstdio>
#include <cstring>

#include "config.hpp"
#include "devices/imu.hpp"
#include "devices/status.hpp"
#include "hardware/watchdog.h"
#include "pico/stdio.h"
#include "pico/stdio_usb.h"
#include "pico/stdlib.h"

#ifndef DRONE_MCU_FW_VERSION
#define DRONE_MCU_FW_VERSION "0.1"
#endif

enum DeviceIndex { DEV_IMU, DEV_COUNT };

static DevStatus g_dev[DEV_COUNT];

static uint32_t now_ms() {
    return to_ms_since_boot(get_absolute_time());
}

static bool dev_ok(int i) {
    return g_dev[i].state == DevState::Ok;
}

/*************** STATUS LED ***************/

static void led_init() {
#ifdef PICO_DEFAULT_LED_PIN
    gpio_init(PICO_DEFAULT_LED_PIN);
    gpio_set_dir(PICO_DEFAULT_LED_PIN, GPIO_OUT);
#endif
}

static void led_set(bool on) {
#ifdef PICO_DEFAULT_LED_PIN
    gpio_put(PICO_DEFAULT_LED_PIN, on);
#else
    (void)on;
#endif
}

static bool all_ok() {
    for (const DevStatus& d : g_dev) {
        if (d.state != DevState::Ok) {
            return false;
        }
    }
    return true;
}

/*************** REPORTS ***************/

static void print_report() {
    printf("\n[drone-mcu %s] device report\n", DRONE_MCU_FW_VERSION);
    for (const DevStatus& d : g_dev) {
        char addr[8] = "  -  ";
        if (d.addr != 0) {
            snprintf(addr, sizeof(addr), "0x%02X ", d.addr);
        }
        printf("  %-8s %-10s %s %s\n", d.name, dev_state_str(d.state), addr, d.detail);
    }
    // Single machine-readable line for the Pi's McuTextParser.
    printf("STATUS");
    for (const DevStatus& d : g_dev) {
        printf(" %s=%s", d.name, dev_state_str(d.state));
    }
    printf("\n");
}

static void init_all() {
    led_set(true);
    printf("[drone-mcu] initializing devices...\n");
    // Feed the watchdog between devices, so one slow init cannot trip it.
    watchdog_update();
    imu::init(g_dev[DEV_IMU]);
    watchdog_update();
    led_set(false);
    print_report();
}

static void cmd_read() {
    if (dev_ok(DEV_IMU)) {
        imu::Sample s;
        if (imu::read(s)) {
            printf("  imu      a=%.2f,%.2f,%.2f g  w=%.1f,%.1f,%.1f dps\n",
                   s.ax_g, s.ay_g, s.az_g, s.gx_dps, s.gy_dps, s.gz_dps);
        }
    }
    printf("READ done\n");
}

/*************** STREAMING ***************/

static bool g_stream = false;
static uint32_t g_hb_due = 0;
static uint32_t g_imu_due = 0;
static uint32_t g_retry_due = 0;

static void stream_heartbeat(uint32_t now) {
    if (now < g_hb_due) {
        return;
    }
    g_hb_due = now + cfg::heartbeat_period_ms;
    printf("HB %lu\n", static_cast<unsigned long>(now));
}

static void stream_imu(uint32_t now) {
    if (!dev_ok(DEV_IMU) || now < g_imu_due) {
        return;
    }
    g_imu_due = now + cfg::imu_period_ms;
    imu::Sample s;
    if (!imu::read(s)) {
        // A failed read marks the IMU missing; retry_missing() brings it back.
        dev_set(g_dev[DEV_IMU], DevState::Error, "read failed");
        printf("LOG %lu imu read failed\n", static_cast<unsigned long>(now));
        return;
    }
    printf("IMU %lu %.3f %.3f %.3f %.2f %.2f %.2f %.1f\n", static_cast<unsigned long>(now),
           s.ax_g, s.ay_g, s.az_g, s.gx_dps, s.gy_dps, s.gz_dps, s.temp_c);
}

// A sensor that dropped out (or was plugged in late) gets re-checked every few seconds.
static void retry_missing(uint32_t now) {
    if (now < g_retry_due) {
        return;
    }
    g_retry_due = now + cfg::retry_period_ms;
    if (!dev_ok(DEV_IMU) && imu::init(g_dev[DEV_IMU])) {
        printf("LOG %lu imu back: %s\n", static_cast<unsigned long>(now), g_dev[DEV_IMU].detail);
    }
}

static void set_stream(bool on) {
    g_stream = on;
    g_hb_due = g_imu_due = now_ms();
    printf("STREAM %s\n", on ? "on" : "off");
}

/*************** COMMANDS ***************/

static void handle_command(char* line) {
    for (char* p = line; *p; ++p) {
        *p = static_cast<char>(toupper(static_cast<unsigned char>(*p)));
    }
    if (strcmp(line, "PING") == 0) {
        printf("PONG %s\n", DRONE_MCU_FW_VERSION);
    } else if (strcmp(line, "STATUS") == 0) {
        print_report();
    } else if (strcmp(line, "INIT") == 0) {
        const bool was_streaming = g_stream;
        g_stream = false;
        init_all();
        g_stream = was_streaming;
    } else if (strcmp(line, "READ") == 0) {
        cmd_read();
    } else if (strcmp(line, "STREAM 1") == 0 || strcmp(line, "STREAM ON") == 0) {
        set_stream(true);
    } else if (strcmp(line, "STREAM 0") == 0 || strcmp(line, "STREAM OFF") == 0) {
        set_stream(false);
    } else if (line[0] != '\0') {
        // Unknown input (e.g. another program probing the port) is ignored safely.
        printf("ERR unknown command\n");
    }
}

/*************** MAIN ***************/

int main() {
    stdio_init_all();
    led_init();

    // Give the Pi a moment to open the port so it sees the boot report.
    const absolute_time_t usb_deadline = make_timeout_time_ms(cfg::usb_wait_ms);
    while (!stdio_usb_connected() && !time_reached(usb_deadline)) {
        sleep_ms(10);
    }
    if (watchdog_caused_reboot()) {
        // After the port wait, so the Pi's log shows why the MCU restarted.
        printf("LOG %lu rebooted by the watchdog\n", static_cast<unsigned long>(now_ms()));
    }

    // From here on a hung loop resets the MCU. pause_on_debug: a debugger halt does not trip it.
    watchdog_enable(cfg::watchdog_ms, true);
    init_all();

    char line[32];
    int len = 0;
    bool binary_junk = false; // line had non-text bytes
    uint32_t last_blink_ms = 0;
    bool led_on = false;

    while (true) {
        // Read command characters without blocking.
        int c = getchar_timeout_us(0);
        while (c != PICO_ERROR_TIMEOUT) {
            if (c == '\n' || c == '\r') {
                line[len] = '\0';
                // Stay silent on binary input, as on the dog: a program probing the wrong port
                // gets no reply it could misread.
                if (!binary_junk) {
                    handle_command(line);
                }
                len = 0;
                binary_junk = false;
            } else if (c < 0x20 || c > 0x7E) {
                binary_junk = true;
            } else if (len < static_cast<int>(sizeof(line)) - 1) {
                line[len++] = static_cast<char>(c);
            } else {
                len = 0; // line too long: drop it
            }
            c = getchar_timeout_us(0);
        }

        const uint32_t now = now_ms();

        if (g_stream) {
            // Nobody listening (port closed): stop, or writes would stall the loop.
            if (!stdio_usb_connected()) {
                g_stream = false;
            } else {
                stream_heartbeat(now);
                stream_imu(now);
                retry_missing(now);
            }
        }

        // LED: slow 1 Hz blink = all devices OK, fast 5 Hz blink = something failed.
        const uint32_t half_period = all_ok() ? 500 : 100;
        if (now - last_blink_ms >= half_period) {
            led_on = !led_on;
            led_set(led_on);
            last_blink_ms = now;
        }

        // Once per pass, the only place in the loop that feeds the watchdog.
        watchdog_update();

        // Short nap: keeps the loop from spinning flat out without slowing the stream.
        sleep_us(g_stream ? 200 : 1000);
    }
}
