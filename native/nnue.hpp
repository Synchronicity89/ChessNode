#pragma once
#include "engine.hpp"

namespace engine {
// Simple NNUE stub: returns 0; real implementation will load feature vectors and apply layers.
int nnue_eval(const Position& pos);
}
