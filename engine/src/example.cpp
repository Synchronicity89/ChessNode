// example.cpp: keep only trivial version API; descendants moved to descendants.cpp
#include "engine.h"
namespace chess { int Engine::version() { return 1; } }
extern "C" int engine_version() { return chess::Engine::version(); }
