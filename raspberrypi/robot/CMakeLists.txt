# Robot main program (docs/specs/robot.md section 3.2).
# Builds on the Pi (Debian 12, g++ 12, CMake 3.25) and on a laptop (macOS or Linux).
# Libraries that are not installed are downloaded with FetchContent, so the Pi needs no sudo apt.

cmake_minimum_required(VERSION 3.20)
project(robot LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(ROBOT_WERROR "Treat warnings as errors (CI)" OFF)

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
  set(ROBOT_YAML_TARGET yaml-cpp::yaml-cpp)
else()
  set(ROBOT_YAML_TARGET yaml-cpp)
endif()

# nlohmann_json: control socket messages.
find_package(nlohmann_json 3.2 QUIET)
if(NOT nlohmann_json_FOUND)
  message(STATUS "nlohmann_json not found, fetching it")
  FetchContent_Declare(json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz)
  FetchContent_MakeAvailable(json)
endif()

# stb_image_write: one public-domain header, to save the camera frame for the terrain hint as JPEG.
FetchContent_Declare(stb_image_write
  URL https://raw.githubusercontent.com/nothings/stb/1ee679ca2ef753a528db5ba6801e1067b40481b8/stb_image_write.h
  URL_HASH SHA256=cbd5f0ad7a9cf4468affb36354a1d2338034f2c12473cf1a8e32053cb6914a05
  DOWNLOAD_NO_EXTRACT TRUE)
FetchContent_MakeAvailable(stb_image_write)

# libsystemd: sd_notify for the systemd watchdog. Missing on macOS, so notify calls become no-ops.
find_package(PkgConfig QUIET)
if(PkgConfig_FOUND)
  pkg_check_modules(LIBSYSTEMD QUIET IMPORTED_TARGET libsystemd)
endif()
if(LIBSYSTEMD_FOUND)
  option(ROBOT_WITH_SYSTEMD "Call sd_notify" ON)
else()
  option(ROBOT_WITH_SYSTEMD "Call sd_notify" OFF)
endif()

# Optional backends. Each one is found if installed; without it the matching real device
# reports FAILED with "built without ..." and the mock still works.
if(PkgConfig_FOUND)
  pkg_check_modules(LIBCAMERA QUIET IMPORTED_TARGET libcamera)
endif()
option(ROBOT_WITH_LIBCAMERA "Real camera through libcamera" ${LIBCAMERA_FOUND})

find_package(OpenCV QUIET COMPONENTS core imgproc)
option(ROBOT_WITH_OPENCV "OpenCV for vision preprocessing" ${OpenCV_FOUND})

# Coral Edge TPU: libedgetpu plus the TensorFlow Lite C++ library it was built against.
find_library(EDGETPU_LIBRARY NAMES edgetpu libedgetpu.so.1)
find_library(TFLITE_LIBRARY NAMES tensorflow-lite tensorflowlite)
if(EDGETPU_LIBRARY AND TFLITE_LIBRARY)
  set(CORAL_FOUND ON)
else()
  set(CORAL_FOUND OFF)
endif()
option(ROBOT_WITH_CORAL "Coral Edge TPU runtime" ${CORAL_FOUND})

# pigpiod client for the DC motor drivers (sudo apt install pigpio). Without it the drivers report FAILED.
find_path(PIGPIO_INCLUDE_DIR pigpiod_if2.h)
find_library(PIGPIOD_IF2_LIBRARY NAMES pigpiod_if2)
if(PIGPIO_INCLUDE_DIR AND PIGPIOD_IF2_LIBRARY)
  set(PIGPIO_FOUND ON)
else()
  set(PIGPIO_FOUND OFF)
endif()
option(ROBOT_WITH_PIGPIO "DC motors through pigpiod" ${PIGPIO_FOUND})
message(STATUS "robot backends: libcamera=${ROBOT_WITH_LIBCAMERA} opencv=${ROBOT_WITH_OPENCV} coral=${ROBOT_WITH_CORAL} systemd=${ROBOT_WITH_SYSTEMD} pigpio=${ROBOT_WITH_PIGPIO}")

set(ROBOT_WARNINGS -Wall -Wextra -Wpedantic)
if(ROBOT_WERROR)
  list(APPEND ROBOT_WARNINGS -Werror)
endif()

# Everything except main.cpp goes in robot_core, so the tests link the same code the robot runs.
add_library(robot_core STATIC
  src/core/config.cpp
  src/core/geo.cpp
  src/core/log.cpp
  src/core/notify.cpp
  src/core/worker.cpp
  src/hal/device_manager.cpp
  src/hal/device_mock.cpp
  src/hal/servo_maestro.cpp
  src/hal/servo_mock.cpp
  src/hal/dc_driver_gpio.cpp
  src/hal/dc_driver_mock.cpp
  src/hal/gpio_pigpio.cpp
  src/hal/pico_link_serial.cpp
  src/hal/pico_text_protocol.cpp
  src/hal/pico_link_mock.cpp
  src/hal/pico_snapshot.cpp
  src/hal/camera_libcamera.cpp
  src/hal/camera_mock.cpp
  src/state/health.cpp
  src/state/state_machine.cpp
  src/state/safety_gate.cpp
  src/motion/leg_ik_mock.cpp
  src/motion/leg_ik_2link.cpp
  src/motion/movement_thread.cpp
  src/vision/vision_thread.cpp
  src/vision/detector_coral.cpp
  src/vision/detector_mock.cpp
  src/mission/behaviors/hold.cpp
  src/mission/behaviors/thermal_seek.cpp
  src/perception/thermal_detector.cpp
  src/mission/mission_intake.cpp
  src/bridge/control_server.cpp
  src/bridge/messages.cpp
  src/bridge/bridge_client.cpp
  src/localization/localizer.cpp
  src/terrain/terrain.cpp
  src/terrain/terrain_rules.cpp
  src/terrain/terrain_mock.cpp
  src/terrain/terrain_hint.cpp
  src/terrain/terrain_pipeline.cpp
  src/terrain/terrain_reporter.cpp
  src/terrain/terrain_frame_writer.cpp
)
target_include_directories(robot_core SYSTEM PRIVATE ${stb_image_write_SOURCE_DIR})
target_include_directories(robot_core PUBLIC src)
target_compile_options(robot_core PRIVATE ${ROBOT_WARNINGS})
target_link_libraries(robot_core PUBLIC ${ROBOT_YAML_TARGET} nlohmann_json::nlohmann_json Threads::Threads)
if(ROBOT_WITH_SYSTEMD)
  target_compile_definitions(robot_core PRIVATE ROBOT_WITH_SYSTEMD=1)
  target_link_libraries(robot_core PRIVATE PkgConfig::LIBSYSTEMD)
endif()
if(ROBOT_WITH_LIBCAMERA)
  target_compile_definitions(robot_core PRIVATE ROBOT_WITH_LIBCAMERA=1)
  target_link_libraries(robot_core PRIVATE PkgConfig::LIBCAMERA)
endif()
if(ROBOT_WITH_OPENCV)
  target_compile_definitions(robot_core PRIVATE ROBOT_WITH_OPENCV=1)
  target_link_libraries(robot_core PRIVATE ${OpenCV_LIBS})
endif()
if(ROBOT_WITH_PIGPIO)
  target_compile_definitions(robot_core PRIVATE ROBOT_WITH_PIGPIO=1)
  target_include_directories(robot_core PRIVATE ${PIGPIO_INCLUDE_DIR})
  target_link_libraries(robot_core PRIVATE ${PIGPIOD_IF2_LIBRARY})
endif()
if(ROBOT_WITH_CORAL)
  target_compile_definitions(robot_core PRIVATE ROBOT_WITH_CORAL=1)
  target_link_libraries(robot_core PRIVATE ${EDGETPU_LIBRARY} ${TFLITE_LIBRARY})
endif()

add_executable(robot src/main.cpp)
target_compile_options(robot PRIVATE ${ROBOT_WARNINGS})
target_link_libraries(robot PRIVATE robot_core)

add_executable(robotctl tools/robotctl.cpp)
target_compile_options(robotctl PRIVATE ${ROBOT_WARNINGS})
target_link_libraries(robotctl PRIVATE nlohmann_json::nlohmann_json)

add_executable(robot_diag tools/robot_diag.cpp)
target_compile_options(robot_diag PRIVATE ${ROBOT_WARNINGS})
target_link_libraries(robot_diag PRIVATE robot_core)

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
add_executable(robot_tests
  tests/test_config.cpp
  tests/test_state_machine.cpp
  tests/test_safety_gate.cpp
  tests/test_threads.cpp
  tests/test_log.cpp
  tests/test_pico_text.cpp
  tests/test_dc_driver.cpp
  tests/test_mecanum.cpp
  tests/test_calibration.cpp
  tests/test_legs.cpp
  tests/test_thermal_seek.cpp
  tests/test_bridge_client.cpp
  tests/test_localizer.cpp
  tests/test_mission_intake.cpp
  tests/test_terrain.cpp
)
target_compile_options(robot_tests PRIVATE ${ROBOT_WARNINGS})
target_compile_definitions(robot_tests PRIVATE ROBOT_CONFIG_DIR="${CMAKE_CURRENT_SOURCE_DIR}/config")
target_link_libraries(robot_tests PRIVATE robot_core GTest::gtest_main)
include(GoogleTest)
gtest_discover_tests(robot_tests)
