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

## Live demo (GitHub Pages)

- Play UI: https://synchronicity89.github.io/ChessNode/
- Developer UI: https://synchronicity89.github.io/ChessNode/engine-dev.html
- Config UI: https://synchronicity89.github.io/ChessNode/engine-config.html

Notes
- Pages is published via a CI workflow that builds the WASM artifacts on GitHub Actions; no build products are committed to the repository. See `.github/workflows/deploy-pages.yml` and BUILDING.md for details.
- The UI no longer probes `wasm/engine.js` via HTTP HEAD; the bridge attempts to load `engine.js` directly and falls back quietly if missing. If you expect engine functionality on Pages, ensure the CI build step emits `web/wasm/engine.js` and `web/wasm/engine.wasm`.

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
   - engine-config.html: Public configuration page (saves to cookie/localStorage, export/import as text).
   - engine-dev.html: Visual programming/configuration surface to assemble engine modules and parameters.
   - js/ui-board.js: Board rendering, interaction, and PGN move I/O.
   - js/ui-config.js: Manages config schema, save/load to cookie/localStorage, import/export text.
   - js/ui-devtools.js: Developer controls, component selection, wiring, and telemetry panels.
   - js/ui-engine-bridge.js: Thin FFI layer that marshals data between JS and the WASM engine, plus init/lifecycle.
   - wasm/engine.wasm: The compiled engine artifact produced by the engine build.

This layout keeps the C++ core clean, testable, and toolchain-agnostic while allowing the browser UI to orchestrate and experiment with engine composition entirely client-side.

### Building

See BUILDING.md for cross-platform native and WebAssembly build instructions using CMake (recommended) or a portable Makefile for Unix-like systems. No platform-specific scripts are required.

### Running helper scripts (PowerShell on macOS/Linux)

This repository includes a convenience script `scripts/make-stable.ps1` that creates a stable snapshot of the web UI for manual testing. It now supports a `-Build` switch which (if Emscripten is installed) performs a fresh WASM build before copying the snapshot.

- On Windows: PowerShell is available by default. You can run the script from a PowerShell terminal.
- On macOS/Linux: install PowerShell ("PowerShell 7", command `pwsh`) and optionally the VS Code PowerShell extension for editor integration. Then run:

```bash
# Snapshot only
pwsh scripts/make-stable.ps1

# Native + WASM build (if em++ available) then snapshot
pwsh scripts/make-stable.ps1 -Build

# Only native build then snapshot
pwsh scripts/make-stable.ps1 -Native

# Only WASM build then snapshot
pwsh scripts/make-stable.ps1 -Wasm

# Enforce toolchain presence (fails if missing)
pwsh scripts/make-stable.ps1 -Build -Strict
```

Notes
- The VS Code PowerShell extension provides language tooling and integrated execution but does not install C# or other languages.
- Installing PowerShell does not add C# support to this repo; C# requires separate tooling (e.g., .NET SDK and the VS Code C# extension) and is not currently used here.
- If you prefer bash/zsh, the script can be replicated in a few lines using `cp`/`rsync` (see BUILDING.md for the snapshot workflow); maintaining a second shell script is intentionally avoided to keep one source of truth.

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

### Running AI actions on GitHub Pages

The "AI Actions" buttons in `engine-dev.html` are intentionally serverless-friendly:
- On GitHub Pages they open a pre-filled GitHub Issue rather than calling an API with secrets.
- A future GitHub Actions workflow can watch for `ai-request` labeled issues and auto-generate code & tests in a PR using stored secrets.
- No secret keys are exposed to the browser; everything sensitive remains in CI or a private backend.

Alternative integration patterns:
- Local gateway: run a local tool with your API key; the UI targets `http://localhost:<port>` during development only.
- Serverless function: deploy a small authenticated endpoint (Cloudflare Workers / Netlify / Vercel) that receives structured prompts and returns generated components.
- Offline model: integrate a lightweight in-browser model (WebGPU/WASM) for small heuristic modules without external calls.

This prevents accidental key leaks while keeping the workflow transparent: idea → issue → automated PR → review → merge.

---

### Issue-driven AI workflow (automation)

