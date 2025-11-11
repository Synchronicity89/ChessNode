#include "engine.h"

namespace chess {
int Engine::version() { return 1; }
}

extern "C" int engine_version() { return chess::Engine::version(); }
