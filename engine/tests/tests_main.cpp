#include "engine.h"
#include <iostream>

static int failures = 0;

void assert_eq(const char* name, int got, int expected) {
    if (got != expected) {
        std::cerr << "FAIL: " << name << " got=" << got << " expected=" << expected << std::endl;
        failures++;
    }
}

int main() {
    assert_eq("engine_version", engine_version(), 1);
    // Empty board
    assert_eq("eval empty", evaluate_fen("8/8/8/8/8/8/8/8 w - - 0 1"), 0);
    // Start position (material balanced)
    assert_eq("eval start", evaluate_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), 0);
    // White extra queen
    int eq = evaluate_fen("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKQNR w KQkq - 0 1");
    if (eq <= 0) {
        std::cerr << "FAIL: eval extra white queen should be > 0, got=" << eq << std::endl;
        failures++;
    }

    if (failures) return 1;
    std::cout << "OK" << std::endl;
    return 0;
}