How it works:
- The "AI Actions" buttons open a pre-filled GitHub Issue labeled `ai-request`.
- A GitHub Actions workflow (`.github/workflows/ai-issue-autopilot.yml`) listens for such issues.
- The workflow creates a branch, scaffolds placeholder code/tests, pushes it, and opens a Pull Request.
- You (or future automation) replace the placeholder with generated C++/tests and iterate in the PR.

How to use it:
1. Open `engine-dev.html` (locally or via GitHub Pages) and describe the request in the "Instruction Console".
2. Click one of the AI Actions (e.g., "Add New Evaluation Module"). A GitHub Issue opens with your prompt.
3. Submit the Issue. The `ai-issue-autopilot` workflow will create a PR branch and link it back on the Issue.
4. Edit the branch (commit real implementation/tests), or connect a future generation workflow to populate the PR.
5. Run CI (build/tests) and merge when ready.

Security & portability:
- No API keys in the browser or repository. Future AI integrations should run in Actions using repo/environment secrets.
- The scaffolding is cross-platform and follows the repository structure.

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

- Must compile and run on:
   - Linux
   - macOS
   - Windows
   - BSD (where a C++17 toolchain is available)
- Tooling must be platform-agnostic:
   - Primary: standard C++17 compilers (Clang, GCC, MSVC)
   - Recommended: CMake (cross-platform generator) or a simple portable Makefile for Unix-like systems
   - No platform-specific shell scripts required or assumed

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

---

## Bitboard JS Path & Native AVX2 Engine Scaffold

Recent additions introduce a faster attack-detection layer and a native C++ engine scaffold:

### JavaScript Bitboard Attacks (Default)
- `web/engine-bridge2.js` now computes attacks using precomputed bitboard masks (pawns, knights, king) and ray scanning for sliders.
- Legacy array-based attack logic retained; toggle via `EngineBridge.setLegacyAttack(true|false)`.
- Provides immediate performance uplift for square safety checks (castling, check detection) without altering external API.

### Native C++ Bitboard Core (AVX2 / WASM Ready)
- Directory: `native/` contains `engine.cpp/.hpp` and `nnue.cpp/.hpp` stubs.
- Features implemented: FEN parse, bitboard population, pawn/knight/king masks, sliding attacks, minimal king move generation, placeholder castling rights, depth-limited negamax, AVX2 popcount usage, NNUE stub hook.
- Build with CMake:
   ```powershell
   # Native (MSVC example)
   cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release
   cmake --build native/build --config Release

   # WASM (Emscripten)
   emcmake cmake -S native -B native/build-wasm -DENABLE_AVX2=OFF -DCMAKE_BUILD_TYPE=Release
   cmake --build native/build-wasm -j
   ```
- Exposed C ABI: `engine_choose(fen, depth)` returning a UCI move string (placeholder logic).

### WASM Loader Stub
- `web/engine-wasm-loader.js` attempts to fetch `wasm/engine-native.wasm` and will later bridge memory to the exported C ABI.
- Current stub does not marshal strings (needs linear memory + UTF-8 helpers); integrate after first successful WASM build.

### Next Steps / Expansion
1. Complete move generation (done) and keep refining edge cases (promotions/EP/castling checks).
 2. Slider attacks: Magic bitboards now default (fast O(1) lookup). Optional compile flag `USE_PEXT_TABLES=ON` switches to exhaustive PEXT-style tables. Future BMI2 PEXT acceleration and classic alternative magic sets can be added trivially.
### Build with Magic (default) vs PEXT tables

Magic bitboards are the default. To enable the older PEXT-style exhaustive blocker enumeration tables instead:

```powershell
cmake -S native -B native/build -DUSE_PEXT_TABLES=ON -DCMAKE_BUILD_TYPE=Release
cmake --build native/build --config Release
```

For WASM (Magic default):

```powershell
emcmake cmake -S native -B native/build-wasm -DCMAKE_BUILD_TYPE=Release
cmake --build native/build-wasm -j
```

With PEXT tables for WASM:

```powershell
emcmake cmake -S native -B native/build-wasm -DUSE_PEXT_TABLES=ON -DCMAKE_BUILD_TYPE=Release
cmake --build native/build-wasm -j
```

### Browser fallback hierarchy

1. Server-native process (outside scope of this repo) – fastest when you host a dynamic page hitting a native engine service.
2. Static page + WASM native engine loaded (Magic bitboards).
3. Static page + partial (mixed JS/WASM) if some exports missing.
4. Static page + pure JS bitboard engine.

