#include "core/worker.hpp"

#include "core/log.hpp"

namespace robot {

Worker::Worker(std::string name, double rate_hz)
    : name_(std::move(name)),
      period_(std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double>(1.0 / rate_hz))) {}

Worker::~Worker() {
  // A derived class's members are already destroyed here, so the thread must be stopped by now.
  request_stop();
  join();
}

void Worker::start() {
  heartbeat_ = std::chrono::steady_clock::now().time_since_epoch().count();
  thread_ = std::thread(&Worker::run, this);
}

void Worker::request_stop() { stop_ = true; }

void Worker::join() {
  if (thread_.joinable()) thread_.join();
}

double Worker::heartbeat_age_ms(SteadyTime now) const {
  const SteadyTime last{SteadyTime::duration(heartbeat_.load())};
  return ms_between(last, now);
}

void Worker::run() {
  log::info("thread " + name_ + " started");
  on_start();
  SteadyTime next = std::chrono::steady_clock::now();
  while (!stop_) {
    const SteadyTime now = std::chrono::steady_clock::now();
    step(now);
    heartbeat_ = std::chrono::steady_clock::now().time_since_epoch().count();
    next += period_;
    const SteadyTime after = std::chrono::steady_clock::now();
    if (next < after) next = after;  // running late: skip ahead instead of bursting
    std::this_thread::sleep_until(next);
  }
  on_stop();
  log::info("thread " + name_ + " stopped");
}

}  // namespace robot
