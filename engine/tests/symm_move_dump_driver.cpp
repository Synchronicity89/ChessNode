// Symmetry move dump driver: lists legal moves for failing FENs and their flips
// Provides raw sets and set differences to isolate asymmetry in move generation.
// Usage:
//   symm_move_dump_driver.exe (optionally set REMOVE_CASTLING_RIGHTS=1)
// Output is JSON to stdout.

#include <iostream>
#include <vector>
#include <string>
#include <unordered_set>

extern "C" {
    const char* list_legal_moves(const char* fen, const char* fromSqOrNull, const char* optionsJson);
}

static std::vector<std::string> extractUcis(const std::string &s){
    std::vector<std::string> out; size_t pos=0; const std::string pat = "\"uci\":\"";
    while ((pos = s.find(pat, pos)) != std::string::npos) {
        size_t start = pos + pat.size(); size_t end = s.find('"', start); if (end==std::string::npos) break; out.push_back(s.substr(start, end-start)); pos = end+1;
    }
    return out;
}

struct Pair { std::string a; std::string b; };

int main(){
    bool strip = false; if(const char* rcr = std::getenv("REMOVE_CASTLING_RIGHTS")){ if(*rcr && rcr[0] != '0') strip = true; }
    auto stripCastling = [](const std::string &fen){
        // naive: replace castling rights field with '-'
        // FEN: board stm castling ep halfmove fullmove
        std::string s = fen; size_t p1=s.find(' '); if(p1==std::string::npos) return fen; size_t p2=s.find(' ', p1+1); if(p2==std::string::npos) return fen; size_t p3=s.find(' ', p2+1); if(p3==std::string::npos) return fen; // castling rights between p2+1 and p3-1
        return s.substr(0, p2+1) + "-" + s.substr(p3);
    };

    std::vector<Pair> pairs = {
        {"rnbq1rk1/pppp1ppp/5n2/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - - 8 8","1kr1qb1r/ppp1pppp/2n2n2/3p1b2/3P4/2N5/PPP1PPPP/1KR1QBNR b - - 8 8"},
        {"rnbqkbnr/pppppppp/8/4P3/3P4/8/PPP1PPPP/RNBQKBNR b KQkq e3 0 3","rnbkqbnr/pppp1ppp/8/4p3/3p4/8/PPPPPPPP/RNBKQBNR w KQkq d6 0 3"},
        {"r1bqkbnr/pppp1ppp/2n5/4P3/3P4/8/PPP2PPP/RNBQKBNR b KQkq d3 0 5","rnbkqbnr/ppp2ppp/8/4p3/3p4/5N2/PPP1PPPP/RNBKQB1R w KQkq e6 0 5"}
    };

    std::cout << "{\n  \"positions\": [\n";
    for(size_t i=0;i<pairs.size();++i){
        std::string fen = pairs[i].a; std::string flip = pairs[i].b;
        if(strip){ fen = stripCastling(fen); flip = stripCastling(flip); }
        const char* jsA = list_legal_moves(fen.c_str(), nullptr, "{}");
        const char* jsB = list_legal_moves(flip.c_str(), nullptr, "{}");
        std::vector<std::string> movesA = jsA? extractUcis(std::string(jsA)) : std::vector<std::string>{};
        std::vector<std::string> movesB = jsB? extractUcis(std::string(jsB)) : std::vector<std::string>{};
        std::unordered_set<std::string> setA(movesA.begin(), movesA.end());
        std::unordered_set<std::string> setB(movesB.begin(), movesB.end());
        std::vector<std::string> onlyA, onlyB;
        for(auto &m: movesA) if(!setB.count(m)) onlyA.push_back(m);
        for(auto &m: movesB) if(!setA.count(m)) onlyB.push_back(m);
        std::cout << "    {\n";
        std::cout << "      \"index\": " << (i+1) << ",\n";
        std::cout << "      \"fen\": \"" << fen << "\",\n";
        std::cout << "      \"flip\": \"" << flip << "\",\n";
        std::cout << "      \"countFen\": " << movesA.size() << ",\n";
        std::cout << "      \"countFlip\": " << movesB.size() << ",\n";
        std::cout << "      \"movesFen\": [";
        for(size_t k=0;k<movesA.size();++k){ if(k) std::cout << ","; std::cout << "\"" << movesA[k] << "\""; }
        std::cout << "],\n      \"movesFlip\": [";
        for(size_t k=0;k<movesB.size();++k){ if(k) std::cout << ","; std::cout << "\"" << movesB[k] << "\""; }
        std::cout << "],\n      \"onlyFen\": [";
        for(size_t k=0;k<onlyA.size();++k){ if(k) std::cout << ","; std::cout << "\"" << onlyA[k] << "\""; }
        std::cout << "],\n      \"onlyFlip\": [";
        for(size_t k=0;k<onlyB.size();++k){ if(k) std::cout << ","; std::cout << "\"" << onlyB[k] << "\""; }
        std::cout << "]\n    }" << (i+1<pairs.size()?",":"") << "\n";
    }
    std::cout << "  ]\n}\n";
    return 0;
}
