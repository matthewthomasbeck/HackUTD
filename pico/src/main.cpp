// ArgOS Pico firmware (Raspberry Pi Pico 1.0 / RP2040).
//
// Whiteboard step 2-B: initialize the Pico's devices and report to the Pi.
//   IMU (I2C0, GP4/GP5)  ADS1115 (I2C0)  Thermal cam (I2C1, GP14/GP15)
//   LD19 (UART0, GP1)  TF-Luna (UART1, GP9)
//
// The Coral, cameras, Pololus and DC motors stay on the Pi. The Pi talks to
// this firmware over USB serial (/dev/serial/by-id/usb-Raspberry_Pi_Pico_*),
// one text line per command:
//
//   PING      -> PONG <version>
//   STATUS    -> human-readable report + one "STATUS ..." line
//   INIT      -> re-run every device init, then STATUS
//   SCAN      -> "SCAN i2c0: 0x48 0x68 i2c1: 0x33" (every address on both buses)
//   READ      -> one reading from each OK device, then "READ done"
//   STREAM 1  -> "STREAM on", then sensor packets until STREAM 0 (or the port closes)
//   STREAM 0  -> "STREAM off"
//   LIDARPROBE -> listen on both lidar pins at both speeds, decode both formats,
//                 print what each pin really carries; ends "LIDARPROBE done"
//
// Every reply ends with a line starting "STATUS", "PONG", "SCAN", "READ",
// "STREAM" or "ERR", so the Pi can wait for that prefix.
//
// Stream packets (one text line each, space separated):
//   IMU <ms> <ax_g> <ay_g> <az_g> <gx_dps> <gy_dps> <gz_dps> <temp_c>     ~50 Hz
//   ADS <ms> <v0> <v1> <v2> <v3>                    volts, AIN0..AIN3     ~20 Hz
//   THM <ms> <seq> <ta_c> <min_c> <max_c> <p0> .. <p767>                  ~8 Hz
//       pixels are integer tenths of °C, row-major 32 wide x 24 tall
//   LDP <ms> <94 hex>        every raw LD19 packet (47 bytes, CRC checked)  ~450 Hz
//   TFL <ms> <dist_cm> <strength> <temp_c>         TF-Luna range          ~50 Hz
//   LOG <ms> <text>          occasional notes, e.g. an I2C bus recovery
// A device that is not OK sends nothing. <ms> = Pico uptime in milliseconds.

#include <cctype>
#include <cstdio>
#include <cstring>

#include "bus/i2c_bus.hpp"
#include "config.hpp"
#include "devices/ads1115.hpp"
#include "devices/imu.hpp"
#include "devices/ld19.hpp"
#include "devices/status.hpp"
#include "devices/tfluna.hpp"
#include "devices/thermal.hpp"
#include "pico/stdio.h"
#include "pico/stdio_usb.h"
#include "pico/stdlib.h"
#include "bus/uart_rx.hpp"
#include "hardware/irq.h"

#ifndef ARGOS_FW_VERSION
#define ARGOS_FW_VERSION "0.9"
#endif

enum DeviceIndex { DEV_IMU, DEV_THERMAL, DEV_ADS, DEV_TFLUNA, DEV_LD19, DEV_COUNT };

static DevStatus g_dev[DEV_COUNT];
static tfluna::Sample g_tfluna;
static ld19::Packet g_ld19;
static float g_thermal_c[thermal::pixel_count];

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
    printf("\n[argos-pico %s] device report\n", ARGOS_FW_VERSION);
    for (const DevStatus& d : g_dev) {
        char addr[8] = "  -  ";
        if (d.addr != 0) {
            snprintf(addr, sizeof(addr), "0x%02X ", d.addr);
        }
        printf("  %-8s %-10s %s %s\n", d.name, dev_state_str(d.state), addr, d.detail);
    }
    // Single machine-readable line for the Pi's PicoDriver.
    printf("STATUS");
    for (const DevStatus& d : g_dev) {
        printf(" %s=%s", d.name, dev_state_str(d.state));
    }
    printf("\n");
}

