# Building the Modular Chess Engine (Cross-Platform)

This guide provides native and WebAssembly build instructions using fully cross-platform tooling. Choose either **CMake** (recommended) or the provided **Makefile** (Unix-like only). No platform-specific scripts are required.

## Prerequisites

- C++17 compiler:
  - Linux: GCC >= 9 or Clang >= 10
  - macOS: Xcode toolchain (clang) or Homebrew clang
  - Windows: MSVC (Visual Studio) or Mingw-w64 or LLVM clang
  - BSD: System clang or GCC
- Optional: Emscripten SDK for WASM build
- CMake >= 3.16 (if using CMake path)

## Directory Overview

- `engine/` – C++ source, headers, tests, CMakeLists, optional Makefile
- `web/` – Browser UI (HTML/CSS/JS) and wasm/ folder for output module

## Native Build (CMake)

```
mkdir -p engine/build
cd engine/build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --target chess_engine --config Release
ctest --output-on-failure
```

On Windows with MSVC generator you can replace the build line with:
```
cmake --build . --config Release --target chess_tests
```

## Native Build (Makefile Alternative, Unix-like)

```
cd engine
make -j
./chess_tests
```

## WebAssembly Build (Emscripten)

Activate Emscripten SDK (emsdk) so `emcmake`, `emmake`, and `em++` are in PATH.

Option A: CMake build to object/static lib then separate linking step.
```
mkdir -p engine/build-wasm
cd engine/build-wasm
emcmake cmake .. -DBUILD_WASM=ON -DCMAKE_BUILD_TYPE=Release
emmake cmake --build . --config Release --target chess_engine
```

Option B: Single-step compile producing an Emscripten glue JS + WASM pair for the bridge:
```
cd engine
em++ -std=c++17 -O3 \
  src/example.cpp src/fen.cpp \
  -Iinclude \
  -sEXPORTED_FUNCTIONS='["_evaluate_fen","_engine_version"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap"]' \
  -sMODULARIZE=1 -sEXPORT_NAME='EngineModule' \
  -o ../web/wasm/engine.js
```

This generates `engine.js` (loader) and `engine.wasm` in `web/wasm/`. The browser bridge auto-detects `engine.js` and calls the exported C functions via `cwrap`.

To rebuild after changes, rerun the em++ command; no manual copying is needed.

## Testing

- CTest (via `ctest`) runs the `chess_tests` executable.
- Makefile path: run `./chess_tests` manually.

## Cross-Platform Notes

- No OS-specific logic is embedded; file system access will be added cautiously with portable APIs.
- Avoid compiler-specific extensions unless guarded with `#ifdef` checks.
- Emscripten build is optional; JS bridge degrades gracefully without WASM.

## Troubleshooting

| Issue | Resolution |
|-------|------------|
| Missing compiler features | Verify compiler version supports C++17 (`c++ -std=c++17 -dM -E - < /dev/null | grep __cplusplus`). |
| Undefined exported WASM symbol | Ensure functions use `extern "C"` and are included in `-sEXPORTED_FUNCTIONS`. |
| Test failures | Run with `ctest --output-on-failure` or `./chess_tests` for direct stderr. |
| Windows path issues | Use forward slashes or quoted paths in CMake; avoid batch-only syntax. |

## Next Expansion Steps

1. Add more granular evaluation modules (piece-square tables, mobility, king safety).
2. Introduce a lightweight position and move generator component.
3. Expose additional C APIs for JS bridge (init_position, generate_moves, search_best_move).
4. Begin integrating a perft test harness for validation.

## License

See README section (to be finalized).
