#include "flight/flight_thread.hpp"

#include "core/log.hpp"

namespace drone {

namespace {

bool usable(const std::shared_ptr<IFlightOutput>& o) { return o && o->ready(); }

}  // namespace

FlightThread::FlightThread(std::shared_ptr<IFlightOutput> output, FlightConfig config)
    : Worker("flight", config.rate_hz), output_(std::move(output)), config_(config) {}

FlightThread::~FlightThread() {
  request_stop();
  join();
}

std::optional<FlightStatus> FlightThread::status() const {
  const auto sample = status_.read();
  if (!sample) return std::nullopt;
  return sample->value;
}

void FlightThread::step(SteadyTime now) {
  const auto latest = commands_.read();
  FlightStatus status;

  const bool fresh = latest && ms_between(latest->written, now) <= config_.command_timeout_ms;
  if (!fresh) {
    if (!was_deadman_) {
      log::warn("flight: no fresh command for " + std::to_string(static_cast<int>(config_.command_timeout_ms)) +
                " ms, stopping (dead-man)");
    }
    was_deadman_ = true;
    stop_output();
    status.deadman = true;
    status.stopped = true;
    status.applied_seq = latest ? latest->value.seq : 0;
    status_.write(status, now);
    return;
  }

  if (was_deadman_) log::info("flight: receiving commands");
  was_deadman_ = false;
  const MotionCommand& cmd = latest->value.motion.command();
  // TODO(flight): this is where the dog mixes wheel duties. The drone hands the request on
  // unchanged; turning it into rotor output is flight control and waits for the team.
  if (usable(output_)) output_->apply(cmd);
  status.applied_seq = latest->value.seq;
  status.stopped = cmd.is_zero();
  status_.write(status, now);
}

void FlightThread::on_stop() { stop_output(); }

void FlightThread::stop_output() {
  if (usable(output_)) output_->stop();
}

}  // namespace drone
