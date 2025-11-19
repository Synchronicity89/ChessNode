# Agent Motivation & Focus

## Core Focus
The primary engineering priority is to perfect the **native C++ engine**, especially the correctness and robustness of **castling logic** and related legality filtering. Secondary engines (WASM, JS) are explicitly de‑prioritized until native behavior is solid.

## Position Verification Workflow
1. Use `node utilities/fen2board.js "<FEN>"` to render a Unicode board for rapid human inspection (mate, stalemate, endgame material, unusual piece placement).
2. For deeper or ambiguous tactical / endgame cases, cross‑check with the installed Stockfish (`stockfish` npm package) by querying evaluation or generating its own legal moves for comparison.
3. When debugging legality (especially castling), instrument and review native engine logs in `logs/` (e.g. `illegal_castling_reverify.log`, `king_filter_debug.log`).

## Castling Emphasis
- Reverify every tentative castle move (rights, rook presence, path clearance, attack‑free transit squares).
- Maintain clear, append‑only logs for any castle move filtered out in reverification so regression causes can be traced.
- Avoid premature optimization until semantic correctness is confirmed with targeted FEN scenarios.

## Recommended Diagnostics
- Add focused runners (e.g. `legal_moves_runner`) to dump legal move sets for problematic FENs.
- Capture rejected king/escape moves with reasons to accelerate triage (see `king_filter_debug.log`).
- Pair each fix with a minimal FEN test harness before broad refactors.

## Guiding Principle
"Clarity before speed": ensure move legality—particularly checks and castling—is demonstrably correct (visual board + cross‑engine validation + internal logs) before pursuing performance tuning or feature expansion.
