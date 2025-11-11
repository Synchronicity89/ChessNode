This folder contains the compiled WebAssembly artifact produced by the engine build.

- Expected file: engine.wasm
- This binary is intentionally not tracked in git; see the .gitignore in this folder.
- Build via CMake + Emscripten toolchain and copy/link the output here for the web UIs to load.
