// Config tests (the drone's copy of the dog's tests/test_config.cpp).

#include <gtest/gtest.h>

#include "core/config.hpp"

namespace drone {
namespace {

const std::string kLaptop = std::string(DRONE_CONFIG_DIR) + "/drone.laptop.yaml";
const std::string kPi = std::string(DRONE_CONFIG_DIR) + "/drone.yaml";

TEST(ConfigTest, LaptopConfigLoads) {
  const auto r = load_config_file(kLaptop);
  ASSERT_TRUE(r.ok) << r.error;
  EXPECT_EQ(r.config.robot_id, "drone1");
  for (const auto& name : r.config.devices_in_init_order()) {
    EXPECT_TRUE(r.config.is_mock(name)) << name << " is not mocked";
  }
  EXPECT_EQ(r.config.control_socket, "/tmp/drone/control.sock");
}

TEST(ConfigTest, PiConfigLoadsWithRealDevices) {
  const auto r = load_config_file(kPi);
  ASSERT_TRUE(r.ok) << r.error;
  EXPECT_FALSE(r.config.is_mock("mcu"));
  EXPECT_FALSE(r.config.is_mock("imu"));  // follows mcu.mock
  EXPECT_FALSE(r.config.is_mock("flight_output"));
  EXPECT_TRUE(r.config.is_required("mcu"));
  EXPECT_TRUE(r.config.is_required("flight_output"));
}

TEST(ConfigTest, InitOrderPutsMcuDevicesAfterPiDevices) {
  const auto r = load_config_file(kLaptop);
  ASSERT_TRUE(r.ok) << r.error;
  const auto order = r.config.devices_in_init_order();
  ASSERT_GE(order.size(), 2u);
  EXPECT_EQ(order.front(), "flight_output");
  EXPECT_EQ(order.back(), "imu");
}

TEST(ConfigTest, MissingKeyNamesTheKey) {
  YAML::Node root = YAML::LoadFile(kLaptop);
  root["loop"].remove("rate_hz");
  const auto r = load_config_node(root);
  EXPECT_FALSE(r.ok);
  EXPECT_NE(r.error.find("loop.rate_hz"), std::string::npos) << r.error;
}

TEST(ConfigTest, WrongTypeNamesTheKey) {
  YAML::Node root = YAML::LoadFile(kLaptop);
  root["limits"]["max_lin_mps"] = "fast";
  const auto r = load_config_node(root);
  EXPECT_FALSE(r.ok);
  EXPECT_NE(r.error.find("limits.max_lin_mps"), std::string::npos) << r.error;
}

TEST(ConfigTest, UnknownDeviceRejected) {
  YAML::Node root = YAML::LoadFile(kLaptop);
  root["devices"]["required"].push_back("flux_capacitor");
  const auto r = load_config_node(root);
  EXPECT_FALSE(r.ok);
  EXPECT_NE(r.error.find("flux_capacitor"), std::string::npos) << r.error;
}

TEST(ConfigTest, DogOnlyDeviceRejected) {
  // The drone has none of the dog's actuators or lidars; naming one is a config mistake.
  YAML::Node root = YAML::LoadFile(kLaptop);
  root["devices"]["optional"].push_back("maestro_a");
  const auto r = load_config_node(root);
  EXPECT_FALSE(r.ok);
  EXPECT_NE(r.error.find("maestro_a"), std::string::npos) << r.error;
}

TEST(ConfigTest, FlightTimeoutShorterThanTwoTicksRejected) {
  YAML::Node root = YAML::LoadFile(kLaptop);
  root["flight"]["command_timeout_ms"] = 30;  // 50 Hz loop: 2 ticks are 40 ms
  const auto r = load_config_node(root);
  EXPECT_FALSE(r.ok);
  EXPECT_NE(r.error.find("flight.command_timeout_ms"), std::string::npos) << r.error;
}

TEST(ConfigTest, BridgeAndLocationKeysLoad) {
  const auto laptop = load_config_file(kLaptop);
  ASSERT_TRUE(laptop.ok) << laptop.error;
  EXPECT_EQ(laptop.config.bridge.socket, "/tmp/drone-bridge.sock");  // drone/bridge's laptop default
  EXPECT_EQ(laptop.config.bridge.heartbeat_hz, 1);
  EXPECT_TRUE(laptop.config.site.demo_mode_default);
  EXPECT_EQ(laptop.config.location.heading_source, "commanded");
  const auto pi = load_config_file(kPi);
  ASSERT_TRUE(pi.ok) << pi.error;
  EXPECT_EQ(pi.config.bridge.socket, "/run/drone/bridge.sock");
  EXPECT_EQ(pi.config.location.heading_source, "imu");
}

TEST(ConfigTest, SlowHeartbeatRejected) {
  YAML::Node root = YAML::LoadFile(kLaptop);
  root["bridge"]["heartbeat_hz"] = 0.1;  // one every 10 s: the module would mark the drone offline
  const auto r = load_config_node(root);
  EXPECT_FALSE(r.ok);
  EXPECT_NE(r.error.find("bridge.heartbeat_hz"), std::string::npos) << r.error;
}

TEST(ConfigTest, BadGyroSignRejected) {
  YAML::Node root = YAML::LoadFile(kLaptop);
  root["heading"]["gyro_sign"] = 2;
  const auto r = load_config_node(root);
  EXPECT_FALSE(r.ok);
  EXPECT_NE(r.error.find("heading.gyro_sign"), std::string::npos) << r.error;
}

}  // namespace
}  // namespace drone
