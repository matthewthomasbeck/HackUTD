#include "devices/thermal.hpp"

#include <cstring>

#include "MLX90640_API.h"
#include "bus/i2c_bus.hpp"
#include "config.hpp"
#include "hardware/i2c.h"
#include "pico/multicore.h"
#include "pico/mutex.h"

namespace thermal {

// These are large (~10 KB total) so they live in static RAM, never on the
// Pico's small stacks.
static uint16_t g_ee[832];
static uint16_t g_frame[834];
static paramsMLX90640 g_params;
static bool g_ready = false;

// Core 1 builds frames here (chess mode updates half the pixels per subpage).
static float g_work[pixel_count];

// Published frame, shared with core 0 under g_lock.
static mutex_t g_lock;
static bool g_lock_made = false;
static float g_pub[pixel_count];
static float g_pub_ta = 0, g_pub_min = 0, g_pub_max = 0;
static volatile uint32_t g_pub_seq = 0;
static volatile bool g_core1_running = false;
static volatile uint32_t g_c1_frames = 0;
static volatile uint32_t g_c1_fails = 0;
static volatile uint32_t g_c1_recovers = 0;
static volatile int g_c1_last_error = 0;

static const char* refresh_label(int code) {
    static const char* labels[] = {"0.5Hz", "1Hz", "2Hz", "4Hz", "8Hz", "16Hz", "32Hz", "64Hz"};
    return (code >= 0 && code < 8) ? labels[code] : "?Hz";
}

bool init(DevStatus& st) {
    stop_background();
    dev_reset(st, "thermal");
    st.addr = cfg::mlx_addr;
    g_ready = false;

    // Unstick and re-initialise the bus. The camera stays powered through a
    // Pico reboot or a core-1 reset, so a transfer cut off mid-byte can leave
    // it holding SDA low; this clears that before we talk to it.
    i2cbus::recover(ARGOS_THERMAL_I2C);

    if (!i2cbus::probe(ARGOS_THERMAL_I2C, cfg::mlx_addr)) {
        return dev_set(st, DevState::NotFound, "no ACK at 0x33 on GP%u/GP%u", cfg::thermal_sda_pin, cfg::thermal_scl_pin);
    }

    // Factory calibration lives in the sensor's EEPROM (832 words).
    if (MLX90640_DumpEE(cfg::mlx_addr, g_ee) != 0) {
        return dev_set(st, DevState::Error, "EEPROM dump failed");
    }
    const int extract = MLX90640_ExtractParameters(g_ee, &g_params);
    if (extract != 0) {
        return dev_set(st, DevState::Error, "bad EEPROM calibration (code %d)", extract);
    }

    if (MLX90640_SetRefreshRate(cfg::mlx_addr, cfg::mlx_refresh_code) != 0 ||
        MLX90640_SetChessMode(cfg::mlx_addr) != 0 ||
        MLX90640_SetResolution(cfg::mlx_addr, 0x03) != 0) { // 19-bit ADC
        return dev_set(st, DevState::Error, "control register write failed");
    }

    const int rate = MLX90640_GetRefreshRate(cfg::mlx_addr);
    if (rate != cfg::mlx_refresh_code) {
        return dev_set(st, DevState::Error, "refresh readback %d != %d", rate, cfg::mlx_refresh_code);
    }

    // One real subpage proves the whole path (EEPROM + RAM + math) works.
    if (MLX90640_GetFrameData(cfg::mlx_addr, g_frame) < 0) {
        return dev_set(st, DevState::Error, "first frame read failed");
    }
    const float ta = MLX90640_GetTa(g_frame, &g_params);
    if (ta < -40.0f || ta > 125.0f) {
        return dev_set(st, DevState::Error, "ambient %.1fC out of range", ta);
    }

    for (float& p : g_work) {
        p = ta; // until both subpages have arrived
    }
    g_ready = true;
    return dev_set(st, DevState::Ok, "%s chess 19bit Ta=%.1fC", refresh_label(rate), ta);
}

/*************** CORE 1 CAPTURE LOOP ***************/

static void core1_loop() {
    int fails = 0;
    while (true) {
        const int rc = MLX90640_GetFrameData(cfg::mlx_addr, g_frame);
        if (rc < 0) {
            g_c1_fails = g_c1_fails + 1;
            g_c1_last_error = rc;
            // One miss is usually noise; several in a row means a jammed bus.
            if (++fails >= 5) {
                fails = 0;
                g_c1_recovers = g_c1_recovers + 1;
                i2cbus::recover(ARGOS_THERMAL_I2C);
            }
            continue;
        }
        fails = 0;
        const float ta = MLX90640_GetTa(g_frame, &g_params);
        // Reflected temperature ~ ambient minus 8 C is the Melexis recommendation.
        MLX90640_CalculateTo(g_frame, &g_params, 0.95f, ta - 8.0f, g_work);

        float lo = g_work[0], hi = g_work[0];
        for (int i = 1; i < pixel_count; ++i) {
            if (g_work[i] < lo) lo = g_work[i];
            if (g_work[i] > hi) hi = g_work[i];
        }

        mutex_enter_blocking(&g_lock);
        std::memcpy(g_pub, g_work, sizeof(g_pub));
        g_pub_ta = ta;
        g_pub_min = lo;
        g_pub_max = hi;
        g_pub_seq = g_pub_seq + 1;
        mutex_exit(&g_lock);
        g_c1_frames = g_c1_frames + 1;
    }
}

void start_background() {
    if (!g_ready || g_core1_running) {
        return;
    }
    if (!g_lock_made) {
        mutex_init(&g_lock);
        g_lock_made = true;
    }
    g_c1_frames = g_c1_fails = g_c1_recovers = 0;
    g_c1_last_error = 0;
    multicore_launch_core1(core1_loop);
    g_core1_running = true;
}

void stop_background() {
    if (!g_core1_running) {
        return;
    }
    multicore_reset_core1();
    g_core1_running = false;
    // Core 1 may have been holding the lock when it was reset.
    mutex_init(&g_lock);
}

Core1Stats core1_stats() {
    Core1Stats s;
    s.running = g_core1_running;
    s.frames = g_c1_frames;
    s.fails = g_c1_fails;
    s.recovers = g_c1_recovers;
    s.last_error = g_c1_last_error;
    return s;
}

bool latest(float* out_c, float& ta_c, float& t_min, float& t_max, uint32_t& seen_seq) {
    if (!g_core1_running || g_pub_seq == seen_seq) {
        return false;
    }
    mutex_enter_blocking(&g_lock);
    std::memcpy(out_c, g_pub, sizeof(g_pub));
    ta_c = g_pub_ta;
    t_min = g_pub_min;
    t_max = g_pub_max;
    seen_seq = g_pub_seq;
    mutex_exit(&g_lock);
    return true;
}

} // namespace thermal
