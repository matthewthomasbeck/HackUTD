#include "core/log.hpp"

#include <atomic>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <mutex>

namespace robot::log {

namespace {

std::atomic<Level> g_level{Level::Info};
std::mutex g_mutex;

const char* tag(Level level) {
  switch (level) {
    case Level::Debug: return "D";
    case Level::Info: return "I";
    case Level::Warn: return "W";
    case Level::Error: return "E";
  }
  return "?";
}

}  // namespace

void set_level(Level level) { g_level = level; }

void write(Level level, const std::string& message) {
  if (level < g_level.load()) return;

  // Wall clock time, HH:MM:SS.mmm, so laptop runs are readable without journald.
  const auto now = std::chrono::system_clock::now();
  const std::time_t secs = std::chrono::system_clock::to_time_t(now);
  const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count() % 1000;
  std::tm local{};
  localtime_r(&secs, &local);
  char stamp[16];
  std::strftime(stamp, sizeof(stamp), "%H:%M:%S", &local);

  std::lock_guard<std::mutex> lock(g_mutex);
  std::fprintf(stderr, "%s.%03d [%s] %s\n", stamp, static_cast<int>(ms), tag(level), message.c_str());
}

}  // namespace robot::log
