#include "engine.h"
#include <iostream>
#include <string>
#include <cstdlib>
#include <cstring>

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
static bool json_contains(const char* json, const char* needle){ if (!json||!needle) return false; return std::string(json).find(needle) != std::string::npos; }

extern "C" const char* choose_best_move(const char* fen, const char* optionsJson);
extern "C" const char* list_legal_moves(const char* fen, const char* fromSqOrNull, const char* optionsJson);
extern "C" const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson);

int main(){
    int failures = 0;
    std::srand(1);
    const char* fen_after_d2d4 = "r1bqkbnr/pppppppp/2n5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2";
    const char* opts = "{\"searchDepth\":2,\"terms\":{\"material\":true,\"tempo\":false},\"centerPiecePlacementReward\":50,\"endGameKingCenterMagnet\":15}";

    const char* bestJson = choose_best_move(fen_after_d2d4, opts);
    if (!bestJson || json_contains(bestJson, "error")){
        std::cerr << "FAIL: choose_best_move returned error/null for depth-2 scenario\n";
        if (bestJson) std::cerr << bestJson << "\n";
        failures++;
    } else {
        std::string uci = parse_best_uci(bestJson);
        if (uci.empty()){
            std::cerr << "FAIL: best.uci missing from choose_best_move output\n";
            failures++;
        } else if (uci == "c6e5"){
            std::cerr << "FAIL: depth-2 search chose knight into pawn capture (c6e5)\n";
            std::cerr << bestJson << "\n";
            failures++;
        }
        // score guardrail
        auto p = std::string(bestJson).find("\"score\":");
        if (p != std::string::npos){
            double val = 0.0; size_t start = p+8; size_t end = std::string(bestJson).find_first_of(",}", start); if (end==std::string::npos) end = std::strlen(bestJson);
            val = std::atof(std::string(bestJson).substr(start, end-start).c_str());
            if (!(std::abs(val) < 1e6)){
                std::cerr << "FAIL: score looks non-finite/sentinel: " << val << "\n" << bestJson << "\n";
                failures++;
            }
        }
    }

    const char* after_knight = apply_move_if_legal(fen_after_d2d4, "c6e5", nullptr);
    if (!after_knight || json_contains(after_knight, "error")){
        std::cerr << "FAIL: applying c6e5 should be legal in this position\n";
        failures++;
    } else {
        const char* moves_after_knight = list_legal_moves(after_knight, nullptr, nullptr);
        if (!moves_after_knight || !json_contains(moves_after_knight, "\"uci\":\"d4e5\"")){
            std::cerr << "FAIL: expected white reply d4e5 to be legal after c6e5\n";
            failures++;
        }
    }

    if (failures){
        return 1;
    }
    std::cout << "OK\n";
    return 0;
}