static void init_all() {
    led_set(true);
    printf("[argos-pico] initializing devices...\n");

    // I2C first (fast), then the UARTs (they wait for streaming data).
    imu::init(g_dev[DEV_IMU]);
    thermal::init(g_dev[DEV_THERMAL]); // also stops core 1 if it was running
    ads1115::init(g_dev[DEV_ADS]);
    tfluna::init(g_dev[DEV_TFLUNA]);
    ld19::init(g_dev[DEV_LD19]);

    if (dev_ok(DEV_THERMAL)) {
        thermal::start_background();
    }

    led_set(false);
    print_report();
}

static void cmd_scan() {
    uint8_t found[32];
    printf("SCAN i2c0:");
    int n = i2cbus::scan(ARGOS_SENSOR_I2C, found, 32);
    for (int i = 0; i < n; ++i) {
        printf(" 0x%02X", found[i]);
    }
    printf(" i2c1:");
    if (thermal::core1_stats().running) {
        // Core 1 is reading the camera on this bus right now; probing it from
        // here would collide with that and print garbage.
        printf(" (busy: thermal camera streaming at 0x33)\n");
        return;
    }
    n = i2cbus::scan(ARGOS_THERMAL_I2C, found, 32);
    for (int i = 0; i < n; ++i) {
        printf(" 0x%02X", found[i]);
    }
    printf("\n");
}

static void cmd_read() {
    if (dev_ok(DEV_IMU)) {
        imu::Sample s;
        if (imu::read(s)) {
            printf("  imu      a=%.2f,%.2f,%.2f g  w=%.1f,%.1f,%.1f dps\n",
                   s.ax_g, s.ay_g, s.az_g, s.gx_dps, s.gy_dps, s.gz_dps);
        }
    }
    if (dev_ok(DEV_ADS)) {
        float v[ads1115::channel_count] = {};
        bool ok = true;
        for (int ch = 0; ch < ads1115::channel_count; ++ch) {
            ok = ok && ads1115::read_channel(ch, v[ch]);
        }
        if (ok) {
            printf("  ads1115  %.3f %.3f %.3f %.3f V\n", v[0], v[1], v[2], v[3]);
        }
    }
    if (dev_ok(DEV_THERMAL)) {
        float ta = 0, lo = 0, hi = 0;
        uint32_t seq = 0; // 0 = take whatever is newest
        if (thermal::latest(g_thermal_c, ta, lo, hi, seq)) {
            printf("  thermal  Ta=%.1fC min=%.1fC max=%.1fC centre=%.1fC\n", ta, lo, hi,
                   g_thermal_c[12 * thermal::width + 16]);
        }
        const thermal::Core1Stats c = thermal::core1_stats();
        printf("  thermal  core1 %s frames=%lu fails=%lu recovers=%lu last_err=%d\n",
               c.running ? "running" : "STOPPED", static_cast<unsigned long>(c.frames),
               static_cast<unsigned long>(c.fails), static_cast<unsigned long>(c.recovers),
               c.last_error);
    }
    if (dev_ok(DEV_TFLUNA)) {
        tfluna::poll(g_tfluna);
        printf("  tfluna   dist=%ucm strength=%u\n", g_tfluna.dist_cm, g_tfluna.strength);
    }
    if (dev_ok(DEV_LD19)) {
        ld19::poll(g_ld19);
        printf("  ld19     %.1fHz  %.1f-%.1f deg  first=%umm\n",
               g_ld19.speed_dps / 360.0f, g_ld19.start_deg, g_ld19.end_deg, g_ld19.dist_mm[0]);
    }
    printf("READ done\n");
}

/*************** STREAMING ***************/

static bool g_stream = false;

static constexpr uint32_t imu_period_ms = 20;  // 50 Hz
static constexpr uint32_t ads_period_ms = 50;  // 20 Hz full sets
static constexpr uint32_t ads_conv_ms = 9;     // 128 SPS -> 7.8 ms per channel

static constexpr uint32_t ads_poll_ms = 2;    // don't hammer the bus while waiting
static constexpr int i2c0_fail_limit = 3;      // consecutive failures before recovering
static constexpr uint32_t recover_gap_ms = 250;
static constexpr uint32_t retry_period_ms = 3000; // re-try missing I2C0 chips while streaming

