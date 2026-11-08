#include "bus/uart_rx.hpp"

#include "hardware/gpio.h"
#include "hardware/irq.h"
#include "hardware/sync.h"

// One ring per hardware UART, looked up by index inside the IRQ.
static UartRx* g_rings[NUM_UARTS] = {nullptr, nullptr};
static bool g_handler_installed[NUM_UARTS] = {false, false};

static void drain(unsigned index) {
    UartRx* rx = g_rings[index];
    uart_inst_t* uart = UART_INSTANCE(index);
    while (uart_is_readable(uart)) {
        const uint8_t b = static_cast<uint8_t>(uart_get_hw(uart)->dr & 0xFF);
        if (rx == nullptr) {
            continue; // nobody listening: just empty the FIFO
        }
        const uint32_t next = (rx->head + 1) & (UartRx::size - 1);
        if (next == rx->tail) {
            ++rx->overflows; // reader fell behind: drop newest byte
            continue;
        }
        rx->buf[rx->head] = b;
        __dmb();
        rx->head = next;
        ++rx->total_bytes;
    }
}

static void on_uart0_irq() { drain(0); }
static void on_uart1_irq() { drain(1); }

void uart_rx_start(UartRx& rx, uart_inst_t* uart, int tx_pin, int rx_pin, unsigned baud) {
    const unsigned index = uart_get_index(uart);
    const unsigned irq = (index == 0) ? UART0_IRQ : UART1_IRQ;

    irq_set_enabled(irq, false);

    rx.uart = uart;
    rx.head = 0;
    rx.tail = 0;
    rx.overflows = 0;
    rx.total_bytes = 0;
    g_rings[index] = &rx;

    uart_init(uart, baud);
    uart_set_format(uart, 8, 1, UART_PARITY_NONE);
    uart_set_hw_flow(uart, false, false);
    uart_set_fifo_enabled(uart, true);

    if (tx_pin >= 0) {
        gpio_set_function(static_cast<unsigned>(tx_pin), GPIO_FUNC_UART);
    }
    gpio_set_function(static_cast<unsigned>(rx_pin), GPIO_FUNC_UART);
    gpio_pull_up(static_cast<unsigned>(rx_pin)); // idle-high if the lidar is unplugged

    // Re-running init (the Pi's INIT command) must not install the handler twice.
    if (!g_handler_installed[index]) {
        irq_set_exclusive_handler(irq, index == 0 ? on_uart0_irq : on_uart1_irq);
        g_handler_installed[index] = true;
    }
    uart_set_irqs_enabled(uart, true, false);
    irq_set_enabled(irq, true);
}

uint32_t uart_rx_available(const UartRx& rx) {
    return (rx.head - rx.tail) & (UartRx::size - 1);
}

bool uart_rx_pop(UartRx& rx, uint8_t& out) {
    if (rx.tail == rx.head) {
        return false;
    }
    out = rx.buf[rx.tail];
    __dmb();
    rx.tail = (rx.tail + 1) & (UartRx::size - 1);
    return true;
}

void uart_rx_flush(UartRx& rx) {
    rx.tail = rx.head;
}
