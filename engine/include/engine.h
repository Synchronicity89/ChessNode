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
