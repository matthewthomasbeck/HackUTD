#include "motion/movement_thread.hpp"

#include "core/log.hpp"

namespace robot {

namespace {

bool usable(const std::shared_ptr<IDcDriver>& d) { return d && d->ready(); }
bool usable(const std::shared_ptr<IServoBus>& s) { return s && s->ready(); }

}  // namespace

MovementThread::MovementThread(Actuators actuators, MovementConfig config)
    : Worker("movement", config.rate_hz), act_(std::move(actuators)), config_(config) {}

MovementThread::~MovementThread() {
  request_stop();
  join();
}

std::optional<MovementStatus> MovementThread::status() const {
  const auto sample = status_.read();
  if (!sample) return std::nullopt;
  return sample->value;
}

void MovementThread::step(SteadyTime now) {
  const auto latest = commands_.read();
  MovementStatus status;

  const bool fresh = latest && ms_between(latest->written, now) <= config_.command_timeout_ms;
  if (!fresh) {
    if (!was_deadman_) {
      log::warn("movement: no fresh command for " + std::to_string(static_cast<int>(config_.command_timeout_ms)) +
                " ms, stopping (dead-man)");
    }
    was_deadman_ = true;
    stop_wheels();
    servo_goal_ = servo_now_;  // legs freeze where they are instead of finishing a move
    status.deadman = true;
    status.stopped = true;
    status.applied_seq = latest ? latest->value.seq : 0;
    status_.write(status, now);
    return;
  }

  if (was_deadman_) log::info("movement: receiving commands");
  was_deadman_ = false;
  const MotionCommand& cmd = latest->value.motion.command();
  drive(cmd);
  apply_legs(cmd.legs);
  advance_servos();
  status.applied_seq = latest->value.seq;
  status.stopped = cmd.is_zero();
  status_.write(status, now);
}

void MovementThread::on_stop() {
  stop_wheels();
  stop_servos();
}

void MovementThread::drive(const MotionCommand& command) {
  if (!usable(act_.dc_a) || !usable(act_.dc_b)) return;
  const WheelDuties duty = mix_mecanum(command, config_.mecanum);
  act_.dc_a->set_duty(0, duty[0]);
  act_.dc_a->set_duty(1, duty[1]);
  act_.dc_b->set_duty(0, duty[2]);
  act_.dc_b->set_duty(1, duty[3]);
}

void MovementThread::stop_wheels() {
  if (usable(act_.dc_a)) act_.dc_a->stop_all();
  if (usable(act_.dc_b)) act_.dc_b->stop_all();
}

void MovementThread::apply_legs(const LegRequest& request) {
  if (request.move == LegRequest::Move::None || !act_.leg_ik) return;
  std::vector<ServoTarget> targets;
  if (!act_.leg_ik->solve(request, targets)) return;  // unreachable or past a limit: keep the current pose
  // The IK already rejected anything outside each servo's min_us..max_us, so goals are in range.
  for (const auto& t : targets) servo_goal_[{t.bus, t.channel}] = t.pulse_us;
}

// Moves every leg servo toward its goal by at most servos.max_rate_us_per_s, so a new stance is
// a smooth move over several steps instead of a jump. A servo's first target is sent as is,
// because its real position is unknown until then (start the robot supported).
void MovementThread::advance_servos() {
  const double max_step = config_.servo_max_rate_us_per_s > 0 ? config_.servo_max_rate_us_per_s / config_.rate_hz : 0;
  for (const auto& [key, goal] : servo_goal_) {
    auto it = servo_now_.find(key);
    double next = goal;
    if (it != servo_now_.end() && max_step > 0) {
      const double delta = goal - it->second;
      next = it->second + (delta > max_step ? max_step : (delta < -max_step ? -max_step : delta));
    }
    if (it != servo_now_.end() && it->second == next) continue;
    const auto& bus = key.first == 0 ? act_.maestro_a : act_.maestro_b;
    if (usable(bus) && bus->set_target_us(key.second, next)) servo_now_[key] = next;
  }
}

void MovementThread::stop_servos() {
  // safe_stop.servo_action: hold keeps the last targets (do nothing), release stops the pulses.
  if (!config_.release_servos_on_stop) return;
  if (usable(act_.maestro_a)) act_.maestro_a->release_all();
  if (usable(act_.maestro_b)) act_.maestro_b->release_all();
}

}  // namespace robot