static uint32_t g_imu_due = 0;
static uint32_t g_ads_last_poll = 0;
static int g_i2c0_fails = 0;
static uint32_t g_i2c0_recoveries = 0;
static uint32_t g_last_recover_ms = 0;
static uint32_t g_retry_due = 0;
static uint32_t g_ads_due = 0;
static int g_ads_ch = -1; // -1 = idle, else channel being converted
static uint32_t g_ads_started = 0;
static float g_ads_v[ads1115::channel_count];
static uint32_t g_thm_seen = 0;

// Fast integer -> text (pico's printf is slow for 768 values per frame).
static char* put_int(char* p, int v) {
    if (v < 0) {
        *p++ = '-';
        v = -v;
    }
    char tmp[12];
    int n = 0;
    do {
        tmp[n++] = static_cast<char>('0' + v % 10);
        v /= 10;
    } while (v != 0);
    while (n > 0) {
        *p++ = tmp[--n];
    }
    return p;
}

/*************** LIDAR FORWARDING ***************/

// The Pi parses LD19 packets itself (LidarDriver::parse_frame), so the Pico
// forwards every CRC-good packet untouched, hex encoded: ~105 bytes x ~450/s
// = ~47 KB/s, well inside USB full speed. The UART IRQ ring (4 KB) covers any
// short USB stall.
static constexpr uint32_t tfluna_period_ms = 20; // 50 Hz is plenty for a range gate
static uint32_t g_tfl_due = 0;
static uint32_t g_tfl_seen = 0;

static void forward_ld19(const uint8_t* raw) {
    if (!g_stream) {
        return;
    }
    static const char hex[] = "0123456789ABCDEF";
    char line[4 + 12 + 1 + 94 + 2];
    char* p = line;
    *p++ = 'L'; *p++ = 'D'; *p++ = 'P'; *p++ = ' ';
    p = put_int(p, static_cast<int>(now_ms()));
    *p++ = ' ';
    for (int i = 0; i < 47; ++i) {
        *p++ = hex[raw[i] >> 4];
        *p++ = hex[raw[i] & 0x0F];
    }
    *p++ = '\n';
    stdio_put_string(line, static_cast<int>(p - line), false, false);
}

static void stream_tfluna(uint32_t now) {
    if (!dev_ok(DEV_TFLUNA) || now < g_tfl_due) {
        return;
    }
    const uint32_t ok = tfluna::frames_ok();
    if (ok == g_tfl_seen) {
        return; // nothing new since the last line
    }
    g_tfl_seen = ok;
    g_tfl_due = now + tfluna_period_ms;
    printf("TFL %lu %u %u %.1f\n", static_cast<unsigned long>(now), g_tfluna.dist_cm,
           g_tfluna.strength, g_tfluna.temp_c);
}

/*************** I2C0 BUS HEALTH (IMU + ADS1115 share it) ***************/

static void i2c0_ok() {
    g_i2c0_fails = 0;
}

// Several failures in a row usually mean a chip is holding SDA low after an
// interrupted transfer. Unstick the bus, re-configure both chips, carry on.
static void i2c0_failed(const char* who, uint32_t now) {
    if (++g_i2c0_fails < i2c0_fail_limit || now - g_last_recover_ms < recover_gap_ms) {
        return;
    }
    g_i2c0_fails = 0;
    g_last_recover_ms = now;
    ++g_i2c0_recoveries;

    i2cbus::recover(ARGOS_SENSOR_I2C);
    imu::init(g_dev[DEV_IMU]);
    ads1115::init(g_dev[DEV_ADS]);
    g_ads_ch = -1;

    printf("LOG %lu i2c0 recovered #%lu after %s failures: imu=%s ads1115=%s\n",
           static_cast<unsigned long>(now), static_cast<unsigned long>(g_i2c0_recoveries), who,
           dev_state_str(g_dev[DEV_IMU].state), dev_state_str(g_dev[DEV_ADS].state));
}

// A chip that dropped out (or was plugged in late) gets re-checked every few seconds.
// Every 5 s while streaming, report the camera loop's health if it isn't
// delivering frames cleanly, so the Pi's monitor shows why.
static uint32_t g_thm_report_due = 0;
static uint32_t g_thm_report_frames = 0;
static uint32_t g_thm_report_fails = 0;

