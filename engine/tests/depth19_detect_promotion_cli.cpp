// Depth-19 decision test on a critical FEN.
// Asserts the engine does not choose the known blunder (f1g1),
// which allows a fast opponent promotion sequence.
//
// FEN: 6k1/8/8/5pp1/5PpP/8/8/5K2 w - - 0 63
#include <iostream>
#include <string>
#include <sstream>
#include <cctype>

extern "C" {
    const char* choose_best_move(const char* fen, const char* optionsJson);
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

int main(){
    const std::string fen = "6k1/8/8/5pp1/5PpP/8/8/5K2 w - - 0 63";
    const int searchDepth = 19;
    std::ostringstream opts; opts << "{\"searchDepth\":" << searchDepth << "}";

    const char* res = choose_best_move(fen.c_str(), opts.str().c_str());
    if(!res){ std::cerr << "Engine returned null for choose_best_move" << std::endl; return 1; }
    std::string best = parse_best_uci(res);
    if(best.empty()){ std::cerr << "No best move parsed from engine output" << std::endl; return 1; }

    std::cout << "Depth " << searchDepth << " best move: " << best << "\n";

    if(best == "f1g1"){
        std::cerr << "Failure: Engine chose f1g1 at depth 19; expected to avoid the promotion blunder." << std::endl;
        return 1;
    }

    std::cout << "Pass: Engine avoided f1g1 at depth 19." << std::endl;
    return 0;
}
