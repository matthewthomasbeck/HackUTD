// Remote driving: TeleopBehavior's dead-man and the bridge's teleop message (PROPOSED contract).

#include <gtest/gtest.h>

#include "bridge/messages.hpp"
#include "mission/behaviors/teleop.hpp"

namespace drone {
namespace {

using namespace std::chrono_literals;

WorldSnapshot at(SteadyTime t) {
  WorldSnapshot w;
  w.now = t;
  return w;
}

TEST(Teleop, NoCommandMeansNoMotion) {
  auto input = std::make_shared<TeleopInput>();
  TeleopBehavior b(input, 300);
  b.start();
  const auto out = b.tick(at(SteadyTime{} + 1s));
  EXPECT_TRUE(out.motion.is_zero());
  EXPECT_FALSE(out.done) << "teleop runs until stopped";
  EXPECT_TRUE(b.holding());
}

TEST(Teleop, DrivesWithTheNewestCommand) {
  auto input = std::make_shared<TeleopInput>();
  TeleopBehavior b(input, 300);
  b.start();
  const SteadyTime t0 = SteadyTime{} + 1s;
  input->write(TeleopCommand{0.1, -0.05, 20, 1, "web"}, t0);
  auto out = b.tick(at(t0 + 50ms));
  EXPECT_DOUBLE_EQ(out.motion.vx_mps, 0.1);
  EXPECT_DOUBLE_EQ(out.motion.vy_mps, -0.05);
  EXPECT_DOUBLE_EQ(out.motion.wz_dps, 20);
  input->write(TeleopCommand{0, 0, -30, 2, "web"}, t0 + 100ms);
  out = b.tick(at(t0 + 150ms));
  EXPECT_DOUBLE_EQ(out.motion.vx_mps, 0);
  EXPECT_DOUBLE_EQ(out.motion.wz_dps, -30);
}

TEST(Teleop, DeadManStopsWhenCommandsStop) {
  auto input = std::make_shared<TeleopInput>();
  TeleopBehavior b(input, 300);
  b.start();
  const SteadyTime t0 = SteadyTime{} + 1s;
  input->write(TeleopCommand{0.15, 0, 0, 1, "web"}, t0);
  EXPECT_FALSE(b.tick(at(t0 + 290ms)).motion.is_zero());
  const auto out = b.tick(at(t0 + 310ms));  // the tab closed, or the Wi-Fi dropped
  EXPECT_TRUE(out.motion.is_zero());
  EXPECT_TRUE(b.holding());
}

TEST(Teleop, BridgeMessageParses) {
  InboundMessage m;
  std::string why;
  ASSERT_EQ(parse_inbound(R"({"type":"teleop","vx":0.1,"vy":0,"wz":-15,"seq":42})", &m, &why), ParseStatus::Ok) << why;
  EXPECT_EQ(m.type, InboundType::Teleop);
  EXPECT_DOUBLE_EQ(m.teleop.vx_mps, 0.1);
  EXPECT_DOUBLE_EQ(m.teleop.wz_dps, -15);
  EXPECT_EQ(m.teleop.seq, 42u);
}

TEST(Teleop, BridgeMessageWithoutNumbersIsRejected) {
  InboundMessage m;
  std::string why;
  EXPECT_EQ(parse_inbound(R"({"type":"teleop","vx":"fast","vy":0,"wz":0})", &m, &why), ParseStatus::Invalid);
  EXPECT_EQ(parse_inbound(R"({"type":"teleop","vx":0.1})", &m, &why), ParseStatus::Invalid);
}

}  // namespace
}  // namespace drone