`web/engine-wasm-loader.js` automatically attempts to load `wasm/engine-native.wasm` and, if successful, patches `EngineBridge.chooseBestMove` to delegate to native.

### Trying native through the GUI

After building WASM (producing `web/wasm/engine-native.wasm`): open the UI page and call:

```js
EngineBridge.chooseBestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', JSON.stringify({ searchDepth: 3 }))
```

The returned JSON will include `{ native: true, ... }` and the move will be placed asynchronously in `EngineBridge.nativeLast` once resolved. (The wrapper currently returns a JSON object containing a promise placeholder; forthcoming enhancement will directly return resolved data.)
3. Implement pinned-piece aware legal generation and more efficient check evasion paths.
4. Integrate a real NNUE pipeline (feature extraction: king squares, piece-square pairs, accumulator, clipped ReLU layers).
5. Validate via perft against known positions (startpos, kiwipete, EP cases) and add a CLI to compare.
6. Wire WASM memory bridging: allocate input buffer, write FEN, call `engine_choose`, read UCI string.
7. Add benchmarking comparing legacy vs JS bitboard vs native WASM paths; surface nodes/time in the UI.

---

A chess engine that is not just played with — but **collaboratively built**.

---

## Chess960 (Fischer Random) Support Plan

This section documents the scope and required changes to support Chess960 (Fischer Random) alongside the Standard Variant. The default remains Standard Variation Proper (no randomization). When Chess960 is selected with randomization off, the chosen starting position will be the standard arrangement (one of the 960 that coincides with the classic setup). When randomization is on, a legal Chess960 starting position is generated.

### UI Controls
- Mode selector: "Standard Variation Proper" | "Chess960".
- If "Chess960" is selected:
   - Enable a "Randomize" button to generate a random legal Chess960 start position.
   - If Randomize is OFF, use a Chess960 start that matches the standard arrangement (king on e, queens/rooks/bishops/knights in the classic order) so the board looks identical to Standard.
- Persist the chosen mode and position (e.g., via localStorage) and reflect the active position in the FEN/X-FEN box.

### Notation: X-FEN (Extended FEN)
To unambiguously represent castling rights and rook origins in Chess960, adopt X-FEN (also known as Shredder-FEN style):
- Standard FEN `KQkq` castling availability is extended by encoding the rook files for castling rights instead of fixed `KQkq` only.
   - Example: if White can castle kingside with the rook that started on file `h`, encode `H` (uppercase for White); if queenside rook started on `a`, encode `A`. Black uses lowercase (`h`, `a`).
   - Thus a position might show castling rights as `HAha` instead of `KQkq`.
- Backward compatibility: when the position is the standard arrangement, you may still emit `KQkq`. The parser should accept both classic FEN and X-FEN.

Required engine/bridge changes:
- Parser: Extend `parseFEN` to recognize X-FEN castling tokens (`[A-H][A-H][a-h][a-h]`) in addition to classic `KQkq`.
- Encoder: When writing FEN from the current position, prefer X-FEN if the start position is Chess960; emit classic FEN if the position is exactly the standard arrangement.
- Position state: Track the original rook files used for kingside/queenside castling rights for each side.

### Castling Semantics in Chess960
Official Chess960 rules define the final squares after castling as the same destination squares as standard chess:
- White O-O: king to `g1`, rook to `f1`
- White O-O-O: king to `c1`, rook to `d1`
- Black O-O: king to `g8`, rook to `f8`
- Black O-O-O: king to `c8`, rook to `d8`

Key differences vs Standard:
- Starting squares for king and rooks vary; the path the king/rook traverse during castling may be different.
- All squares the king passes through must be unattacked; all traversed/intervening squares must be unoccupied except the king/rook that are moving; king/rook must not have moved previously; king may not be in check at start; these are identical in spirit to standard rules, applied to the variable path.

Move generator changes:
- For each side, determine the rook associated with kingside vs queenside castling from the stored original rook files (from X-FEN or from initial placement).
- Compute the route squares and destination squares per Chess960:
   - Compute destination squares as above (c/g for king; d/f for rook), relative to the side.
   - Compute path squares between current king square and its destination, and the rook’s current square and its destination.
   - Validate occupancy and attack conditions for king-path squares; ensure rook path is clear except its own current square.
