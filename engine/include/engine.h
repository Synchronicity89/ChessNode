#ifndef ENGINE_H
#define ENGINE_H

#ifdef __cplusplus
extern "C" {
#endif

// C API: minimal stable surface exposed to JS/WASM bridge
int engine_version();
// Evaluate a FEN string using a trivial material-only heuristic (placeholder).
// Returns centipawns from White perspective.
int evaluate_fen(const char* fen);
// Evaluate a FEN with configurable options. Returns white-centric centipawns (int).
// Options JSON (all optional):
// {
//   "weights": { "p":100, "n":300, "b":300, "r":500, "q":900, "k":0 },
//   "terms": { "material":true, "tempo":false },
//   "tempo": 10  // centipawns added for side-to-move when terms.tempo=true
// }
int evaluate_fen_opts(const char* fen, const char* optionsJson);
// Symmetry-safe colorblind evaluation (white-centric) computing per-side features and subtracting.
int evaluate_fen_colorblind(const char* fen, const char* optionsJson);
// Generate a JSON string describing descendants up to depth (pseudo moves) with optional N+1 filter.
// Backward-compatible basic entry point.
const char* generate_descendants(const char* fen, int depth, int enableNPlus1);
// Extended configurable variant: optionsJson may contain keys:
//   includeCastling: true/false
//   includeEnPassant: true/false
//   promotions: string e.g. "qrbn" subset/order
//   capPerParent: integer (0=unlimited, limits number of generated moves per parent)
//   uniquePerPly: true/false (deduplicate identical child FENs within a ply)
// Example: {"includeCastling":false,"promotions":"qn","capPerParent":12}
// Null/empty -> defaults.
const char* generate_descendants_opts(const char* fen, int depth, int enableNPlus1, const char* optionsJson);

// List legal moves for a position. If fromSqOrNull is non-null (e.g. "e2") restrict to moves originating there.
// Returns JSON array/object string, or {"error":"..."} on failure.
const char* list_legal_moves(const char* fen, const char* fromSqOrNull, const char* optionsJson);

// Apply a UCI move (e.g. "e2e4", "e7e8q") to the position if legal given options; returns new FEN or {"error":"illegal"}.
const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson);

// Evaluate a move line (sequence of UCI moves) starting from FEN using the given evaluation options.
// movesJson: JSON array of strings, e.g., ["e2e4","e7e5","g1f3"].
// Returns JSON: {"start":"FEN","nodes":[{"ply":1,"uci":"e2e4","fen":"...","eval":12},...],"finalFen":"...","finalEval":34}
const char* evaluate_move_line(const char* fen, const char* movesJson, const char* optionsJson);

#ifdef CHESSNODE_INSTRUMENT_THREADS
// Threaded symmetry debug (instrumentation build only).
// Returns rich JSON diff of pseudo/legal movegen between original and flipped FEN.
const char* debug_compare_symmetry(const char* fen, const char* optionsJson);
#endif

#ifdef __cplusplus
}
#endif

// C++ API: starting point for future components
namespace chess {
class Engine {
public:
    static int version();
    static int evaluateFEN(const char* fen);
};
}

#endif // ENGINE_H
