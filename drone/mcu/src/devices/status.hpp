#pragma once

#include <cstdint>
#include <cstdio>

// One status record per device, filled by each device's init().
// main.cpp prints these for humans and as a single "STATUS ..." line
// that the Pi's McuTextParser parses (copied from pico/src/devices/status.hpp).

enum class DevState : uint8_t {
    NotStarted,
    Ok,
    NotFound, // nothing answered: wiring / power / address
    Error,    // something answered but did not behave
};

struct DevStatus {
    const char* name = "?";
    DevState state = DevState::NotStarted;
    uint8_t addr = 0; // I2C address, 0 for UART devices
    char detail[64]{};
};

inline const char* dev_state_str(DevState s) {
    switch (s) {
        case DevState::Ok: return "OK";
        case DevState::NotFound: return "NOT_FOUND";
        case DevState::Error: return "ERROR";
        default: return "NOT_STARTED";
    }
}

inline void dev_reset(DevStatus& st, const char* name) {
    st.name = name;
    st.state = DevState::NotStarted;
    st.addr = 0;
    st.detail[0] = '\0';
}

template <typename... Args>
inline bool dev_set(DevStatus& st, DevState state, const char* fmt, Args... args) {
    st.state = state;
    std::snprintf(st.detail, sizeof(st.detail), fmt, args...);
    return state == DevState::Ok;
}

// Plain text with no arguments: copied as is, never read as a format string.
inline bool dev_set(DevStatus& st, DevState state, const char* text) {
    st.state = state;
    std::snprintf(st.detail, sizeof(st.detail), "%s", text);
    return state == DevState::Ok;
}
