#include "devices/ld19.hpp"

#include "bus/uart_rx.hpp"
#include "config.hpp"
#include "pico/stdlib.h"

namespace ld19 {

static constexpr int packet_bytes = 47;
static constexpr uint8_t header = 0x54;
static constexpr uint8_t verlen = 0x2C;

static UartRx g_rx;
static uint8_t g_buf[packet_bytes];
static int g_idx = 0;
static uint32_t g_ok = 0;
static uint32_t g_bad = 0;
static RawHandler g_raw = nullptr;

void set_raw_handler(RawHandler fn) { g_raw = fn; }

uint32_t packets_ok() { return g_ok; }
uint32_t packets_bad() { return g_bad; }
uint32_t overflows() { return g_rx.overflows; }

// CRC-8, poly 0x4D, init 0, bit-for-bit the same as the table in the Pi's LidarDriver.
static uint8_t crc8(const uint8_t* p, int len) {
    uint8_t crc = 0;
    for (int i = 0; i < len; ++i) {
        crc ^= p[i];
        for (int bit = 0; bit < 8; ++bit) {
            crc = (crc & 0x80) ? static_cast<uint8_t>((crc << 1) ^ 0x4D)
                               : static_cast<uint8_t>(crc << 1);
        }
    }
    return crc;
}

static uint16_t u16le(const uint8_t* p) {
    return static_cast<uint16_t>(p[0] | (p[1] << 8));
}

bool poll(Packet& latest) {
    bool got = false;
    uint8_t b = 0;
    while (uart_rx_pop(g_rx, b)) {
        if (g_idx == 0) {
            if (b == header) {
                g_buf[g_idx++] = b;
            }
            continue;
        }
        if (g_idx == 1) {
            if (b == verlen) {
                g_buf[g_idx++] = b;
            } else {
                g_idx = (b == header) ? 1 : 0;
            }
            continue;
        }
        g_buf[g_idx++] = b;
        if (g_idx < packet_bytes) {
            continue;
        }
        g_idx = 0;

        if (crc8(g_buf, packet_bytes - 1) != g_buf[packet_bytes - 1]) {
            ++g_bad;
            continue;
        }
        ++g_ok;
        if (g_raw != nullptr) {
            g_raw(g_buf);
        }
        latest.speed_dps = u16le(g_buf + 2);
        latest.start_deg = u16le(g_buf + 4) / 100.0f;
        for (int i = 0; i < points_per_packet; ++i) {
            const uint8_t* pt = g_buf + 6 + i * 3;
            latest.dist_mm[i] = u16le(pt);
            latest.intensity[i] = pt[2];
        }
        latest.end_deg = u16le(g_buf + 42) / 100.0f;
        got = true;
    }
    return got;
}

bool init(DevStatus& st) {
    dev_reset(st, "ld19");
    g_idx = 0;
    g_ok = 0;
    g_bad = 0;

    uart_rx_start(g_rx, ARGOS_LD19_UART, cfg::ld19_tx_pin, cfg::ld19_rx_pin, cfg::ld19_baud);

    // LD19 sends ~450 packets/s once the motor is up to speed.
    Packet p;
    const absolute_time_t deadline = make_timeout_time_ms(cfg::ld19_wait_ms);
    while (!time_reached(deadline) && g_ok < 5) {
        poll(p);
        sleep_ms(5);
    }

    if (g_ok >= 5) {
        return dev_set(st, DevState::Ok, "%.1fHz scan, %lu pkts", p.speed_dps / 360.0f,
                       static_cast<unsigned long>(g_ok));
    }
    if (g_rx.total_bytes == 0) {
        return dev_set(st, DevState::NotFound, "no bytes on GP%d (LD19 TX->GP%d, 5V?)",
                       cfg::ld19_rx_pin, cfg::ld19_rx_pin);
    }
    return dev_set(st, DevState::Error, "%lu bytes, %lu good / %lu bad pkts",
                   static_cast<unsigned long>(g_rx.total_bytes),
                   static_cast<unsigned long>(g_ok), static_cast<unsigned long>(g_bad));
}

} // namespace ld19