- Apply move: move king and rook to the fixed destination squares; clear castling rights accordingly.

Evaluation/search changes:
- Treat castling legality and resulting positions in the same way as Standard once the move is generated; evaluation should not assume fixed starting squares for king/rook.
- Heuristics that reference “king safety” or “castling bonus” should not depend on specific starting files; instead, measure king safety features (pawn shelter, distance from center, etc.) after the move.

### Color-Blind Layer and Presentation Mapping
The UI includes a color-blind layer and a presentation layer that can depict the engine as playing Black while the logical color orientation may be flipped.

Definitions for clarity:
- Kingside = files `e` through `h` for that side; Queenside = files `a` through `d` (files, not ranks).
- The color-blind layer abstracts orientation so that logic remains consistent regardless of board rotation or side depiction in the presentation layer.

Practical handling:
- Always compute castling in logical coordinates (color-blind layer):
   - White: O-O → king to `g1`, rook to `f1`; O-O-O → king to `c1`, rook to `d1`.
   - Black: O-O → king to `g8`, rook to `f8`; O-O-O → king to `c8`, rook to `d8`.
- When the presentation depicts the engine as Black, the color-blind layer still uses the same file targets (`c/g` and `d/f`) and performs a visual transform (flip/rotate) for display only. This covers cases where a starting position has the white king to the left of the white queen (e.g., on file `d` while the queen is on `e`); castling remains defined by destination files, not by relative left/right of the queen in the UI.
- Click-to-move helpers in the presentation layer should translate user input to logical coordinates before legality checks; castling buttons/shortcuts (if any) should trigger the same logical move generation.

### Compatibility Surface Summary
- UI:
   - Add mode selector (Standard vs Chess960) and a Randomize button enabled only in Chess960 mode.
   - Ensure FEN/X-FEN textbox and current position display reflect and accept X-FEN.
   - Keep all rendering/selection orientation-agnostic via the color-blind layer.
- Engine/Bridge:
   - Extend FEN parser/encoder for X-FEN.
   - Track original rook files for castling rights.
   - Implement Chess960 castling generation and application using fixed destination squares (c/g and d/f).
   - Maintain evaluation neutrality regarding starting files; focus on resulting position features.
- Testing:
   - Unit tests for X-FEN parse/encode round-trips (including mixed classic/X-FEN inputs).
   - Castling legality tests across several Chess960 placements (both sides, both castles).
   - UI integration tests for mode toggle, Randomize, and FEN application.

### Migration Strategy
1. Add X-FEN parser/encoder with fallback to classic FEN for the standard layout.
2. Introduce mode selector + Randomize in the UI; plumb chosen start positions to the engine via X-FEN.
3. Implement Chess960 castling in move generation and apply-move; keep standard rules intact.
4. Expand tests to cover all of the above (parser, generator, UI flow).
5. Validate with a set of known Chess960 starting positions and ensure encode/decode invariants.

---

## Castling: Standard vs Chess960 (Distances and Presentation)

This clarifies how many squares the king moves during castling in both Standard Variant and Chess960, including when the engine is depicted as Black in the presentation layer and the king appears to the left of the queen.

### Standard Variant
- Final squares are fixed and the king always moves two squares:
   - White O-O: `e1 → g1` (2 squares); rook `h1 → f1`.
   - White O-O-O: `e1 → c1` (2 squares); rook `a1 → d1`.
   - Black O-O: `e8 → g8` (2 squares); rook `h8 → f8`.
   - Black O-O-O: `e8 → c8` (2 squares); rook `a8 → d8`.
- Presentation note: Even if the UI depicts the engine as Black (board flipped), the underlying move remains exactly two king squares on both sides. The color-blind layer computes legality and destination on logical squares; the UI only rotates/reflects for display.

### Chess960 (Fischer Random)
- Final squares are the same as Standard (destination-based definition):
   - O-O: king ends on file `g` (rank 1 for White, rank 8 for Black); rook ends on file `f`.
   - O-O-O: king ends on file `c`; rook ends on file `d`.
