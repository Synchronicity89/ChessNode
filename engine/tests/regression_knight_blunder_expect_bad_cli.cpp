#include "engine.h"
#include <iostream>
#include <string>
#include <cstdlib>
#include <cstring>

extern "C" const char* choose_best_move(const char* fen, const char* optionsJson);

static std::string parse_best_uci(const char* json){
    if (!json) return std::string();
    std::string s(json);
    const std::string key = "\"best\":{\"uci\":\"";
    auto p = s.find(key);
    if (p == std::string::npos) return std::string();
    size_t start = p + key.size();
    size_t end = s.find('"', start);
    if (end == std::string::npos) return std::string();
    return s.substr(start, end - start);
}

int main(){
    // This program now asserts the engine does NOT choose the knight blunder (c6e5) at depth 2.
    // Purpose: prevent regression to the previously observed blunder while keeping a lightweight CLI test.
    std::srand(1);
    const char* fen_after_d2d4 = "r1bqkbnr/pppppppp/2n5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2";
    const char* opts = "{\"searchDepth\":2,\"terms\":{\"material\":true,\"tempo\":false},\"centerPiecePlacementReward\":50,\"endGameKingCenterMagnet\":15}";

    const char* bestJson = choose_best_move(fen_after_d2d4, opts);
    if (!bestJson){
        std::cerr << "FAIL: choose_best_move returned null" << std::endl; return 1;
    }
    std::string uci = parse_best_uci(bestJson);
    if (uci.empty()){
        std::cerr << "FAIL: best.uci missing in output: " << bestJson << std::endl; return 1;
    }
    if (uci == "c6e5"){
        std::cerr << "FAIL: engine chose the known blunder c6e5; expected any other move" << std::endl;
        std::cerr << bestJson << std::endl;
        return 1;
    }
    std::cout << "OK (engine avoided blunder c6e5; got " << uci << ")" << std::endl;
    return 0;
}
