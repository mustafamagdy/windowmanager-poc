cmake_minimum_required(VERSION 3.20)
project(WindowManagerNative LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(windowmanager_native STATIC
  src/platform/native/window_controller_stub.cpp
)

target_include_directories(windowmanager_native PUBLIC src/platform/native)

add_library(windowmanager_win STATIC src/platform/win/native/window_controller_stub.cpp)
target_link_libraries(windowmanager_win PUBLIC windowmanager_native)

add_library(windowmanager_mac STATIC src/platform/mac/native/window_controller_stub.cpp)
target_link_libraries(windowmanager_mac PUBLIC windowmanager_native)

add_library(windowmanager_linux STATIC src/platform/linux/native/window_controller_stub.cpp)
target_link_libraries(windowmanager_linux PUBLIC windowmanager_native)
