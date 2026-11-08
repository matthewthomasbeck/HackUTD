#pragma once

#include <cstdint>

#include "hardware/uart.h"

// Interrupt-driven UART receive ring buffer.
//
// The RP2040 UART FIFO is only 32 bytes. The LD19 sends ~23 KB/s, so a
// single MLX90640 frame read (~40 ms of blocking I2C) would overflow the
// FIFO if we polled. The IRQ drains the FIFO into this ring instead, and
// the main loop parses whenever it gets to it.

struct UartRx {
    static constexpr uint32_t size = 4096; // power of two
    uart_inst_t* uart = nullptr;
    volatile uint32_t head = 0; // written by IRQ
    volatile uint32_t tail = 0; // written by reader
    volatile uint32_t overflows = 0;
    volatile uint32_t total_bytes = 0;
    uint8_t buf[size]{};
};

// tx_pin < 0 means receive only.
void uart_rx_start(UartRx& rx, uart_inst_t* uart, int tx_pin, int rx_pin, unsigned baud);

uint32_t uart_rx_available(const UartRx& rx);

// Pops one byte; returns false if empty.
bool uart_rx_pop(UartRx& rx, uint8_t& out);

void uart_rx_flush(UartRx& rx);
