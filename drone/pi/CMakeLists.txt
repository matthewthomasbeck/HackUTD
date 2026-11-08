# Drone main program (docs/specs/drone.md), the drone's copy of raspberrypi/robot/.
# Builds on the drone's Pi (OS TBD; the dog's is Debian 12) and on a laptop (macOS or Linux).
# Libraries that are not installed are downloaded with FetchContent, so the Pi needs no sudo apt.

cmake_minimum_required(VERSION 3.20)
project(drone LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(DRONE_WERROR "Treat warnings as errors (CI)" OFF)

include(FetchContent)
find_package(Threads REQUIRED)

# yaml-cpp: the config file.
find_package(yaml-cpp QUIET)
if(NOT yaml-cpp_FOUND)
  message(STATUS "yaml-cpp not found, fetching it")
  set(YAML_CPP_BUILD_TESTS OFF CACHE BOOL "" FORCE)
  set(YAML_CPP_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
  FetchContent_Declare(yaml-cpp
    URL https://github.com/jbeder/yaml-cpp/archive/refs/tags/0.8.0.tar.gz)
  FetchContent_MakeAvailable(yaml-cpp)
endif()
# Newer yaml-cpp exports yaml-cpp::yaml-cpp, older system packages export yaml-cpp.
if(TARGET yaml-cpp::yaml-cpp)
  set(DRONE_YAML_TARGET yaml-cpp::yaml-cpp)
else()
  set(DRONE_YAML_TARGET yaml-cpp)
endif()

# nlohmann_json: control socket and bridge messages.
find_package(nlohmann_json 3.2 QUIET)
if(NOT nlohmann_json_FOUND)
  message(STATUS "nlohmann_json not found, fetching it")
  FetchContent_Declare(json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz)
  FetchContent_MakeAvailable(json)
endif()

# libsystemd: sd_notify for the systemd watchdog. Missing on macOS, so notify calls become no-ops.
find_package(PkgConfig QUIET)
if(PkgConfig_FOUND)
  pkg_check_modules(LIBSYSTEMD QUIET IMPORTED_TARGET libsystemd)
endif()
if(LIBSYSTEMD_FOUND)
  option(DRONE_WITH_SYSTEMD "Call sd_notify" ON)
else()
  option(DRONE_WITH_SYSTEMD "Call sd_notify" OFF)
endif()

# Optional backends, as on the dog. Each one is found if installed; without it the matching real
# device reports FAILED with "built without ..." and the mock still works.
if(PkgConfig_FOUND)
  pkg_check_modules(LIBCAMERA QUIET IMPORTED_TARGET libcamera)
endif()
option(DRONE_WITH_LIBCAMERA "Real camera through libcamera" ${LIBCAMERA_FOUND})

find_package(OpenCV QUIET COMPONENTS core imgproc)
option(DRONE_WITH_OPENCV "OpenCV for vision preprocessing" ${OpenCV_FOUND})

# Coral Edge TPU: libedgetpu plus the TensorFlow Lite C++ library it was built against.
find_library(EDGETPU_LIBRARY NAMES edgetpu libedgetpu.so.1)
find_library(TFLITE_LIBRARY NAMES tensorflow-lite tensorflowlite)
if(EDGETPU_LIBRARY AND TFLITE_LIBRARY)
  set(CORAL_FOUND ON)
else()
  set(CORAL_FOUND OFF)
endif()
option(DRONE_WITH_CORAL "Coral Edge TPU runtime" ${CORAL_FOUND})
message(STATUS "drone backends: libcamera=${DRONE_WITH_LIBCAMERA} opencv=${DRONE_WITH_OPENCV} coral=${DRONE_WITH_CORAL} systemd=${DRONE_WITH_SYSTEMD}")

set(DRONE_WARNINGS -Wall -Wextra -Wpedantic)
if(DRONE_WERROR)
  list(APPEND DRONE_WARNINGS -Werror)
endif()

# Everything except main.cpp goes in drone_core, so the tests link the same code the drone runs.
add_library(drone_core STATIC
  src/core/config.cpp
  src/core/geo.cpp
  src/core/log.cpp
  src/core/notify.cpp
  src/core/worker.cpp
  src/hal/device_manager.cpp
  src/hal/device_mock.cpp
  src/hal/flight_output_mock.cpp
  src/hal/flight_output_unimplemented.cpp
  src/hal/mcu_link_serial.cpp
  src/hal/mcu_text_protocol.cpp
  src/hal/mcu_link_mock.cpp
  src/hal/mcu_snapshot.cpp
  src/hal/camera_libcamera.cpp
  src/hal/camera_mock.cpp
  src/state/health.cpp
  src/state/state_machine.cpp
  src/state/safety_gate.cpp
  src/flight/flight_thread.cpp
  src/vision/vision_thread.cpp
  src/vision/detector_coral.cpp
  src/vision/detector_mock.cpp
  src/mission/behaviors/hold.cpp
  src/mission/behaviors/teleop.cpp
  src/mission/mission_intake.cpp
  src/bridge/control_server.cpp
  src/bridge/messages.cpp
  src/bridge/bridge_client.cpp
  src/localization/localizer.cpp
)
target_include_directories(drone_core PUBLIC src)
target_compile_options(drone_core PRIVATE ${DRONE_WARNINGS})
target_link_libraries(drone_core PUBLIC ${DRONE_YAML_TARGET} nlohmann_json::nlohmann_json Threads::Threads)
if(DRONE_WITH_SYSTEMD)
  target_compile_definitions(drone_core PRIVATE DRONE_WITH_SYSTEMD=1)
  target_link_libraries(drone_core PRIVATE PkgConfig::LIBSYSTEMD)
endif()
if(DRONE_WITH_LIBCAMERA)
  target_compile_definitions(drone_core PRIVATE DRONE_WITH_LIBCAMERA=1)
  target_link_libraries(drone_core PRIVATE PkgConfig::LIBCAMERA)
endif()
if(DRONE_WITH_OPENCV)
  target_compile_definitions(drone_core PRIVATE DRONE_WITH_OPENCV=1)
  target_link_libraries(drone_core PRIVATE ${OpenCV_LIBS})
endif()
if(DRONE_WITH_CORAL)
  target_compile_definitions(drone_core PRIVATE DRONE_WITH_CORAL=1)
  target_link_libraries(drone_core PRIVATE ${EDGETPU_LIBRARY} ${TFLITE_LIBRARY})
endif()

add_executable(drone src/main.cpp)
target_compile_options(drone PRIVATE ${DRONE_WARNINGS})
target_link_libraries(drone PRIVATE drone_core)

add_executable(dronectl tools/dronectl.cpp)
target_compile_options(dronectl PRIVATE ${DRONE_WARNINGS})
target_link_libraries(dronectl PRIVATE nlohmann_json::nlohmann_json)

# Tests (GoogleTest, no hardware).
find_package(GTest QUIET)
if(NOT GTest_FOUND)
  message(STATUS "GoogleTest not found, fetching it")
  set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
  FetchContent_Declare(googletest
    URL https://github.com/google/googletest/archive/refs/tags/v1.15.2.tar.gz)
  FetchContent_MakeAvailable(googletest)
endif()

enable_testing()
add_executable(drone_tests
  tests/test_config.cpp
  tests/test_state_machine.cpp
  tests/test_safety_gate.cpp
  tests/test_threads.cpp
  tests/test_log.cpp
  tests/test_mcu_text.cpp
  tests/test_teleop.cpp
  tests/test_bridge_client.cpp
  tests/test_localizer.cpp
  tests/test_mission_intake.cpp
)
target_compile_options(drone_tests PRIVATE ${DRONE_WARNINGS})
target_compile_definitions(drone_tests PRIVATE DRONE_CONFIG_DIR="${CMAKE_CURRENT_SOURCE_DIR}/config")
target_link_libraries(drone_tests PRIVATE drone_core GTest::gtest_main)
include(GoogleTest)
gtest_discover_tests(drone_tests)
