#include "engine.h"
#include <iostream>
#include <string>
#include <vector>
#include <cstdlib>
#include <cstring>

extern "C" const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson);
extern "C" const char* list_legal_moves(const char* fen, const char* fromSqOrNull, const char* optionsJson);
extern "C" const char* choose_best_move(const char* fen, const char* optionsJson);

static std::string castling_rights(const char* fen){
    if (!fen) return "-"; std::string s(fen);
    size_t p1 = s.find(' '); if (p1==std::string::npos) return "-";
    size_t p2 = s.find(' ', p1+1); if (p2==std::string::npos) return "-";
    size_t p3 = s.find(' ', p2+1); if (p3==std::string::npos) return "-";
    return s.substr(p2+1, p3-(p2+1));
}

static std::vector<std::string> split_ucis(const char* line){
    std::vector<std::string> out; if (!line||!*line) return out; std::string s(line);
    size_t i=0; while(i<s.size()){ while(i<s.size() && (s[i]==',' || s[i]==' ')) ++i; if(i>=s.size()) break; size_t j=i; while(j<s.size() && s[j]!=',' && s[j]!=' ') ++j; out.push_back(s.substr(i,j-i)); i=j; }
    return out;
}

int main(int argc, char** argv){
    const char* fen = (argc>1 && std::strlen(argv[1])>0) ? argv[1] : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const char* uciSeq = (argc>2 && std::strlen(argv[2])>0) ? argv[2] : ""; // e.g., "h1h2" or "h1h2,a7a6"
    // Focus options: only castling/king terms (center/dev magnets off) and ensure castling moves are generated
    const char* opts = "{\"searchDepth\":1,\"includeCastling\":true,\"castleSafety\":true,\"terms\":{\"material\":false,\"tempo\":false},\"centerPiecePlacementReward\":0,\"endGameKingCenterMagnet\":0,\"developmentIncentive\":0,\"developmentOpponentWeight\":0,\"castleKingSideReward\":60,\"castleQueenSideReward\":60,\"kingNonCastleMovePenalty\":100}";

    std::cout << "Start FEN: " << fen << "\n";
    std::cout << "Start rights: " << castling_rights(fen) << "\n";

    std::string cur = fen;
    auto ucis = split_ucis(uciSeq);
    for (auto &uci : ucis){
        const char* next = apply_move_if_legal(cur.c_str(), uci.c_str(), opts);
        if (!next || std::string(next).find("error")!=std::string::npos){
            std::cerr << "Illegal move in sequence: " << uci << "\n";
            return 1;
        }
        cur = next;
        std::cout << "After " << uci << ": " << cur << " (rights=" << castling_rights(cur.c_str()) << ")\n";
    }

    // Ask engine to score one ply candidates from current position with castling costs
    const char* bestJson = choose_best_move(cur.c_str(), opts);
    if (!bestJson){ std::cerr << "choose_best_move returned null\n"; return 1; }
    std::cout << bestJson << "\n";
    return 0;
}
