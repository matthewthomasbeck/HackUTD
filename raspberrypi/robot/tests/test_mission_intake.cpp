// Mission intake tests: what the main loop does with a bridge mission or cancel (docs/specs/robot.md
// sections 5 and 9.5). The bridge resends the current mission on every connect.

#include <gtest/gtest.h>

#include "mission/mission_intake.hpp"

namespace robot {
namespace {

MissionMsg mission(std::uint64_t id, const std::string& kind = "hold") {
  MissionMsg m;
  m.id = id;
  m.kind = kind;
  return m;
}

Event start_event(std::uint64_t id) {
  Event e{EventType::start};
  e.mission_id = id;
  e.mission_kind = "hold";
  return e;
}

TEST(MissionIntake, NewHoldStarts) {
  EXPECT_EQ(classify_mission(mission(7), MissionContext{}, {}, FinishedMissions{}), MissionAction::start);
}

TEST(MissionIntake, ResendOfRunningMissionIsIgnored) {
  MissionContext ctx;
  ctx.active = true;
  ctx.running_id = 7;
  EXPECT_EQ(classify_mission(mission(7), ctx, {}, FinishedMissions{}), MissionAction::ignore_duplicate);
  // A different mission while one runs still goes to the state machine, which rejects it.
  EXPECT_EQ(classify_mission(mission(8), ctx, {}, FinishedMissions{}), MissionAction::start);
}

TEST(MissionIntake, ResendOfStoredMissionIsIgnored) {
  MissionContext ctx;
  ctx.stored_id = 9;
  EXPECT_EQ(classify_mission(mission(9, "search_cells"), ctx, {}, FinishedMissions{}),
            MissionAction::ignore_duplicate);
  EXPECT_EQ(classify_mission(mission(10, "search_cells"), ctx, {}, FinishedMissions{}), MissionAction::store);
}

TEST(MissionIntake, SecondCopyInOneBatchIsIgnored) {
  const std::vector<Event> events{start_event(7)};
  EXPECT_EQ(classify_mission(mission(7), MissionContext{}, events, FinishedMissions{}),
            MissionAction::ignore_duplicate);
}

TEST(MissionIntake, FinishedMissionIsNotRestarted) {
  FinishedMissions finished;
  finished.add(7);
  EXPECT_EQ(classify_mission(mission(7), MissionContext{}, {}, finished), MissionAction::ignore_finished);
  // A cancelled id is never added, so the same id leased again later starts.
  EXPECT_EQ(classify_mission(mission(8), MissionContext{}, {}, finished), MissionAction::start);
}

TEST(MissionIntake, HoldWaitsWhenAutoStartIsOff) {
  MissionContext ctx;
  ctx.auto_start = false;
  EXPECT_EQ(classify_mission(mission(7), ctx, {}, FinishedMissions{}), MissionAction::store);
}

TEST(MissionIntake, FinishedRingIsBounded) {
  FinishedMissions finished(3);
  finished.add(0);  // a local robotctl mission: never remembered
  for (std::uint64_t id = 1; id <= 4; ++id) finished.add(id);
  finished.add(4);  // no duplicates
  EXPECT_EQ(finished.size(), 3u);
  EXPECT_FALSE(finished.contains(0));
  EXPECT_FALSE(finished.contains(1));  // the oldest was dropped
  EXPECT_TRUE(finished.contains(2));
  EXPECT_TRUE(finished.contains(4));
}

TEST(MissionIntake, CancelDropsPendingStartOfThatMissionOnly) {
  std::vector<Event> events{start_event(7), Event{EventType::stop}, start_event(8), start_event(0)};
  EXPECT_EQ(drop_pending_start(events, 7), 1u);
  ASSERT_EQ(events.size(), 3u);
  EXPECT_EQ(events[0].type, EventType::stop);
  EXPECT_EQ(events[1].mission_id, 8u);
  EXPECT_EQ(drop_pending_start(events, 0), 0u) << "id 0 is a local mission, never a bridge cancel";
  EXPECT_EQ(drop_pending_start(events, 42), 0u);
  EXPECT_EQ(events.size(), 3u);
}

}  // namespace
}  // namespace robot
