#include "engine.h"

// Full rewrite stub: evaluation always returns 0
namespace chess { int Engine::evaluateFEN(const char* /*fen*/) { return 0; } }
extern "C" int evaluate_fen(const char* /*fen*/) { return 0; }