static void report_thermal_health(uint32_t now) {
    if (!dev_ok(DEV_THERMAL) || now < g_thm_report_due) {
        return;
    }
    g_thm_report_due = now + 5000;
    const thermal::Core1Stats c = thermal::core1_stats();
    const uint32_t new_frames = c.frames - g_thm_report_frames;
    const uint32_t new_fails = c.fails - g_thm_report_fails;
    g_thm_report_frames = c.frames;
    g_thm_report_fails = c.fails;
    if (new_frames > 0 && new_fails == 0) {
        return; // healthy: stay quiet
    }
    printf("LOG %lu thermal core1 %s: +%lu frames +%lu fails (total %lu/%lu, recovers %lu, last_err %d)\n",
           static_cast<unsigned long>(now), c.running ? "running" : "STOPPED",
           static_cast<unsigned long>(new_frames), static_cast<unsigned long>(new_fails),
           static_cast<unsigned long>(c.frames), static_cast<unsigned long>(c.fails),
           static_cast<unsigned long>(c.recovers), c.last_error);
}

static void retry_missing(uint32_t now) {
    if (now < g_retry_due) {
        return;
    }
    g_retry_due = now + retry_period_ms;
    if (!dev_ok(DEV_IMU) && imu::init(g_dev[DEV_IMU])) {
        printf("LOG %lu imu back: %s\n", static_cast<unsigned long>(now), g_dev[DEV_IMU].detail);
    }
    if (!dev_ok(DEV_ADS) && ads1115::init(g_dev[DEV_ADS])) {
        g_ads_ch = -1;
        printf("LOG %lu ads1115 back: %s\n", static_cast<unsigned long>(now), g_dev[DEV_ADS].detail);
    }
    // thermal::init clears its own bus first. If the camera isn't answering at
    // all this costs ~5 ms; it only takes longer once the camera is back.
    if (!dev_ok(DEV_THERMAL) && thermal::init(g_dev[DEV_THERMAL])) {
        thermal::start_background();
        printf("LOG %lu thermal back: %s\n", static_cast<unsigned long>(now), g_dev[DEV_THERMAL].detail);
    }
}

static void stream_imu(uint32_t now) {
    if (!dev_ok(DEV_IMU) || now < g_imu_due) {
        return;
    }
    g_imu_due = now + imu_period_ms;
    imu::Sample s;
    if (!imu::read(s)) {
        i2c0_failed("imu", now);
        return;
    }
    i2c0_ok();
    printf("IMU %lu %.3f %.3f %.3f %.2f %.2f %.2f %.1f\n", static_cast<unsigned long>(now),
           s.ax_g, s.ay_g, s.az_g, s.gx_dps, s.gy_dps, s.gz_dps, s.temp_c);
}

// An ADS1115 error is usually its flaky ADDR strap moving it to another
// address, not a jammed bus. Look for it first; only count a bus failure if it
// has vanished from every address.
static void ads_failed(uint32_t now) {
    g_ads_ch = -1;
    const uint8_t before = ads1115::address();
    if (ads1115::reacquire()) {
        if (ads1115::address() != before) {
            g_dev[DEV_ADS].addr = ads1115::address();
            printf("LOG %lu ads1115 moved 0x%02X -> 0x%02X (flaky ADDR pin: tie it to GND)\n",
                   static_cast<unsigned long>(now), before, ads1115::address());
        }
        return;
    }
    i2c0_failed("ads1115", now);
}

// One channel at a time without blocking: start, come back after ~9 ms, read, next.
static void stream_ads(uint32_t now) {
    if (!dev_ok(DEV_ADS)) {
        return;
    }
    if (g_ads_ch < 0) {
        if (now < g_ads_due) {
            return;
        }
        g_ads_due = now + ads_period_ms;
        g_ads_ch = 0;
        g_ads_started = now;
        if (!ads1115::start_conversion(0)) {
            ads_failed(now);
        }
        return;
    }
    if (now - g_ads_started < ads_conv_ms || now - g_ads_last_poll < ads_poll_ms) {
        return;
    }
    g_ads_last_poll = now;
    if (!ads1115::conversion_done()) {
        if (now - g_ads_started > 50) {
            ads_failed(now); // conversion never finished: give up on this set
        }
        return;
    }
    if (!ads1115::read_result(g_ads_v[g_ads_ch])) {
        ads_failed(now);
        return;
    }
    i2c0_ok();
    if (++g_ads_ch < ads1115::channel_count) {
        g_ads_started = now;
        if (!ads1115::start_conversion(g_ads_ch)) {
            ads_failed(now);
        }
        return;
    }
    g_ads_ch = -1;
    printf("ADS %lu %.4f %.4f %.4f %.4f\n", static_cast<unsigned long>(now),
           g_ads_v[0], g_ads_v[1], g_ads_v[2], g_ads_v[3]);
}