- Distance varies depending on the king’s starting file:
   - Kingside: king moves from its start file to `g` → distance = `|startFileIndex − g|` (0–3 squares).
   - Queenside: king moves from its start file to `c` → distance = `|startFileIndex − c|` (0–3 squares).
- Examples (White on rank 1; Black analogous on rank 8):
   - King starts on `d1` (to the left of `e1`/queen on `e1`):
      - O-O: `d1 → g1` = 3 squares.
      - O-O-O: `d1 → c1` = 1 square.
   - King starts on `g1` already:
      - O-O: `g1 → g1` = 0 squares (still a castling move; rook moves `f1` as usual).
   - King starts on `c1` already:
      - O-O-O: `c1 → c1` = 0 squares (still a castling move; rook moves `d1`).
- Legality conditions mirror Standard, applied to the variable path: king and rook unmoved, king not in check, king’s path squares unattacked, and required path squares unoccupied (except the moving rook/king).

### Depicted-as-Black (Presentation) Case
- The UI may depict the engine as Black (board flipped) and you may see a starting arrangement where the “white” king appears to the left of the queen. The engine’s color-blind layer always evaluates in logical board coordinates:
   - White castles: king to `g1`/`c1`; Black castles: king to `g8`/`c8`.
   - Distances are computed on those logical files, independent of screen orientation.
- Concretely, if the logical white king starts on `d1` (queen on `e1`) while the engine is depicted as Black:
   - Queenside: king moves 1 square (`d1 → c1`).
   - Kingside: king moves 3 squares (`d1 → g1`).
- The presentation layer only transforms coordinates for display and clicks; it does not change how many squares the king moves or which squares are the legal destinations.


---

## Unified Rebuild & Run Instructions
## Native C++ GUI (Experimental)

An optional cross‑platform C++ GUI (Qt6 Widgets) is provided to interact directly with the native engine (no JS / WASM). White is engine‑driven; Black is human‑driven by clicking squares.

### Build Requirements
- Qt 6 (Widgets module) installed and discoverable by CMake (`Qt6_DIR` or on PATH).
- Existing native build prerequisites already used for `chessnative`.

### Building the GUI
```powershell
cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/build --config Release --target chess_gui
```
If Qt6 is not found, CMake will warn and skip the `chess_gui` target.

### Running
From the build output directory (adjust path if generator differs):
```powershell
native/build/Release/chess_gui.exe
```
The GUI loads piece images from `web/img/`. Ensure relative path remains valid (run from repo root or adjust `BoardWidget::setAssetsRoot`).

### Features
- Board rendering with piece images.
- Engine plays White via `engine::choose_move`.
- Click a black piece then a destination square to attempt a Black move.
- Illegal black moves produce a status message.
- Supports testing of castling / king safety directly against native logic (use custom FEN by editing `kInitialFen` in `gui/main.cpp`).

### Custom FEN
Edit `kInitialFen` in `gui/main.cpp` and rebuild to start from a debugging position (e.g. to reproduce suspicious castling scenarios without JS).

### Troubleshooting
- If images do not appear, verify the working directory so that `../web/img` resolves. Adjust to an absolute path if necessary.
- To instrument legality decisions further, extend logging inside `filter_legal` (already writes to `logs/` for castling and king checks).


This section consolidates the steps to rebuild every component from a clean state: Node dependencies, native Node addon, native C++ engines (`native/` and the modular `engine/`), optional WebAssembly build, tests, and server startup. All paths are relative to the repository root.

### Prerequisites
- Node.js (LTS) + Python 3 for `node-gyp`.
- C++ toolchain: MSVC (Windows) or Clang/GCC (macOS/Linux).
- CMake (for `native/` and `engine/`).
- Optional: Emscripten SDK (for WASM build of `engine/`). Activate it so `emcmake` is in PATH.

### Key Directories
- `server/native-addon/` – Node addon (C++ → N-API).
- `native/` – Lightweight native engine used by the addon (CMakeLists.txt present).
- `engine/` – Modular full C++ engine (tests, additional components, CMakeLists.txt). Supports native & WASM.
- `web/wasm/` – Output location for generated WASM artifacts (`engine.js`, `engine.wasm`). Not committed (ignored in `.gitignore`).

