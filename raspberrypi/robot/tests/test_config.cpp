// Config tests (docs/tasks/camille.md R0).

#include <gtest/gtest.h>

#include "core/config.hpp"

namespace robot {
namespace {

const std::string kLaptop = std::string(ROBOT_CONFIG_DIR) + "/robot.laptop.yaml";
const std::string kPi = std::string(ROBOT_CONFIG_DIR) + "/robot.yaml";

TEST(ConfigTest, LaptopConfigLoads) {
  const auto r = load_config_file(kLaptop);
  ASSERT_TRUE(r.ok) << r.error;
  EXPECT_EQ(r.config.robot_id, "dog1");
  for (const auto& name : r.config.devices_in_init_order()) {
    EXPECT_TRUE(r.config.is_mock(name)) << name << " is not mocked";
  }
  EXPECT_EQ(r.config.control_socket, "/tmp/robot/control.sock");
}

TEST(ConfigTest, PiConfigLoadsWithRealDevices) {
  const auto r = load_config_file(kPi);
  ASSERT_TRUE(r.ok) << r.error;
  EXPECT_FALSE(r.config.is_mock("pico"));
  EXPECT_FALSE(r.config.is_mock("thermal"));  // follows pico.mock
  EXPECT_TRUE(r.config.is_required("pico"));
}

TEST(ConfigTest, InitOrderPutsPicoDevicesAfterPiDevices) {
  const auto r = load_config_file(kLaptop);
  ASSERT_TRUE(r.ok) << r.error;
  const auto order = r.config.devices_in_init_order();
  ASSERT_GE(order.size(), 2u);
  EXPECT_EQ(order.front(), "maestro_a");
  EXPECT_EQ(order.back(), "ld19");
}

TEST(ConfigTest, ClipUnder15sRejected) {
  YAML::Node root = YAML::LoadFile(kLaptop);
  root["breathing"]["clip_s"] = 10;
  const auto r = load_config_node(root);
  EXPECT_FALSE(r.ok);
  EXPECT_NE(r.error.find("breathing.clip_s"), std::string::npos) << r.error;
  EXPECT_NE(r.error.find("15"), std::string::npos) << r.error;
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

}  // namespace
}  // namespace robot
