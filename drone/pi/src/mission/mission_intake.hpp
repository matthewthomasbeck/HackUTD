#pragma once

// What the main loop does with a `mission` or `cancel` from the bridge (docs/specs/robot.md
// sections 5 and 9.5). Pure functions plus one small id ring, so the rules are unit tested.
//
// The bridge resends the current mission on every connect (a drone reconnect or a bridge restart),
// so the same mission can arrive more than once:
//   - the running mission, or the one stored or already queued this tick: ignored as a duplicate,
//     not handed to the state machine (which would reject it and fail the drone's own mission)
//   - a mission that ended this boot as done or failed: ignored, the bridge just has not seen the
//     end yet. Cancelled ids are not remembered: after a lease expires the module requeues the
//     mission and may lease the same id to the drone again, which must start.

#include <cstddef>
#include <cstdint>
#include <deque>
#include <optional>
#include <vector>

#include "bridge/messages.hpp"
#include "state/state_machine.hpp"

namespace drone {

// The last `capacity` mission ids that ended this boot as done or failed (rejections included).
class FinishedMissions {
 public:
  explicit FinishedMissions(std::size_t capacity = 32) : capacity_(capacity) {}
  void add(std::uint64_t id);  // id 0 (a local dronectl test) is not remembered
  bool contains(std::uint64_t id) const;
  std::size_t size() const { return ids_.size(); }

 private:
  std::size_t capacity_;
  std::deque<std::uint64_t> ids_;  // oldest first
};

enum class MissionAction {
  start,             // queue a start event for the state machine
  store,             // keep it: not hold or teleop (no mission runner, as on the dog), or auto_start is off
  ignore_duplicate,  // already running, stored, or queued
  ignore_finished,   // ended this boot
};

const char* to_string(MissionAction a);

struct MissionContext {
  bool active = false;                    // machine.state == ACTIVE
  std::uint64_t running_id = 0;           // the running mission, 0 if none
  std::optional<std::uint64_t> stored_id;  // the stored mission, if any
  bool auto_start = true;                 // missions.auto_start
};

MissionAction classify_mission(const MissionMsg& m, const MissionContext& ctx, const std::vector<Event>& events,
                               const FinishedMissions& finished);

// Removes every queued start event for this bridge mission (a cancel in the same poll batch).
// Returns how many it removed. Id 0 is never matched.
std::size_t drop_pending_start(std::vector<Event>& events, std::uint64_t mission_id);

}  // namespace drone
