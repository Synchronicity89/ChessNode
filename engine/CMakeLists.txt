cmake_minimum_required(VERSION 3.16)
project(ModularChessEngine LANGUAGES CXX)

option(BUILD_WASM "Build WebAssembly target" OFF)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(chess_engine STATIC
    src/example.cpp
    src/descendants.cpp
    src/fen.cpp
    src/eval.cpp
)

target_include_directories(chess_engine PUBLIC include)

enable_testing()
add_executable(chess_tests tests/tests_main.cpp)
target_link_libraries(chess_tests PRIVATE chess_engine)
add_test(NAME chess_tests COMMAND chess_tests)

# Lightweight CLI regression test (no external framework) for VS Code CTest UI
add_executable(chess_regression tests/regression_knight_blunder_cli.cpp)
target_link_libraries(chess_regression PRIVATE chess_engine)
add_test(NAME depth2_knight_blunder COMMAND chess_regression)

# A regression that ensures the engine does NOT choose the historical knight blunder (c6e5)
add_executable(chess_regression_expect_bad tests/regression_knight_blunder_expect_bad_cli.cpp)
target_link_libraries(chess_regression_expect_bad PRIVATE chess_engine)
add_test(NAME depth2_no_knight_blunder COMMAND chess_regression_expect_bad)

# CLI to dump per-child N-ply line scores for a given FEN (default depth=2)
add_executable(chess_line_scoring_dump tests/line_scoring_dump_cli.cpp)
target_link_libraries(chess_line_scoring_dump PRIVATE chess_engine)
# Register as a test so it's runnable from VS Code Test UI (outputs to console)
add_test(NAME dump_line_scores COMMAND chess_line_scoring_dump)

# Small debug CLI for tempo symmetry sanity
add_executable(tempo_sanity tests/tempo_sanity_cli.cpp)
target_link_libraries(tempo_sanity PRIVATE chess_engine)

# Small CLI to sanity-check castling-related costing
add_executable(castling_sanity tests/castling_cost_sanity_cli.cpp)
target_link_libraries(castling_sanity PRIVATE chess_engine)
add_test(NAME castling_sanity COMMAND castling_sanity)

# Undevelopment ranking expectation test (expected to fail until undevelopment penalty is implemented)
add_executable(undevelopment_rank tests/undevelopment_rank_test.cpp)
target_link_libraries(undevelopment_rank PRIVATE chess_engine)
add_test(NAME undevelopment_rank COMMAND undevelopment_rank)

# d5 best-move ranking expectation test (expected to fail until evaluation rewards this line)
add_executable(d5_best_rank tests/d5_best_rank_test.cpp)
target_link_libraries(d5_best_rank PRIVATE chess_engine)
add_test(NAME d5_best_rank COMMAND d5_best_rank)

# CLI to find bad move candidates by comparing shallow vs deep regret
add_executable(find_bad_moves tests/find_bad_moves_cli.cpp)
target_link_libraries(find_bad_moves PRIVATE chess_engine)

# CLI to dump engine score_children with PV/extension info and recurse
add_executable(score_children_dump tests/score_children_dump_cli.cpp)
target_link_libraries(score_children_dump PRIVATE chess_engine)

# --- GoogleTest integration for richer VS Code Test UI ---
option(ENABLE_GTEST "Enable GoogleTest-based tests" OFF)
if (ENABLE_GTEST)
    include(FetchContent)
    # Ensure deps go under a known folder and extract with fresh timestamps
    set(FETCHCONTENT_BASE_DIR "${CMAKE_BINARY_DIR}/_deps")
    FetchContent_Declare(
        googletest
        URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.zip
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    )
    # For Windows: prevent overriding parent project's runtime library settings
    set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
    # Workaround sporadic rename/lock issues on Windows by removing stale source dir before populate
    if (EXISTS "${FETCHCONTENT_BASE_DIR}/googletest-src")
        file(REMOVE_RECURSE "${FETCHCONTENT_BASE_DIR}/googletest-src")
    endif()
    FetchContent_MakeAvailable(googletest)

    add_executable(chess_gtests
            tests/regression_knight_blunder_test.cpp
    )
    target_link_libraries(chess_gtests PRIVATE chess_engine GTest::gtest_main)
    include(GoogleTest)
    gtest_discover_tests(chess_gtests)
endif()

if (BUILD_WASM)
    # Expect emcmake / emmake invocation externally
    set_target_properties(chess_engine PROPERTIES OUTPUT_NAME "engine")
endif()
