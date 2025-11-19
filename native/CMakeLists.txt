cmake_minimum_required(VERSION 3.20)
project(ChessNodeNative LANGUAGES CXX)

option(ENABLE_AVX2 "Enable AVX2 optimizations" ON)
option(USE_PEXT_TABLES "Use PEXT-style exhaustive blocker enumeration instead of Magic bitboards" OFF)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(chessnative STATIC engine.cpp nnue.cpp)
if(USE_PEXT_TABLES)
  target_compile_definitions(chessnative PRIVATE USE_PEXT_TABLES=1)
else()
  target_compile_definitions(chessnative PRIVATE USE_MAGIC_BITBOARDS=1)
endif()
add_executable(perft_runner perft.cpp)
target_link_libraries(perft_runner PRIVATE chessnative)

# ================= GUI (Qt) =================
# Optional cross-platform GUI: requires Qt6 (Widgets). If not found, target is skipped.
find_package(Qt6 COMPONENTS Core Gui Widgets QUIET)
if (Qt6_FOUND)
  message(STATUS "Qt6 found: enabling chess_gui target")
  add_executable(chess_gui
    ../gui/main.cpp
    ../gui/BoardWidget.cpp
    ../gui/EngineController.cpp
  )
  target_include_directories(chess_gui PRIVATE ../gui)
  target_link_libraries(chess_gui PRIVATE chessnative Qt6::Core Qt6::Gui Qt6::Widgets)
  target_compile_definitions(chess_gui PRIVATE CHESS_GUI_QT=1)
  if (MSVC)
    target_compile_options(chess_gui PRIVATE /Zc:__cplusplus)
  endif()
else()
  message(WARNING "Qt6 not found; chess_gui target disabled. Install Qt6 (Widgets) to build GUI.")
endif()

# Runner to dump legal moves from a FEN (for debugging castling legality etc.)
add_executable(legal_moves_runner legal_moves_runner.cpp)
target_link_libraries(legal_moves_runner PRIVATE chessnative)

# Detect compiler for AVX2 flags
if(ENABLE_AVX2)
  if (MSVC)
    add_compile_options(/arch:AVX2)
  else()
    add_compile_options(-mavx2)
  endif()
endif()

# Position Independent for shared/WASM
set_target_properties(chessnative PROPERTIES POSITION_INDEPENDENT_CODE ON)

# Export header directory
target_include_directories(chessnative PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# WASM build example (use emcmake):
# emcmake cmake -DENABLE_AVX2=OFF -DCMAKE_BUILD_TYPE=Release ..
# emmake make -j
# Produces libchessnative.a (then wrap with custom driver to expose engine_choose).
