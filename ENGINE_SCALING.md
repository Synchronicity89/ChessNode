# Engine Performance & Scaling Guide

This document outlines a practical roadmap to speed up the engine while keeping the UI simple and portable. It focuses on high-impact CPU optimizations, explains NNUE in plain terms, and discusses how to run the engine out-of-process (outside the browser) to leverage modern CPUs. No native speedup is implemented yet — the goal is clarity and a safe migration path.

## Why CPU First (not GPU)

- Alpha–beta search is highly branchy and irregular; GPUs (CUDA/oneAPI) excel at regular, batched math. Kernel launch and data transfer overhead often dominate node work.
- State-of-the-art engines (e.g., Stockfish) extract massive gains on CPUs with bitboards, NNUE on CPU, SIMD, and multi-threading.
- GPU/oneAPI can pay off for batched evaluation (e.g., Monte Carlo Tree Search with large NN batches). For classic alpha–beta with incremental evaluation and TT-driven pruning, CPU is usually better.

## High-Impact Speedups (CPU)

- Bitboards
  - Represent board as 64-bit bitsets by piece and color.
  - Fast attack masks via shift/AND; magic bitboards or PEXT for sliding attacks.
  - Cheap operations for occupancy, mobility, pins, and checks.
- Move Generation
  - Use precomputed attack tables and magic bitboards for bishops/rooks/queens.
  - Generate captures first (MVV/LVA ordering hook).
  - Incremental make/unmake (do/undo) for speed and correctness — include Zobrist hash updates.
- Transposition Table (TT)
  - Zobrist hashing for positions; store bounds (alpha/beta/exact), depth, best move.
  - Lockless or lightweight-bucket TT; prefetch probes; tune size and replacement.
- Search & Ordering
  - Negamax + alpha–beta pruning with iterative deepening.
  - Move ordering: TT move, captures (MVV/LVA), killers, history/continuation history.
  - Pruning/reductions: null-move pruning, late move reductions (LMR), futility pruning.
  - Quiescence search for capture/noisy resolution at leaves.
- Parallelism
  - Lazy SMP / shared TT across threads with split points.
  - Affinity pinning to reduce contention; avoid false sharing in hot structs.
- Evaluation
  - Baseline: material + piece-square tables; tapered eval (midgame→endgame blend).
  - SIMD intrinsics for fast PSQT accumulation; cache-friendly data layout.
- Build & Tuning
  - Compiler: `-O3 -march=native -flto` (plus MSVC/Clang analogs), link-time optimization.
  - PGO (Profile-Guided Optimization) and BOLT can improve branch layout.
  - Continuous tuning with Fishtest-style frameworks for Elo-driven decisions.

## What is NNUE?

- NNUE (Efficiently Updatable Neural Network)
  - A lightweight feed-forward network that evaluates chess positions, designed for fast incremental updates.
  - Inputs are handcrafted features (e.g., piece-square features) that update incrementally when a move changes the board, avoiding full recomputation.
  - Runs efficiently on CPU with SIMD (SSE/AVX), often outperforming handcrafted evals while remaining much cheaper than GPU-based deep nets.
- Using NNUE with evals
  - Replace or augment your heuristic eval with NNUE scores.
  - Maintain a feature accumulator; on make/unmake move, update only affected features.
  - Compute a network forward pass per node (or per leaf) with integer or quantized weights for SIMD throughput.
  - Keep quiescence/TT/search structure the same; NNUE simply supplies better scores.

## Running the Engine Outside the Browser

- Motivation
  - Avoid browser limitations (single-threaded main thread, COOP/COEP, WASM threads availability).
  - Use full CPU power (threads, huge pages, platform intrinsics) without sandbox constraints.
- Options
  - Native executable (CLI): UI invokes a subprocess and communicates via stdio/JSON or UCI.
  - Node add-on (N-API): Direct in-process calls from the web server layer (fastest for Node).
  - WASM fallback: Keep a browser mode for demos; use native mode for production server.
- Suggested API Surface
  - `set_position(fen)`, `search({depth, time}) → {bestUci, scoreCp, depth, nodes, pv}`
  - Utilities: `list_legal_moves(fen)`, `apply_move(fen, uci)`, `is_in_check(fen, color)`, `detect_terminal(fen)`
  - Optional: `dump_candidates(fen, depth)` for diagnostics (e.g., stalemate-as-zero child scores).
- Server Flow
  - UI → server (HTTP/WebSocket) → engine module/process → results back to UI.
  - Enables multi-game concurrency, time controls, and isolation.

## Migration Plan (No Native Code Yet)

1. Keep current JS UI working; treat it as an integration harness.
2. Port core engine logic (FEN, movegen, legality, search, eval, terminal detection) to C++ bitboards with the API above.
3. Build two targets:
   - Native (for server) with threads and SIMD.
   - WASM (optional) for demo/debug (COOP/COEP-required for threads).
4. Replace JS engine calls with native bindings; leave UI unchanged.
5. Add a small CLI for score dumps and regression tests.

## Stalemate-as-Zero in Engine

- Terminal nodes in search:
  - No legal moves and not in check → return 0 (draw/stalemate).
  - No legal moves and in check → ±MATE (with depth component).
- Candidate dumps should reflect the same rule (child positions that are immediate stalemates report 0 effective score).

---

If you want, we can scaffold CMake + initial C++ bitboards and a Node wrapper next, but keep the JS UI fully functional until the native engine is ready.
