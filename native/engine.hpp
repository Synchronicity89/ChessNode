#pragma once
#include <cstdint>
#include <string>
#include <vector>

// Basic bitboard-based chess engine scaffold (AVX2-friendly).
// Not a full implementation; provides FEN parsing, move generation (pseudo + legal),
// simple material evaluation, and a depth-limited negamax search placeholder.
// NNUE stub exposed via nnue_eval() for future integration.

namespace engine {

using U64 = std::uint64_t;

// Piece bitboards (one per type/color).
struct Bitboards {
    U64 WP{}, WN{}, WB{}, WR{}, WQ{}, WK{};
    U64 BP{}, BN{}, BB{}, BR{}, BQ{}, BK{};
    U64 occWhite{}, occBlack{}, occAll{};
};

struct Position {
    Bitboards bb;        // bitboards
    int sideToMove = 0;  // 0 white, 1 black
    int castleRights = 0; // bit mask: 1 white O-O, 2 white O-O-O, 4 black O-O, 8 black O-O-O
    int epSquare = -1;    // en-passant target square index (0..63) or -1
    int halfmoveClock = 0;
    int fullmoveNumber = 1;
};

struct Move {
    int from{}; // 0..63
    int to{};   // 0..63
    int promo{}; // piece type for promotion or 0
    bool isCapture = false;
    bool isEnPassant = false;
    bool isCastle = false;
    bool isDoublePawnPush = false;
};

// NNUE stub interface
int nnue_eval(const Position& pos);

// FEN parsing / serialization
bool parse_fen(const std::string& fen, Position& out);
std::string to_fen(const Position& pos);

// Move generation
void generate_pseudo_moves(const Position& pos, std::vector<Move>& out);
void filter_legal(const Position& pos, const std::vector<Move>& pseudo, std::vector<Move>& legal);
std::uint64_t perft(Position& pos, int depth);

// Search
int evaluate_material(const Position& pos);
int evaluate(const Position& pos); // material + nnue stub
int negamax(Position& pos, int depth, int alpha, int beta, std::vector<Move>& pv);

// Top-level choice
std::string choose_move(const std::string& fen, int depth);
// Return all legal moves in UCI from a FEN (no search), empty on error.
std::vector<std::string> legal_moves_uci(const std::string& fen);

// Utility
inline int file_of(int sq) { return sq & 7; }
inline int rank_of(int sq) { return sq >> 3; }

bool square_attacked(const Position& pos, int sq, int byWhite);
// Bitboard of attackers from side byWhite to target square.
std::uint64_t attackers_to(const Position& pos, int sq, int byWhite);
// Improved legality filter leveraging check classification (single/double) and block squares.
void apply_move(Position& pos, const Move& m, Position& out);

} // namespace engine

extern "C" {
// C ABI for WASM / native DLL export. Returns UCI move string or empty if none.
const char* engine_choose(const char* fen, int depth);
// Toggle internal AVX2 path usage (stub; always true if compiled with AVX2).
void engine_set_avx2(int enabled);
// Perft node counter
unsigned long long engine_perft(const char* fen, int depth);
// Legal moves as a single string joined by spaces (for simple FFI). Returns pointer to thread-local buffer.
const char* engine_legal_moves(const char* fen);
}
