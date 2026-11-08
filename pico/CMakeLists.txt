# ArgOS Pico firmware: Raspberry Pi Pico 1.0 (RP2040).
#
# Build:
#   export PICO_SDK_PATH=/path/to/pico-sdk   # with the lib/tinyusb submodule
#   cmake -S pico -B pico/build
#   cmake --build pico/build -j
# Flash: hold BOOTSEL, plug in the Pico, copy pico/build/argos_pico.uf2 onto RPI-RP2.

cmake_minimum_required(VERSION 3.13)

set(PICO_BOARD pico CACHE STRING "Board type")

# Fall back to a pico-sdk checked out next to this file.
if(NOT DEFINED ENV{PICO_SDK_PATH} AND NOT PICO_SDK_PATH
   AND EXISTS "${CMAKE_CURRENT_LIST_DIR}/pico-sdk/pico_sdk_init.cmake")
  set(PICO_SDK_PATH "${CMAKE_CURRENT_LIST_DIR}/pico-sdk")
endif()

include(pico_sdk_import.cmake)

project(argos_pico C CXX ASM)
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

pico_sdk_init()

# Same Melexis thermal-camera library the Pi build uses.
set(MLX_DIR ${CMAKE_CURRENT_LIST_DIR}/third_party/mlx90640)

add_executable(argos_pico
  src/main.cpp
  src/bus/i2c_bus.cpp
  src/bus/uart_rx.cpp
  src/devices/imu.cpp
  src/devices/ads1115.cpp
  src/devices/thermal.cpp
  src/devices/mlx90640_pico_i2c.cpp
  src/devices/tfluna.cpp
  src/devices/ld19.cpp
  ${MLX_DIR}/MLX90640_API.cpp
)

target_include_directories(argos_pico PRIVATE
  src
  ${MLX_DIR}
)

target_compile_options(argos_pico PRIVATE -Wall)

# The Melexis calibration code puts ~3.4 KB on the stack
# (MLX90640_ExtractParameters). The SDK default is 2 KB; 4 KB fills the
# SCRATCH_Y bank exactly.
target_compile_definitions(argos_pico PRIVATE PICO_STACK_SIZE=0x1000)

# Thermal camera pins. Default GP14/GP15 (far from the IMU/ADS bus on GP4/GP5).
# -DARGOS_THERMAL_ON_GP2=ON builds for the original wiring on GP2/GP3.
option(ARGOS_THERMAL_ON_GP2 "Thermal camera on GP2/GP3 instead of GP14/GP15" OFF)
if(ARGOS_THERMAL_ON_GP2)
  target_compile_definitions(argos_pico PRIVATE ARGOS_THERMAL_ON_GP2=1)
endif()

target_link_libraries(argos_pico
  pico_stdlib
  hardware_i2c
  hardware_uart
  hardware_irq
  pico_multicore   # thermal capture runs on core 1
)

# USB serial to the Pi; UART0/UART1 are busy with the lidars.
pico_enable_stdio_usb(argos_pico 1)
pico_enable_stdio_uart(argos_pico 0)

pico_add_extra_outputs(argos_pico)
