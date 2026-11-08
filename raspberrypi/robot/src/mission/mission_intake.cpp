#include "mission/mission_intake.hpp"

#include <algorithm>

namespace robot {

void FinishedMissions::add(std::uint64_t id) {
  if (id == 0 || capacity_ == 0 || contains(id)) return;
  if (ids_.size() >= capacity_) ids_.pop_front();
  ids_.push_back(id);
}

bool FinishedMissions::contains(std::uint64_t id) const {
  return std::find(ids_.begin(), ids_.end(), id) != ids_.end();
}

const char* to_string(MissionAction a) {
  switch (a) {
    case MissionAction::start: return "start";
    case MissionAction::store: return "store";
    case MissionAction::ignore_duplicate: return "ignore_duplicate";
    case MissionAction::ignore_finished: return "ignore_finished";
  }
  return "?";
}

MissionAction classify_mission(const MissionMsg& m, const MissionContext& ctx, const std::vector<Event>& events,
                               const FinishedMissions& finished) {
  if (ctx.active && ctx.running_id == m.id) return MissionAction::ignore_duplicate;
  if (ctx.stored_id && *ctx.stored_id == m.id) return MissionAction::ignore_duplicate;
  for (const auto& e : events) {
    if (e.type == EventType::start && e.mission_id == m.id) return MissionAction::ignore_duplicate;
  }
  if (finished.contains(m.id)) return MissionAction::ignore_finished;
  return m.kind == "hold" && ctx.auto_start ? MissionAction::start : MissionAction::store;
}

std::size_t drop_pending_start(std::vector<Event>& events, std::uint64_t mission_id) {
  if (mission_id == 0) return 0;
  const auto before = events.size();
  events.erase(std::remove_if(events.begin(), events.end(),
                              [&](const Event& e) { return e.type == EventType::start && e.mission_id == mission_id; }),
               events.end());
  return before - events.size();
}

}  // namespace robot
