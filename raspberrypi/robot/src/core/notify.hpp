#pragma once

// systemd notifications (docs/specs/robot.md sections 4.1 and 10.5).
// READY=1 tells systemd startup finished; WATCHDOG=1 is the keep-alive ping for WatchdogSec=.
// Only the main loop calls notify_watchdog(), so a hung loop trips the watchdog.
// Built without libsystemd (macOS), every call is a no-op.

namespace robot::notify {

void ready();
void watchdog();
void stopping();

}  // namespace robot::notify
