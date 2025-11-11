#include "engine.h"
#include <string>
#include <cctype>

namespace {
// Very primitive FEN piece scanning: counts material (P=100, N=300, B=300, R=500, Q=900)
// Ignores side-to-move, castling, en-passant, halfmove clock, and move number for now.
int pieceValue(char c) {
    switch (std::tolower(static_cast<unsigned char>(c))) {
        case 'p': return 100;
        case 'n': return 300;
        case 'b': return 300;
        case 'r': return 500;
        case 'q': return 900;
        default: return 0;
    }
}
}

namespace chess {
int Engine::evaluateFEN(const char* fen) {
    if (!fen) return 0;
    std::string s(fen);
    // Extract board portion (up to first space)
    auto spacePos = s.find(' ');
    std::string board = (spacePos == std::string::npos) ? s : s.substr(0, spacePos);
    int score = 0;
    for (char c : board) {
        if (c == '/' || std::isdigit(static_cast<unsigned char>(c))) continue;
        int val = pieceValue(c);
        if (std::isupper(static_cast<unsigned char>(c))) score += val; // White pieces
        else score -= val; // Black pieces
    }
    return score; // centipawn material diff
}
}

extern "C" int evaluate_fen(const char* fen) {
    return chess::Engine::evaluateFEN(fen);
}