static void stream_thermal(uint32_t now) {
    if (!dev_ok(DEV_THERMAL)) {
        return;
    }
    float ta = 0, lo = 0, hi = 0;
    if (!thermal::latest(g_thermal_c, ta, lo, hi, g_thm_seen)) {
        return;
    }
    static char line[16 + 64 + thermal::pixel_count * 6];
    int n = snprintf(line, 96, "THM %lu %lu %.2f %.2f %.2f", static_cast<unsigned long>(now),
                     static_cast<unsigned long>(g_thm_seen), ta, lo, hi);
    char* p = line + n;
    for (int i = 0; i < thermal::pixel_count; ++i) {
        const float t = g_thermal_c[i] * 10.0f;
        *p++ = ' ';
        p = put_int(p, static_cast<int>(t >= 0 ? t + 0.5f : t - 0.5f));
    }
    *p++ = '\n';
    stdio_put_string(line, static_cast<int>(p - line), false, false);
}

static void set_stream(bool on) {
    g_stream = on;
    g_ads_ch = -1;
    g_imu_due = g_ads_due = now_ms();
    printf("STREAM %s\n", on ? "on" : "off");
}

/*************** LIDAR PROBE ***************/

// Answers "which lidar is on which pin, and at what speed?" without anyone
// tracing wires: each pin is opened at 115200 and 230400, and whatever arrives
// is checked for both TF-Luna frames and LD19 packets.

static uint8_t probe_crc8(const uint8_t* p, int len) {
    uint8_t crc = 0;
    for (int i = 0; i < len; ++i) {
        crc ^= p[i];
        for (int b = 0; b < 8; ++b) {
            crc = (crc & 0x80) ? static_cast<uint8_t>((crc << 1) ^ 0x4D) : static_cast<uint8_t>(crc << 1);
        }
    }
    return crc;
}

static int count_tfluna(const uint8_t* b, int n) {
    int good = 0;
    for (int i = 0; i + 9 <= n;) {
        if (b[i] == 0x59 && b[i + 1] == 0x59) {
            uint8_t sum = 0;
            for (int k = 0; k < 8; ++k) sum = static_cast<uint8_t>(sum + b[i + k]);
            if (sum == b[i + 8]) {
                ++good;
                i += 9;
                continue;
            }
        }
        ++i;
    }
    return good;
}

static int count_ld19(const uint8_t* b, int n) {
    int good = 0;
    for (int i = 0; i + 47 <= n;) {
        if (b[i] == 0x54 && b[i + 1] == 0x2C && probe_crc8(b + i, 46) == b[i + 46]) {
            ++good;
            i += 47;
            continue;
        }
        ++i;
    }
    return good;
}

static void probe_pin(uart_inst_t* uart, int tx_pin, int rx_pin, unsigned baud) {
    // One ring per UART: the other UART keeps receiving while this one is
    // probed, and must not write into this buffer.
    static UartRx rings[NUM_UARTS];
    UartRx& rx = rings[uart_get_index(uart)];
    static uint8_t buf[4096];
    uart_rx_start(rx, uart, tx_pin, rx_pin, baud);
    sleep_ms(30);
    uart_rx_flush(rx);
    const absolute_time_t until = make_timeout_time_ms(500);
    int n = 0;
    while (!time_reached(until)) {
        uint8_t c;
        while (n < static_cast<int>(sizeof(buf)) && uart_rx_pop(rx, c)) {
            buf[n++] = c;
        }
        sleep_ms(2);
    }
    const int tf = count_tfluna(buf, n);
    const int ld = count_ld19(buf, n);
    const char* verdict = (tf > 5 && tf >= ld) ? "TF-LUNA" : (ld > 2 ? "LD19" : (n == 0 ? "silent" : "garbage"));
    printf("  GP%-2d @ %6u: %5d bytes  tfluna_frames=%-4d ld19_pkts=%-4d -> %s\n    first bytes:",
           rx_pin, baud, n, tf, ld, verdict);
    for (int i = 0; i < n && i < 24; ++i) {
        printf(" %02X", buf[i]);
    }
    printf("\n");
}

