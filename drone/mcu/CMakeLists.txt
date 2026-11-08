# Drone MCU firmware (the drone's copy of pico/CMakeLists.txt).
# It assumes a Raspberry Pi Pico (RP2040) and the Pico C SDK, like the dog; the drone's MCU board is
# TBD (drone/README.md). Change PICO_BOARD, or the toolchain, once the team confirms it.
#
# Build:
#   export PICO_SDK_PATH=/path/to/pico-sdk   # with the lib/tinyusb submodule
#   cmake -S drone/mcu -B drone/mcu/build
#   cmake --build drone/mcu/build -j
# Flash: hold BOOTSEL, plug in the board, copy drone/mcu/build/drone_mcu.uf2 onto RPI-RP2.

cmake_minimum_required(VERSION 3.13)

set(PICO_BOARD pico CACHE STRING "Board type")  # TBD: the drone's MCU board

# Fall back to a pico-sdk checked out next to this file.
if(NOT DEFINED ENV{PICO_SDK_PATH} AND NOT PICO_SDK_PATH
   AND EXISTS "${CMAKE_CURRENT_LIST_DIR}/pico-sdk/pico_sdk_init.cmake")
  set(PICO_SDK_PATH "${CMAKE_CURRENT_LIST_DIR}/pico-sdk")
endif()

include(pico_sdk_import.cmake)

project(drone_mcu C CXX ASM)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

pico_sdk_init()

add_executable(drone_mcu
  src/main.cpp
  src/devices/imu.cpp
)

target_include_directories(drone_mcu PRIVATE src)

target_compile_options(drone_mcu PRIVATE -Wall)

target_link_libraries(drone_mcu
  pico_stdlib
  hardware_watchdog
)

# USB serial to the Pi, as on the dog. Whether the drone's link is USB or a UART is TBD.
pico_enable_stdio_usb(drone_mcu 1)
pico_enable_stdio_uart(drone_mcu 0)

pico_add_extra_outputs(drone_mcu)
