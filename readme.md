# Custom Modular Chess Engine Project  
*A C++ Chess Engine with Browser-Based Configuration, Training, and Play Interface*

## Overview

This project is a from-scratch, modular chess engine implemented primarily in **C++**, paired with a **browser-based interface** built with **HTML, CSS, jQuery, and plain JavaScript**. The goal is to enable a human developer to *orchestrate* how the chess engine evaluates and searches positions — without manually writing engine logic. Instead, **AI assistant agents (such as GPT-5)** will generate individual, well-tested C++ components based on developer direction.

The browser UI provides:
1. A **Chess Play Page** — allowing the developer or a user to play against the engine, watch engine vs engine matches, and optionally display or hide the board for maximum speed during internal testing.
2. A **Development & Configuration Page** — a visual programming environment where the human developer selects and arranges engine *components*, *search strategies*, *evaluation heuristics*, and *control flows* to define the behavior of the engine. The GUI manages engine configuration: no Node.js, no Python, no non-browser-based scripting.

The developer’s role:
- Choose which **search control modules**, **evaluation heuristics**, **move ordering preferences**, **extensions**, and **pruning strategies** to include.
- Use the web configuration interface to assemble these modules into a functioning engine.
- Direct AI agents to generate new modules, revise components, or expand GUI controls.

The AI’s role:
- Generate **C++ source files**, **header files**, **unit tests**, and **browser UI JS modules** upon request.
- Follow best-practice chess engine design principles.
- Produce test suites for **100% code coverage**, aiming for *formal verification levels* of correctness where feasible.

Human guidance and orchestration remain central — the AI produces components, but **the human developer decides how they are arranged and interact**.

---

## Technical Philosophy

1. **Everything is modular.**  
   Each component in the engine acts as a small, self-contained unit:
   - Move generation
   - Search control blocks (e.g., iterative deepening, aspiration windows, etc.)
   - Evaluation heuristics (piece-square tables, mobility scoring, pawn structure analysis, etc.)
   - Transposition table and hashing layers
   - Time management and move ordering heuristics

   Components do not depend directly on each other — instead they implement clearly defined interfaces.

2. **The browser UI is the orchestration layer.**  
   The developer configures the engine through UI elements such as dropdowns, toggle controls, tree visualizers, and script-like execution graphs.  
   No Node.js, no server runtime, no WebSockets are required — everything is local, in-browser.

3. **C++ Code Runs as a WebAssembly Module.**  
   The C++ engine is compiled to **WebAssembly** (WASM) so that:
   - The same engine core runs inside the browser GUI.
   - The same C++ codebase is compiled to native binaries for high-speed testing.
   - No external runtime or platform dependency exists.

4. **Testing and verification are mandatory.**  
   Every generated C++ component is accompanied by:
   - A minimal independent unit test suite
   - Formal behavioral expectations
   - A deterministic test mode (no time-based or random branches)

5. **jQuery is the only allowed external library in the UI.**  
   No React, Vue, Angular, Node, npm, bundlers, or build chains.

---

## Project Structure

The repository is split into two top-level domains: the C++ engine (compiled to native and WebAssembly) and the browser-only UI/orchestration layer.

```
/
├─ engine/
│  ├─ src/
│  │  └─ [AI-generated C++ component .cpp/.h files]
│  ├─ include/
│  │  └─ [public module interfaces]
│  ├─ tests/
│  │  └─ [unit test suites for each component]
│  ├─ build/
│  │  └─ [WASM and native compilation artifacts]
│  └─ CMakeLists.txt
│
└─ web/
    ├─ index.html                 (Chess Play UI)
    ├─ engine-dev.html            (Developer Orchestration UI)
    ├─ css/
    ├─ js/
    │  ├─ ui-board.js            (Chessboard rendering & interaction)
    │  ├─ ui-devtools.js         (Development mode visual programming controls)
    │  └─ ui-engine-bridge.js    (Glue layer connecting browser UI to WASM engine)
    └─ wasm/
         └─ engine.wasm            (compiled chess engine core)
```

