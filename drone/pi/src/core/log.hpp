#pragma once

// Leveled logger to stderr. Under systemd, journald picks stderr up and adds its own timestamps.
// Thread safe: reader threads and the main loop can log at the same time.
// Non-blocking: write() only queues the line; a background writer thread does the I/O.
// If the output stalls (a full pipe, a slow journald), lines past the queue limit are dropped
// and counted, so a stuck stderr can never stall the main loop.

#include <cstddef>
#include <cstdio>
#include <string>

namespace drone::log {

enum class Level { Debug, Info, Warn, Error };

void set_level(Level level);
void write(Level level, const std::string& message);

// Blocks until every queued line has been written. For shutdown and tests, never the main loop.
void flush();
// Where the writer thread sends lines (stderr by default). For tests.
void set_output(std::FILE* out);
// Lines dropped because the queue was full, since the program started.
std::size_t dropped_total();

inline void debug(const std::string& m) { write(Level::Debug, m); }
inline void info(const std::string& m) { write(Level::Info, m); }
inline void warn(const std::string& m) { write(Level::Warn, m); }
inline void error(const std::string& m) { write(Level::Error, m); }

}  // namespace drone::log
