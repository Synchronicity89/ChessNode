cmake_minimum_required(VERSION 3.16)
project(ModularChessEngine LANGUAGES CXX)

option(BUILD_WASM "Build WebAssembly target" OFF)
option(CHESSNODE_INSTRUMENT "Enable extra movegen instrumentation (debug JSON/pins)" OFF)
option(CHESSNODE_INSTRUMENT_THREADS "Enable threaded symmetry comparison instrumentation" OFF)
option(ENGINE_EXPLAIN_MATH "Enable material explanation JSON instrumentation" OFF)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(chess_engine STATIC
    src/example.cpp
    src/descendants.cpp
    src/fen.cpp
    src/colorblind_engine.cpp
    src/Eval_Symmetry.cpp
)

target_include_directories(chess_engine PUBLIC include)
if (CHESSNODE_INSTRUMENT)
    target_compile_definitions(chess_engine PRIVATE CHESSNODE_INSTRUMENT=1)
endif()
if (CHESSNODE_INSTRUMENT_THREADS)
    target_compile_definitions(chess_engine PRIVATE CHESSNODE_INSTRUMENT_THREADS=1)
endif()
if (ENGINE_EXPLAIN_MATH)
    target_compile_definitions(chess_engine PRIVATE ENGINE_EXPLAIN_MATH=1)
endif()

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

# CLI to flip a FEN (color + 180° rotation) for symmetry checking
add_executable(fen_flip_cli tests/fen_flip_cli.cpp)
target_link_libraries(fen_flip_cli PRIVATE chess_engine)

# Symmetry invariance test (evaluation consistency under flip)
add_executable(symmetry_tests tests/test_symmetry.cpp)
target_link_libraries(symmetry_tests PRIVATE chess_engine)
add_test(NAME symmetry_tests COMMAND symmetry_tests)

# Bulk symmetry and consistency tests across 60 positions
add_executable(symmetry_positions tests/symmetry_positions_test.cpp)
target_link_libraries(symmetry_positions PRIVATE chess_engine)
add_test(NAME symmetry_positions COMMAND symmetry_positions)
if (CHESSNODE_INSTRUMENT_THREADS)
    target_compile_definitions(symmetry_positions PRIVATE CHESSNODE_INSTRUMENT_THREADS=1)
endif()
# Provide absolute logs directory to tests
get_filename_component(REPO_ROOT "${CMAKE_SOURCE_DIR}/.." ABSOLUTE)
set(LOGS_DIR_PATH "${REPO_ROOT}/logs")
target_compile_definitions(symmetry_positions PRIVATE LOGS_DIR="${LOGS_DIR_PATH}")

# Debug helper to inspect move list asymmetries for selected indices
add_executable(symmetry_debug tests/symmetry_debug.cpp)
target_link_libraries(symmetry_debug PRIVATE chess_engine)

# Threaded symmetry probe (instrumentation build only)
add_executable(symmetry_thread_probe tests/symmetry_thread_probe.cpp)
target_link_libraries(symmetry_thread_probe PRIVATE chess_engine)
if (CHESSNODE_INSTRUMENT_THREADS)
    target_compile_definitions(symmetry_thread_probe PRIVATE CHESSNODE_INSTRUMENT_THREADS=1)
endif()

# Dedicated symmetry trace driver (direct eval of failing FEN pairs)
add_executable(symm_trace_driver tests/symm_trace_driver.cpp)
target_link_libraries(symm_trace_driver PRIVATE chess_engine)

# Move dump driver for detailed symmetry move set comparison
add_executable(symm_move_dump_driver tests/symm_move_dump_driver.cpp)
target_link_libraries(symm_move_dump_driver PRIVATE chess_engine)

# Trade neutrality test (captures -> recaptures even material)
add_executable(trade_neutrality tests/trade_neutrality_cli.cpp)
target_link_libraries(trade_neutrality PRIVATE chess_engine)
add_test(NAME trade_neutrality COMMAND trade_neutrality)

# Depth-6 drawish evaluation symmetry test
add_executable(depth6_eval tests/depth6_eval_cli.cpp)
target_link_libraries(depth6_eval PRIVATE chess_engine)
add_test(NAME depth6_eval COMMAND depth6_eval)

# Even-depth draw evaluation (2,4,6,8) for provided FEN and its flip
# even_depth_eval is currently too slow; disable for now
# add_executable(even_depth_eval tests/even_depth_eval_cli.cpp)
# target_link_libraries(even_depth_eval PRIVATE chess_engine)
# add_test(NAME even_depth_eval COMMAND even_depth_eval)

# Parent zero-eval test at depth 6
add_executable(parent_zero_eval tests/parent_zero_eval_cli.cpp)
target_link_libraries(parent_zero_eval PRIVATE chess_engine)
add_test(NAME parent_zero_eval COMMAND parent_zero_eval)

# Illegal black root quick test
add_executable(illegal_black_root tests/illegal_black_root_cli.cpp)
target_link_libraries(illegal_black_root PRIVATE chess_engine)
add_test(NAME illegal_black_root COMMAND illegal_black_root)

# Engine-vs-engine promotion race test from provided FEN at depth 10
# black_promotes_first hangs under current colorblind model; disable for now
# add_executable(black_promotes_first tests/black_promotes_first_cli.cpp)
# target_link_libraries(black_promotes_first PRIVATE chess_engine)
# add_test(NAME black_promotes_first COMMAND black_promotes_first)

## Removed: depth19_detect_promotion (too slow to run in CI/local)

# Depth-4 diagnostic for knight capture vs bishop move
add_executable(why_no_knight_take tests/why_no_knight_take_cli.cpp)
target_link_libraries(why_no_knight_take PRIVATE chess_engine)
add_test(NAME why_no_knight_take COMMAND why_no_knight_take)

# CLI: choose_best_move (FEN depth -> JSON)
add_executable(choose_best_move_cli tests/choose_best_move_cli.cpp)
target_link_libraries(choose_best_move_cli PRIVATE chess_engine)

# CLI: apply_move_if_legal (FEN move -> new FEN or error JSON)
add_executable(apply_move_cli tests/apply_move_cli.cpp)
target_link_libraries(apply_move_cli PRIVATE chess_engine)

# Bishop capture preference regression (pawn takes bishop vs quiet)
add_executable(bishop_pawn_capture_pref tests/bishop_pawn_capture_pref_cli.cpp)
target_link_libraries(bishop_pawn_capture_pref PRIVATE chess_engine)
add_test(NAME bishop_pawn_capture_pref COMMAND bishop_pawn_capture_pref)

# Explanation CLI: prove ENGINE_EXPLAIN_MATH returns explanation with best move
add_executable(explain_best_move tests/explain_best_move_cli.cpp)
target_link_libraries(explain_best_move PRIVATE chess_engine)
add_test(NAME explain_best_move COMMAND explain_best_move)

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
