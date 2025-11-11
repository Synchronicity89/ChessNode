cmake_minimum_required(VERSION 3.16)
project(ModularChessEngine LANGUAGES CXX)

option(BUILD_WASM "Build WebAssembly target" OFF)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(chess_engine STATIC
    src/example.cpp
    src/fen.cpp
)

target_include_directories(chess_engine PUBLIC include)

enable_testing()
add_executable(chess_tests tests/tests_main.cpp)
target_link_libraries(chess_tests PRIVATE chess_engine)
add_test(NAME chess_tests COMMAND chess_tests)

if (BUILD_WASM)
    # Expect emcmake / emmake invocation externally
    set_target_properties(chess_engine PROPERTIES OUTPUT_NAME "engine")
endif()