### Clean (Optional)
Run these to remove previous build artifacts (ignore errors if folders absent):
```powershell
if (Test-Path server/native-addon/build) { Remove-Item server/native-addon/build -Recurse -Force }
if (Test-Path native/build) { Remove-Item native/build -Recurse -Force }
if (Test-Path engine/build) { Remove-Item engine/build -Recurse -Force }
if (Test-Path engine/build-wasm) { Remove-Item engine/build-wasm -Recurse -Force }
if (Test-Path web/wasm) { Remove-Item web/wasm -Recurse -Force }
```

### Install Dependencies
```powershell
npm ci
```
(`npm install` also works; `ci` is faster/cleaner for locked deps.)

### Build Native Node Addon
```powershell
npm run build:addon
```
This invokes: `node-gyp rebuild --directory server/native-addon`.

### Build Lightweight Native Engine (`native/`)
```powershell
cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/build --config Release
```
Artifacts go under `native/build/`.

### Build Modular C++ Engine (`engine/`) – Native
```powershell
cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release
cmake --build engine/build --config Release
```
If tests are integrated via CTest (present `tests_main.cpp` suggests yes):
```powershell
ctest --test-dir engine/build -C Release --output-on-failure
```

### Build Modular C++ Engine (`engine/`) – WebAssembly (Optional)
Requires Emscripten. Option A (CMake):
```powershell
emcmake cmake -S engine -B engine/build-wasm -DBUILD_WASM=ON -DCMAKE_BUILD_TYPE=Release
cmake --build engine/build-wasm -j
```
Place (or copy) resulting `engine.js` / `engine.wasm` into `web/wasm/` if not already emitted there.

Option B (Direct em++ example) – adapt exported symbols as needed:
```powershell
em++ engine/src/example.cpp \
   -O3 -sALLOW_MEMORY_GROWTH=1 -sMODULARIZE=1 -sEXPORT_ES6=1 \
   -sEXPORTED_FUNCTIONS='["_engine_choose"]' \
   -sEXPORTED_RUNTIME_METHODS='["cwrap","UTF8ToString"]' \
   -o web/wasm/engine.js
```
Generates `web/wasm/engine.js` & `web/wasm/engine.wasm`.

### JavaScript / TypeScript Notes
- Plain JS lives under `web/js/` and `src/`—no bundler required.
- TypeScript files found under `web/ws/` (`promotionThreat.ts`, etc.). No `tsconfig.json` or build script currently provided; if you wish to compile them:
```powershell
npm install --save-dev typescript
npx tsc --init
npx tsc web/ws/promotionThreat.ts --outDir web/ws/dist
```
Integrate output manually or add a script (optional). Not required for core engine rebuild.

### Run Tests
JS/Vitest suite:
```powershell
npm test
```
Native castling & legality harness:
```powershell
npm run test:native
```
Engine (CTest) if built:
```powershell
ctest --test-dir engine/build -C Release --output-on-failure
```

### Start Server (Foreground)
```powershell
npm run serve:fg
```
Starts: kill port 8080 → rebuild addon → run `server/server.js` in current window.

### Start Server (Background Minimized)
```powershell
npm run serve
```
Runs port kill, addon rebuild, then launches minimized Node process.

### One-Liner Full Rebuild & Run (Including Optional WASM)
> Adjust/remove WASM segment if Emscripten absent.
```powershell
npm ci; npm run build:addon; cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release; cmake --build native/build --config Release; cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release; cmake --build engine/build --config Release; emcmake cmake -S engine -B engine/build-wasm -DBUILD_WASM=ON -DCMAKE_BUILD_TYPE=Release; cmake --build engine/build-wasm -j; npm test; npm run test:native; npm run serve:fg
```

### Troubleshooting Quick Reference
- Addon build fails: ensure Python 3 and MSVC Build Tools installed (`npm config get msvs_version` for older setups).
- WASM missing at runtime: verify `web/wasm/engine.js` & `engine.wasm` exist (optional feature; UI degrades gracefully if absent).
- Port 8080 busy: manually free with `Get-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess | Stop-Process` or rely on `scripts/kill-port.js`.
- CTest not discovering tests: confirm `tests_main.cpp` is added to an executable in `engine/CMakeLists.txt` and `enable_testing()` invoked.

### Minimal Rebuild (Addon + Server Only)
```powershell
npm ci; npm run build:addon; npm run serve:fg
```

---

