#include "core/notify.hpp"

#ifdef DRONE_WITH_SYSTEMD
#include <systemd/sd-daemon.h>
#endif

namespace drone::notify {

#ifdef DRONE_WITH_SYSTEMD
void ready() { sd_notify(0, "READY=1"); }
void watchdog() { sd_notify(0, "WATCHDOG=1"); }
void stopping() { sd_notify(0, "STOPPING=1"); }
#else
void ready() {}
void watchdog() {}
void stopping() {}
#endif

}  // namespace drone::notify