Notes
- engine/: Contains the portable core written in C++, designed for both native and WebAssembly targets.
   - src/: Individually generated/search/evaluation components live here; each should compile in isolation and together via CMake.
   - include/: Stable public interfaces used by other engine components and the JS bridge.
   - tests/: Minimal, deterministic unit tests per component with high coverage goals.
   - build/: Out-of-source build outputs; may include subfolders per target/toolchain.
   - CMakeLists.txt: Single-source build for native and WASM (via Emscripten) with options to enable/disable components.

- web/: Pure browser runtime (no Node, no bundlers). Uses HTML/CSS/jQuery/vanilla JS only.
   - index.html: Play vs engine, engine vs engine, optional headless mode for speed testing.
   - engine-dev.html: Visual programming/configuration surface to assemble engine modules and parameters.
   - js/ui-board.js: Board rendering, interaction, and PGN move I/O.
   - js/ui-devtools.js: Developer controls, component selection, wiring, and telemetry panels.
   - js/ui-engine-bridge.js: Thin FFI layer that marshals data between JS and the WASM engine, plus init/lifecycle.
   - wasm/engine.wasm: The compiled engine artifact produced by the engine build.

This layout keeps the C++ core clean, testable, and toolchain-agnostic while allowing the browser UI to orchestrate and experiment with engine composition entirely client-side.

---

## The Chess Play Interface (index.html)

Features:
- Rendered chess board (drag/drop or click-to-move).
- Side selection: play as White, Black, or watch engine vs engine.
- Move list and optional evaluation score display.
- Toggle:
   - Show board / hide board (fast mode).
   - Show PV lines (principal variation tree).
   - Set search depth or time control.
- Save/load PGN and FEN support.

Gameplay Modes:
- **Human vs Engine**
- **Engine vs Engine**
- **Engine Self-Play (no rendering, accelerated)**

---

## The Development & Configuration Interface (engine-dev.html)

Features:
- Tree/graph-based **module assembly editor**.
- UI controls for enabling and disabling features:
   - Move ordering strategies
   - Pruning logic (null-move, late move reduction, etc.)
   - Evaluation heuristic weighting
   - Quiescence behavior
   - Time management style
- Preset system for saving and loading engine configurations.
- Buttons to request new components from AI agents:
   - “Add New Evaluation Module”
   - “Modify Selected Search Strategy”
   - “Generate Unit Tests for Selected Module”
- An instruction console for sending structured natural language requests to AI.

The resulting configuration is serialized into a structured JSON meta-file that drives compile-time selection of components.

---

## AI Interaction Workflow

1. Developer identifies needed behavior (e.g., “I want to test mobility scoring based on reachable squares minus opponent reachable squares.”)
2. Developer selects “Generate Component” in the config UI.
3. The AI generates:
    - A new C++ module implementing the requested behavior.
    - A header file exposing functions with clean signatures.
    - A test suite verifying correctness against expected input-output behaviors.
4. The developer plugs the new component into the engine using the config page.
5. The system recompiles to WASM and Native forms automatically.

---

## Formal Testing Requirements

- Every component must have:
   - Deterministic behavior under test.
   - No hidden global state unless explicitly documented.
   - Unit tests validating behavior over edge cases.
   - Integration tests validating behavior inside search stack.
- **Target:** 100% line, branch, and state coverage.

Testing framework will use:
- CTest (integrated with CMake)
- No external C++ testing libraries unless unavoidable.

---

## Cross-Platform Requirements

- Must compile on:
   - Linux
   - macOS
   - Windows (via MinGW or Clang; **no BAT/Powershell build scripts permitted**)
- Build configuration uses **CMake** exclusively.

---

## Future Possible Enhancements (Optional)

- Adding NNUE-based evaluation modules (hand-coded transforms, no external training framework).
- Adding a move tree visualization graph in developer mode.
- GPU acceleration for neural evaluation using WebGPU (browser) or HIP/OpenCL (native).
- Sharing engine configurations with others (via JSON export).

---

## License

To be determined by the project owner. Recommendation: permissive MIT or BSD to allow experimentation.

---

## Concluding Vision

This project is not simply about producing “a strong chess engine.”  
It is about **creating a framework where humans architect and reason about complex decision-making systems**, while AI provides the *mechanical precision* required to implement the ideas.

The human guides the search.  
The AI supplies the building blocks.  
Together they produce a system that is:
- Transparent
- Configurable
- Verifiable
- Evolutionary in design

A chess engine that is not just played with — but **collaboratively built**.

