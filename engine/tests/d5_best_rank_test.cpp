#include "engine.h"
#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
#include <cstdlib>
#include <cstring>

extern "C" const char* score_children(const char* fen, const char* optionsJson);

static std::vector<std::pair<std::string,int>> parse_children_scores(const char* json){
    std::vector<std::pair<std::string,int>> out; if (!json) return out; std::string s(json);
    const std::string head = "\"children\":[";
    auto hp = s.find(head); if (hp == std::string::npos) return out; size_t i = hp + head.size();
    while (i < s.size()){
        auto up = s.find("\"uci\":\"", i); if (up == std::string::npos) break; size_t us = up + 8; size_t ue = s.find('"', us); if (ue == std::string::npos) break; std::string uci = s.substr(us, ue-us);
        auto ap = s.find("\"agg\":", ue); if (ap == std::string::npos) break; size_t as = ap + 7; int sign = 1; if (s[as]=='-'){ sign=-1; as++; }
        int agg = std::atoi(s.c_str()+as); agg *= sign;
        out.emplace_back(uci, agg);
        i = as + 1;
    }
    return out;
}

int main(){
    // FEN after 1.e4 Nc6 2.d4; black to move
    const char* fen = "r1bqkbnr/pppppppp/2n5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2";
    // Match UI defaults
    const char* opts = "{\"searchDepth\":2,\"terms\":{\"material\":true,\"tempo\":false},\"centerPiecePlacementReward\":50,\"endGameKingCenterMagnet\":15,\"developmentIncentive\":10,\"rankAttackFactor\":1.1,\"notJustEmptySquaresThreatReward\":true,\"castleKingSideReward\":60,\"castleQueenSideReward\":60,\"kingNonCastleMovePenalty\":100}";
    const char* json = score_children(fen, opts);
    if (!json || std::strlen(json)==0){ std::cerr << "FAIL: score_children returned null/empty" << std::endl; return 1; }
    auto scores = parse_children_scores(json);
    if (scores.empty()){ std::cerr << "FAIL: could not parse any children from score_children output" << std::endl; return 1; }

    // Lower white-centric cp is better for black
    std::sort(scores.begin(), scores.end(), [](auto &a, auto &b){ return a.second < b.second; });

    auto ends_with = [](const std::string &s, const std::string &suf){
        if (s.size() < suf.size()) return false; return std::equal(suf.rbegin(), suf.rend(), s.rbegin());
    };
    int idx_d5 = -1;
    for (size_t i=0;i<scores.size();++i){ if (ends_with(scores[i].first, "d5")) { idx_d5 = (int)i; break; } }

    if (idx_d5 < 0){
        std::cerr << "FAIL: could not find a move ending in d5 among children" << std::endl;
        std::cerr << "Children UCIs:" << std::endl;
        for (auto &p : scores) std::cerr << "  " << p.first << " agg=" << p.second << std::endl;
        return 1;
    }

    bool ok_best = (idx_d5 < 3);
    if (!ok_best){
        std::cerr << "FAIL: d5-ranking expectation not met" << std::endl;
        std::cerr << "  index(d5)=" << idx_d5 << " (expected < 3)" << std::endl;
        std::cerr << "  (lower index = better for black)" << std::endl;
        return 1;
    }

    std::cout << "OK d5-ranking expectation satisfied" << std::endl;
    return 0;
}
