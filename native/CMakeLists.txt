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
