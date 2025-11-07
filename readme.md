# Compact 64-Bit Chess Engine Architecture

This repository contains the early-stage implementation of a chess engine designed around **ultra-compact board state representation**. The primary objective is not strength (yet), but a **reversible, fast, 64-bit-storable position encoding** strategy that enables:

- Extremely fast hashing and equality checks
- Small memory footprint for transposition tables
- Ability to store millions of searchable game states in RAM
- Efficient disk/memory caching of reachable positions

This engine is built so its **core logic can later be migrated to C/C++** for performance.

---

## Core Concept: Two Principal Storage Formats

The engine uses **two formats** to represent the board. Each position always fits into one of these formats, and in rare cases into a 3rd fallback mode known as **Cheat Data**.

| Format | Sign Bit | Purpose | Where Used |
|-------|---------|---------|------------|
| **Format 1** (Indexed) | Positive integer | Index into known/learned position sets | Openings, common midgames |
| **Format 2** (Direct Combinatorial Encoding) | Negative integer | Fully reversible encoding of the board itself | Reduced-material positions (≤ 12–13 pieces) |
| **Cheat Data (rare fallback)** | N/A | Auxiliary bits storing overflow state | Complex middle-games not in tables |

---

## Format 1 — Indexed State Representation

Format 1 uses the 64-bit integer as a **reference index** into one of several data sources:

1. **Opening Database** (e.g., ECO branches, PGN-derived tree)
2. **Game Database** (high-frequency real positions)
3. **Reachability Lookup Table** (only legal positions seen during engine search)

The lookup table is intentionally bounded, e.g.:

- Max size: **≤ 5 GB**
- Stored in a compressed binary format
- Indexed by 62–63 bit integers

This allows efficient recovery of exact board state when needed and nearly zero-cost move comparison.

---

## Format 2 — Direct Reversible Combinatorial Encoding

Format 2 encodes the board **directly** in ≤ 63 bits payload, relying on the fact that many mid/late-game positions have fewer pieces.

Instead of encoding each piece as a distinct entity, we exploit that **pieces of the same type & color are interchangeable**. This dramatically reduces state entropy.

This encoding includes:

- Piece counts by type
- Combinatorial index of occupied square selections
- Side to move (1 bit)
- Castling rights (4 bits)
- En passant file index (0–8 → 4 bits)

Typical threshold:  
Positions with **≤ 12–13 pieces** compress reliably; more than that generally shift to Format 1 or fallback.

---

## Cheat Data Fallback (Rare)

If a position:

- Has too many pieces **and**
- Is not in Format 1 tables **and**
- Cannot be compressed into Format 2,

then a small **auxiliary data block** is stored once and referenced by ID.

Expected frequency: < 0.1% of all observed engine internal positions.

---

## High-Level Engine Architecture

```
+----------------------+ +-----------------------+
| Move Generator |-----> | Position Updater |
+----------------------+ +-----------+-----------+
								 |
								 v
 +----------------------+ +-----------------------+
 | Format Selector |<----> | Encoding Layer |
 | (F1 / F2 / Fallback) | | (Reversible Mapping) |
 +-----------+----------+ +-----------+-----------+
			 |                                  |
			 v                                  v
 +----------------------+ +-----------------------+
 | Opening/Game Adapter | | Reachability Table |
 | (Plugin Interface)   | | (Learned during play) |
 +----------------------+ +-----------------------+
```

The Adapter Plugin can source opening/game data from:

- Local disk cache
- Remote PGN / Lichess / ChessDB sources
- Engine-generated self-play tables

This allows the engine to "learn" its own reachable positions over time.

---

## Example: Format 2 Combinatorial Encoder (Illustrative)

Below is a simplified demonstration-only version of the format 2 encoder. This is not optimized and does not yet handle all metadata fields — but it shows the core multiset combinatorial indexing principle.

