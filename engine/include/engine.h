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
