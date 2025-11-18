#include "engine.hpp"
#include <iostream>
#include <vector>

int main(int argc, char** argv) {
    std::string fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    int depth = 3;
    if (argc > 1) fen = argv[1];
    if (argc > 2) depth = std::atoi(argv[2]);
    engine::Position pos;
    if (!engine::parse_fen(fen, pos)) {
        std::cerr << "Invalid FEN" << std::endl; return 1;
    }
    auto nodes = engine::perft(pos, depth);
    std::cout << "Perft(" << depth << ") = " << nodes << std::endl;
    return 0;
}
