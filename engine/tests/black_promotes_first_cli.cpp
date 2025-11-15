// Plays engine-vs-engine from a FEN at depth=10 and fails
// if black promotes before white. This approximates "engine allows
// opponent to promote first" as a regression check.
#include <iostream>
#include <string>
#include <sstream>
#include <cctype>

extern "C" {
    const char* choose_best_move(const char* fen, const char* optionsJson);
    const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson);
}

static std::string parse_best_uci(const char* json){
    if(!json) return std::string();
    std::string s(json);
    const std::string key = "\"best\":{\"uci\":\"";
    auto p = s.find(key);
    if(p==std::string::npos) return std::string();
    size_t start = p + key.size();
    size_t end = s.find('"', start);
    if(end==std::string::npos) return std::string();
    return s.substr(start, end-start);
}

static char side_to_move(const std::string &fen){
    // FEN format: <placement> <stm> ... ; find the first space and take next char
    auto sp = fen.find(' ');
    if(sp==std::string::npos || sp+1>=fen.size()) return 'w';
    return fen[sp+1];
}

static bool move_is_promotion(const std::string &uci){
    if(uci.size() < 5) return false;
    char p = (char)std::tolower((unsigned char)uci[4]);
    return (p=='q' || p=='r' || p=='b' || p=='n');
}

int main(){
    // Provided scenario
    std::string fen = "7k/7P/7P/7P/7p/7p/7p/7K w - - 0 4";
    const int searchDepth = 10;
    std::ostringstream opts; opts << "{\"searchDepth\":" << searchDepth << "}";

    bool whitePromoted=false, blackPromoted=false;
    int maxPlies = 200; // generous bound
    for(int ply=1; ply<=maxPlies; ++ply){
        char stm = side_to_move(fen);
        const char* res = choose_best_move(fen.c_str(), opts.str().c_str());
        if(!res){ std::cerr << "Engine returned null at ply "<<ply<<"\n"; return 1; }
        std::string best = parse_best_uci(res);
        if(best.empty()){ std::cerr << "No best move found at ply "<<ply<<"\n"; return 1; }
        if(move_is_promotion(best)){
            if(stm=='w') whitePromoted = true; else blackPromoted = true;
            std::cout << "Promotion detected: ply="<<ply<<" stm="<<(stm=='w'?"w":"b")<<" move="<<best<<"\n";
            break;
        }
        const char* next = apply_move_if_legal(fen.c_str(), best.c_str(), nullptr);
        if(!next){ std::cerr << "apply_move_if_legal returned null at ply "<<ply<<" move="<<best<<"\n"; return 1; }
        std::string nextFen(next);
        if(nextFen.size()>1 && nextFen[0]=='{' && nextFen.find("error")!=std::string::npos){
            std::cerr << "Illegal application at ply "<<ply<<" move="<<best<<"\n";
            return 1;
        }
        fen.swap(nextFen);
    }

    // Fail if black promotes before white
    if(blackPromoted && !whitePromoted){
        std::cerr << "Failure: black promoted before white from FEN.\n";
        std::cerr << "Start FEN: 7k/7P/7P/7P/7p/7p/7p/7K w - - 0 4\n";
        return 1;
    }
    std::cout << "Pass: white promotes first or no promotion occurred.\n";
    return 0;
}
