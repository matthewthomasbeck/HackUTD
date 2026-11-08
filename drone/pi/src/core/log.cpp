#include "core/log.hpp"

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <ctime>
#include <deque>
#include <mutex>
#include <thread>

namespace drone::log {

namespace {

// About 1 s of very chatty logging. Past this, new lines are dropped, not waited on.
constexpr std::size_t kMaxQueued = 1024;

std::atomic<Level> g_level{Level::Info};

const char* tag(Level level) {
  switch (level) {
    case Level::Debug: return "D";
    case Level::Info: return "I";
    case Level::Warn: return "W";
    case Level::Error: return "E";
  }
  return "?";
}

// The queue and its writer thread. The mutex is held only to push or swap the queue,
// never during I/O, so a caller waits at most for another caller's push.
class Sink {
 public:
  Sink() : thread_([this] { run(); }) {}

  ~Sink() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      stop_ = true;
    }
    wake_.notify_all();
    thread_.join();  // drains what is left before exit
  }

  void push(std::string line) {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (queue_.size() >= kMaxQueued) {
        ++dropped_pending_;
        ++dropped_total_;
        return;
      }
      queue_.push_back(std::move(line));
    }
    wake_.notify_all();
  }

  void flush() {
    std::unique_lock<std::mutex> lock(mutex_);
    wake_.wait(lock, [this] { return queue_.empty() && dropped_pending_ == 0 && !writing_; });
  }

  void set_output(std::FILE* out) {
    std::lock_guard<std::mutex> lock(mutex_);
    out_ = out;
  }

  std::size_t dropped_total() {
    std::lock_guard<std::mutex> lock(mutex_);
    return dropped_total_;
  }

 private:
  void run() {
    std::unique_lock<std::mutex> lock(mutex_);
    while (true) {
      wake_.wait(lock, [this] { return stop_ || !queue_.empty() || dropped_pending_ > 0; });
      if (queue_.empty() && dropped_pending_ == 0) return;  // stop_ is set and nothing is left

      // Take the whole queue, then write it with the lock released.
      std::deque<std::string> batch;
      batch.swap(queue_);
      const std::size_t lost = dropped_pending_;
      dropped_pending_ = 0;
      std::FILE* out = out_;
      writing_ = true;
      lock.unlock();

      for (const auto& line : batch) std::fputs(line.c_str(), out);
      if (lost > 0) std::fprintf(out, "[W] log dropped %zu lines (output was not keeping up)\n", lost);
      std::fflush(out);

      lock.lock();
      writing_ = false;
      wake_.notify_all();  // for flush()
    }
  }

  std::mutex mutex_;
  std::condition_variable wake_;
  std::deque<std::string> queue_;
  std::size_t dropped_pending_ = 0;
  std::size_t dropped_total_ = 0;
  std::FILE* out_ = stderr;
  bool writing_ = false;
  bool stop_ = false;
  std::thread thread_;  // last, so it starts after the fields above exist
};

Sink& sink() {
  static Sink s;
  return s;
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
  char prefix[32];
  std::snprintf(prefix, sizeof(prefix), "%s.%03d [%s] ", stamp, static_cast<int>(ms), tag(level));

  sink().push(prefix + message + "\n");
}

void flush() { sink().flush(); }
void set_output(std::FILE* out) { sink().set_output(out); }
std::size_t dropped_total() { return sink().dropped_total(); }

}  // namespace drone::log
