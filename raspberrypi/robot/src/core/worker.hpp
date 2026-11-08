#pragma once

// Worker: a thread that calls step() at a fixed rate until asked to stop.
// The movement thread and the vision thread are Workers; the main thread is not.
//
// Each pass stamps a heartbeat. The main thread checks heartbeat_age_ms() every tick, so a hung
// worker is noticed (worker_stalled event) and the systemd watchdog stops being fed.
//
// Workers talk to the main thread only through LatestSlot<T> values (core/latest_slot.hpp),
// never through shared mutable state, so there is one lock per value and nothing to deadlock on.

#include <atomic>
#include <chrono>
#include <string>
#include <thread>

#include "core/clock.hpp"

namespace robot {

class Worker {
 public:
  Worker(std::string name, double rate_hz);
  virtual ~Worker();
  Worker(const Worker&) = delete;
  Worker& operator=(const Worker&) = delete;

  void start();
  void request_stop();  // returns at once; the thread exits after its current step
  // Waits for the thread to exit. Every derived class calls request_stop() and join() in its own
  // destructor, because step() uses the derived class's members.
  void join();

  const std::string& name() const { return name_; }
  // Milliseconds since the last completed step; a large value means the thread is stuck.
  double heartbeat_age_ms(SteadyTime now) const;

 protected:
  virtual void on_start() {}             // runs on the worker thread, before the first step
  virtual void step(SteadyTime now) = 0;  // one pass; must return quickly
  virtual void on_stop() {}              // runs on the worker thread, after the last step

 private:
  void run();

  std::string name_;
  std::chrono::steady_clock::duration period_;
  std::atomic<bool> stop_{false};
  std::atomic<SteadyTime::rep> heartbeat_{0};  // steady_clock ticks of the last completed step
  std::thread thread_;
};

}  // namespace robot
