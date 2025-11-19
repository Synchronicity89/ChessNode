#include "engine.hpp"
#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <iomanip>

// Simple CLI tool: pass a FEN string (quoted) and it outputs all legal moves (UCI) separated by spaces.
// Usage (PowerShell):
//   .\legal_moves_runner.exe "6k1/p4ppp/1p6/4p3/8/P3r1P1/1P1Nq2P/RKr5 w - - 0 27"
// If no argument given, reads a single line from stdin.
int main(int argc, char** argv) {
    std::string fen;
    if (argc >= 2) {
        // Reconstruct FEN from all arguments (allow spaces if not quoted properly)
        std::ostringstream oss; for(int i=1;i<argc;i++){ if(i>1) oss << ' '; oss << argv[i]; }
        fen = oss.str();
    } else {
        if(!std::getline(std::cin, fen)) {
            std::cerr << "No FEN provided." << std::endl; return 1;
        }
    }
    engine::Position pos;
    if (!engine::parse_fen(fen, pos)) {
        std::cerr << "Failed to parse FEN." << std::endl; return 2;
    }
    // Generate pseudo moves and show king moves presence
    std::vector<engine::Move> pseudo; engine::generate_pseudo_moves(pos, pseudo);
    std::cout << "WK bitboard=0x" << std::hex << pos.bb.WK << std::dec << " BK bitboard=0x" << std::hex << pos.bb.BK << std::dec << std::endl;
    std::cout << "Pseudo count=" << pseudo.size() << std::endl;
    // Check if any king moves present
    int kingMoves=0; for (auto &m: pseudo){ if ((pos.bb.WK & (1ULL<<m.from)) || (pos.bb.BK & (1ULL<<m.from))) kingMoves++; }
    std::cout << "King pseudo moves=" << kingMoves << std::endl;
    // Dump pseudo king moves
    auto encodeSq=[&](int sq){ char f = char('a'+ engine::file_of(sq)); char r= char('1'+ engine::rank_of(sq)); return std::string({f,r}); };
    for (auto &m: pseudo){ bool km = (pos.bb.WK & (1ULL<<m.from)) || (pos.bb.BK & (1ULL<<m.from)); if (km) {
        std::cout << "  KM " << encodeSq(m.from) << encodeSq(m.to) << (m.isCapture?" x":"") << (m.isCastle?" castle":"") << std::endl; }
    }
    std::vector<std::string> moves = engine::legal_moves_uci(fen);
    std::cout << "Legal moves (" << moves.size() << "):";
    if (!moves.empty()) std::cout << ' ';
    for (size_t i=0;i<moves.size();++i) {
        if (i) std::cout << ' ';
        std::cout << moves[i];
    }
    std::cout << std::endl;
    return 0;
}
