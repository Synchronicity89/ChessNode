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

Option B: Single-step compile producing an Emscripten glue JS + WASM pair for the bridge (include descendants API):
```
cd engine
em++ -std=c++17 -O3 \
  src/example.cpp src/fen.cpp src/descendants.cpp \
  -Iinclude \
  -sEXPORTED_FUNCTIONS='["_evaluate_fen","_engine_version","_generate_descendants","_generate_descendants_opts"]' \
  -sEXPORTED_RUNTIME_METHODS='["cwrap"]' \
  -sMODULARIZE=1 -sEXPORT_NAME='EngineModule' \
  -o ../web/wasm/engine.js
```

This generates `engine.js` (loader) and `engine.wasm` in `web/wasm/`. The browser bridge loads `engine.js` (no HEAD probe) and calls the exported C functions via `cwrap`. Missing WASM simply degrades to UI-only mode without console 404 spam.

To rebuild after changes, rerun the em++ command; no manual copying is needed.

### Stable Manual Test Snapshot (Optional)

You can create a reproducible static snapshot separate from ongoing development for manual testing:

```
pwsh scripts/make-stable.ps1
```

This produces `manual_test_env/web/` (ignored by git) mirroring `web/`. If WASM artifacts (`engine.js`/`engine.wasm`) exist, they are copied; otherwise the UI runs in stub mode. Point Live Server at `manual_test_env/web/index.html` for a stable environment while continuing edits in `web/`.

Regenerate after meaningful changes to refresh the snapshot.

## Testing

- CTest (via `ctest`) runs the `chess_tests` executable.
- Makefile path: run `./chess_tests` manually.

### Line scoring dump (CLI)

For ad‑hoc inspection of N‑ply line scores from a given FEN, build and run the helper executable:

- With CMake configured as above, the target `chess_line_scoring_dump` is built alongside tests.
- It also registers as a CTest: `ctest -R dump_line_scores -V` runs it with defaults.

Direct usage (arguments are optional):

```
chess_line_scoring_dump "<fen>" <depth>
```

Defaults:
- FEN: r1bqkbnr/pppppppp/2n5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2
- Depth: 2

Scoring components included by the CLI:
- Base eval (material/tempo) via `evaluate_fen_opts`
- Center-occupancy delta since root (d4/e4/d5/e5)
- Endgame-scaled king-centering improvement since root
- Development/forward-control delta since root: controlled squares in the opponent’s half, weighted by forward rank depth using `developmentIncentive × rankAttackFactor^r` (threats to occupied squares are counted)

CLI defaults for these knobs:
- centerPiecePlacementReward = 50
- endGameKingCenterMagnet = 15
- developmentIncentive = 10.0
- rankAttackFactor = 1.1
- notJustEmptySquaresThreatReward = true

The tool prints, for each child of the parent position:
- Enumerated N‑ply leaf lines and their combined scores
- The best score found for that child

Note: combined score mirrors the engine’s current evaluation knobs (base material/tempo plus center‑delta and king‑centering scaled by endgamishness). Sentinel‑looking values (e.g., −1e+300) indicate a non‑finite score leak and are useful for debugging.

## Cross-Platform Notes

- No OS-specific logic is embedded; file system access will be added cautiously with portable APIs.
- Avoid compiler-specific extensions unless guarded with `#ifdef` checks.
- Emscripten build is optional; JS bridge degrades gracefully without WASM.

## Troubleshooting

| Issue | Resolution |
|-------|------------|
| Missing compiler features | Verify compiler version supports C++17 (`c++ -std=c++17 -dM -E - < /dev/null | grep __cplusplus`). |
| Undefined exported WASM symbol | Ensure functions use `extern "C"` and are included in `-sEXPORTED_FUNCTIONS` (see Option B command). |
| Repeated 404 for wasm/engine.js | Build the WASM artifact OR ignore; the bridge no longer probes via HEAD. Confirm `web/wasm/engine.js` exists if you expect engine functionality. |
| Test failures | Run with `ctest --output-on-failure` or `./chess_tests` for direct stderr. |
| Windows path issues | Use forward slashes or quoted paths in CMake; avoid batch-only syntax. |

## Next Expansion Steps

1. Add more granular evaluation modules (piece-square tables, mobility, king safety).
2. Introduce a lightweight position and move generator component.
3. Expose additional C APIs for JS bridge (init_position, generate_moves, search_best_move).
4. Begin integrating a perft test harness for validation.

## License

See README section (to be finalized).
