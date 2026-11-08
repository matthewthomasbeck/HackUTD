#include "devices/tfluna.hpp"

#include "bus/uart_rx.hpp"
#include "config.hpp"
#include "pico/stdlib.h"

namespace tfluna {

static constexpr int frame_bytes = 9;
static constexpr uint8_t header = 0x59;

static UartRx g_rx;
static uint8_t g_buf[frame_bytes];
static int g_idx = 0;
static uint32_t g_ok = 0;
static uint32_t g_bad = 0;

uint32_t frames_ok() { return g_ok; }
uint32_t frames_bad() { return g_bad; }
uint32_t overflows() { return g_rx.overflows; }

bool poll(Sample& latest) {
    bool got = false;
    uint8_t b = 0;
    while (uart_rx_pop(g_rx, b)) {
        if (g_idx < 2) {
            // Sync on two 0x59 bytes in a row.
            if (b == header) {
                g_buf[g_idx++] = b;
            } else {
                g_idx = 0;
            }
            continue;
        }
        g_buf[g_idx++] = b;
        if (g_idx < frame_bytes) {
            continue;
        }
        g_idx = 0;

        uint8_t sum = 0;
        for (int i = 0; i < frame_bytes - 1; ++i) {
            sum = static_cast<uint8_t>(sum + g_buf[i]);
        }
        if (sum != g_buf[frame_bytes - 1]) {
            ++g_bad;
            continue;
        }
        ++g_ok;
        latest.dist_cm = static_cast<uint16_t>(g_buf[2] | (g_buf[3] << 8));
        latest.strength = static_cast<uint16_t>(g_buf[4] | (g_buf[5] << 8));
        latest.temp_c = static_cast<uint16_t>(g_buf[6] | (g_buf[7] << 8)) / 8.0f - 256.0f;
        got = true;
    }
    return got;
}

bool init(DevStatus& st) {
    dev_reset(st, "tfluna");
    g_idx = 0;
    g_ok = 0;
    g_bad = 0;

    uart_rx_start(g_rx, ARGOS_TFLUNA_UART, cfg::tfluna_tx_pin, cfg::tfluna_rx_pin, cfg::tfluna_baud);

    // Want 3 good frames in a row-ish; TF-Luna sends 100/s so this is quick.
    Sample s;
    const absolute_time_t deadline = make_timeout_time_ms(cfg::tfluna_wait_ms);
    while (!time_reached(deadline) && g_ok < 3) {
        poll(s);
        sleep_ms(5);
    }

    if (g_ok >= 3) {
        return dev_set(st, DevState::Ok, "dist=%ucm strength=%u", s.dist_cm, s.strength);
    }
    if (g_rx.total_bytes == 0) {
        return dev_set(st, DevState::NotFound, "no bytes on GP%d (TF-Luna TX->GP%d, 5V?)",
                       cfg::tfluna_rx_pin, cfg::tfluna_rx_pin);
    }
    return dev_set(st, DevState::Error, "%lu bytes but %lu good frames (baud/mode?)",
                   static_cast<unsigned long>(g_rx.total_bytes), static_cast<unsigned long>(g_ok));
}

} // namespace tfluna