static void cmd_lidarprobe() {
    printf("[argos-pico] lidar probe (expect TF-Luna on GP%d @115200, LD19 on GP%d @230400)\n",
           cfg::tfluna_rx_pin, cfg::ld19_rx_pin);
    // Stop both normal receivers first so nothing else writes during the probe.
    irq_set_enabled(UART0_IRQ, false);
    irq_set_enabled(UART1_IRQ, false);
    probe_pin(uart0, -1, 1, 115200);
    probe_pin(uart0, -1, 1, 230400);
    irq_set_enabled(UART0_IRQ, false);
    probe_pin(uart1, -1, 9, 115200);
    probe_pin(uart1, -1, 9, 230400);
    irq_set_enabled(UART1_IRQ, false);
    // Put both lidars back on their normal settings.
    tfluna::init(g_dev[DEV_TFLUNA]);
    ld19::init(g_dev[DEV_LD19]);
    printf("  after probe: tfluna=%s (%s)  ld19=%s (%s)\n", dev_state_str(g_dev[DEV_TFLUNA].state),
           g_dev[DEV_TFLUNA].detail, dev_state_str(g_dev[DEV_LD19].state), g_dev[DEV_LD19].detail);
    printf("LIDARPROBE done\n");
}

/*************** COMMANDS ***************/

static void handle_command(char* line) {
    for (char* p = line; *p; ++p) {
        *p = static_cast<char>(toupper(static_cast<unsigned char>(*p)));
    }
    if (strcmp(line, "PING") == 0) {
        printf("PONG %s\n", ARGOS_FW_VERSION);
    } else if (strcmp(line, "STATUS") == 0) {
        print_report();
    } else if (strcmp(line, "INIT") == 0) {
        const bool was_streaming = g_stream;
        g_stream = false;
        init_all();
        g_stream = was_streaming;
        g_ads_ch = -1;
    } else if (strcmp(line, "SCAN") == 0) {
        cmd_scan();
    } else if (strcmp(line, "READ") == 0) {
        cmd_read();
    } else if (strcmp(line, "LIDARPROBE") == 0) {
        cmd_lidarprobe();
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

    i2cbus::init();
    // A chip can still be mid-transfer from before the reboot (they stay
    // powered through it). Clear both buses before talking to anything.
    i2cbus::recover(ARGOS_SENSOR_I2C);
    i2cbus::recover(ARGOS_THERMAL_I2C);
    init_all();
    ld19::set_raw_handler(forward_ld19); // only sends while streaming

    char line[32];
    int len = 0;
    bool binary_junk = false; // line had non-text bytes (e.g. Maestro commands)
    uint32_t last_blink_ms = 0;
    bool led_on = false;

    while (true) {
        // Keep the lidar rings drained so they never overflow between commands.
        tfluna::poll(g_tfluna);
        ld19::poll(g_ld19);

        // Read command characters without blocking.
        int c = getchar_timeout_us(0);
        while (c != PICO_ERROR_TIMEOUT) {
            if (c == '\n' || c == '\r') {
                line[len] = '\0';
                // Stay silent on binary input: if the Pi's MaestroDriver ever
                // opens this port by mistake, any reply could be misread as a
                // servo position. Text commands from PicoDriver are unaffected.
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
                stream_imu(now);
                stream_ads(now);
                stream_thermal(now);
                stream_tfluna(now);
                retry_missing(now);
                report_thermal_health(now);
            }
        }

        // LED: slow 1 Hz blink = all devices OK, fast 5 Hz blink = something failed.
        const uint32_t half_period = all_ok() ? 500 : 100;
        if (now - last_blink_ms >= half_period) {
            led_on = !led_on;
            led_set(led_on);
            last_blink_ms = now;
        }

        // Short nap: keeps the loop from spinning flat out without slowing the stream.
        sleep_us(g_stream ? 200 : 1000);
    }
}