```js
// src/format2_encode.js
// Demonstration encoder for pawn + king + knight subsets

function choose(n, k) {
	if (k < 0 || k > n) return 0n;
	let res = 1n;
	for (let i = 1n; i <= k; i++) {
		res = res * BigInt(n) / i;
		n--;
	}
	return res;
}

// Rank a sorted set of square indices into a combinatorial index
function rankCombination(positions, totalSquares = 64) {
	let k = positions.length;
	let index = 0n;
	let prev = -1;
	for (let i = 0; i < k; i++) {
		let p = positions[i];
		for (let sq = prev + 1; sq < p; sq++) {
			index += choose(totalSquares - sq - 1, k - i - 1);
		}
		prev = p;
	}
	return index;
}

function encodePosition(pieces) {
	// Example input:
	// pieces = { whiteKing: 60, whitePawn: [52, 53], blackKing: 4 }

	let squares = [];

	if (pieces.whiteKing !== undefined) squares.push(pieces.whiteKing);
	if (pieces.blackKing !== undefined) squares.push(pieces.blackKing);
	if (pieces.whitePawn !== undefined) squares.push(...pieces.whitePawn);
	// Extend for all piece types...

	squares = squares.sort((a, b) => a - b);
	const index = rankCombination(squares, 64);

	return index; // Later packed with metadata
}

module.exports = { encodePosition };
```

This code demonstrates the combinatorial ranking that underlies Format 2. Full implementation will:

- Support all piece types and multiplicities
- Encode side to move, castling flags, en passant, and optional repetition control state
- Pack results into a 64-bit BigInt

### Next Steps (Recommended Development Path)

- Extend the Format 2 encoder to fully support all piece types.
- Implement the Format 2 decoder (reverse combinatorial unranking).
- Implement the Format 1 lookup and index extraction routines.
- Add caching and table growth based on engine self-play.
- Introduce Zobrist hashing compatibility for transposition tables.
- Begin improving move evaluation heuristics and search depth.

### Long-Term Goal

Once the compact representation layer is stable and fast, we begin substituting:

- Move generator → rewritten in C/C++ optimized bitboards
- Position encoder → C/C++ pure register operations
- Engine logic → alpha-beta / MCTS / NNUE, depending on direction

The format system designed here remains valid throughout all future evolution.

### License

MIT — open for adaptation and experimentation.

---

## API keys (optional integrations)
- Lichess Downloader UI: http://localhost:3000/lichess
	- Provide a Lichess username and optional filters; the server will use your token from `API_KEYS/Lichess/API_token.json` unless you provide one in the form.

### Lichess download, cache, and position database

The endpoint `/api/lichess/download` and the page `/lichess` let you download games from Lichess and index all positions:

- PGNs are cached under `cache/lichess/<criteria-hash>/games.pgn`.
- Unique positions are written to `data/game_positions/<criteria-hash>.jsonl`.
- Each record contains:
	- `hi` and `lo`: two 64-bit integers serialized as hex strings
	- `fen`: canonical 4-field FEN (no halfmove/fullmove)
	- `method`: `format2` when directly packed, `cheat` when using the cheat-store reference, or `zero` if packing failed

Incremental global database:

- In addition to the per-run file, new positions are appended to `data/game_positions/global.jsonl`.
- Deduplication across runs is handled by `data/game_positions/global.index` (SHA-1 of canonical 4-field FENs).
- The API response includes `globalAdded` = number of positions newly added to the global DB in that run.

Notes:

- Deduplication: positions are deduped by canonical 4-field FEN during indexing to avoid duplicates.
- Two 64-bit integers: when a position compresses into Format 2 it stores in `lo` with `hi=0`. Otherwise, a cheat-store reference is encoded in `lo` (format1-cheat) and `hi=0`. If encoding ever fails, both `hi` and `lo` are `0x0`, and the `fen` still records the position for verification.
- The position DB (`data/`) and cache (`cache/`) are ignored by Git.

If you plan to integrate with external services (e.g., Lichess), store secrets in the `API_KEYS` folder at the repository root. The folder itself is committed to source control, but its contents are ignored.

Folder layout (example):

```
API_KEYS/
	.gitkeep                  # placeholder so the folder exists in Git
	Lichess/
		API_token.json          # your private API token (ignored by Git)
```

Create the file `API_KEYS/Lichess/API_token.json` with this shape:

```json
{
	"token": "your-lichess-api-token"
}
```

Notes:

- The `.gitignore` is configured to ignore everything under `API_KEYS/` except the `.gitkeep` placeholder. Your real tokens won’t be committed by accident.
- The sample file may be present locally with a dummy string, but it will not be tracked by Git.
- Replace the dummy string with your real token before running any code that talks to Lichess.

