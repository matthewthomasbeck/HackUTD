#pragma once

// Leveled logger to stderr. Under systemd, journald picks stderr up and adds its own timestamps.
// Thread safe: reader threads and the main loop can log at the same time.

#include <string>

namespace robot::log {

enum class Level { Debug, Info, Warn, Error };

void set_level(Level level);
void write(Level level, const std::string& message);

inline void debug(const std::string& m) { write(Level::Debug, m); }
inline void info(const std::string& m) { write(Level::Info, m); }
inline void warn(const std::string& m) { write(Level::Warn, m); }
inline void error(const std::string& m) { write(Level::Error, m); }

}  // namespace robot::log
