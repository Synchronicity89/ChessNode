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
    // crude scan: find each {"uci":"...","agg":N ...} inside children array
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
    // FEN from the scenario after 1.e4 Nc6 2.d4 (black to move)
    const char* fen = "r1bqkbnr/pppppppp/2n5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2";
    // Use the UI-aligned defaults
    const char* opts = "{\"searchDepth\":2,\"terms\":{\"material\":true,\"tempo\":false},\"centerPiecePlacementReward\":50,\"endGameKingCenterMagnet\":15,\"developmentIncentive\":10,\"rankAttackFactor\":1.1,\"notJustEmptySquaresThreatReward\":true,\"castleKingSideReward\":60,\"castleQueenSideReward\":60,\"kingNonCastleMovePenalty\":100}";
    const char* json = score_children(fen, opts);
    if (!json || std::strlen(json)==0){ std::cerr << "FAIL: score_children returned null/empty" << std::endl; return 1; }
    auto scores = parse_children_scores(json);
    if (scores.empty()){ std::cerr << "FAIL: could not parse any children from score_children output" << std::endl; return 1; }

    // For black-to-move, lower white-centric cp is better for black.
    std::sort(scores.begin(), scores.end(), [](auto &a, auto &b){ return a.second < b.second; });

    auto ends_with = [](const std::string &s, const std::string &suf){
        if (s.size() < suf.size()) return false; return std::equal(suf.rbegin(), suf.rend(), s.rbegin());
    };
    auto find_index_exact = [&](const std::string &label){
        for (size_t i=0;i<scores.size();++i){ if (scores[i].first == label) return (int)i; }
        return -1;
    };
    auto find_index_by_dest = [&](const std::string &dest){
        for (size_t i=0;i<scores.size();++i){ if (ends_with(scores[i].first, dest)) return (int)i; }
        return -1;
    };

    // The engine's compact labels in this test may omit the from-file (e.g., "7d5", "6b8").
    // Match by destination squares to align with returned data. Prefer "6b8" (knight undevelopment) if present.
    int idx_d5 = find_index_by_dest("d5");
    int idx_b8 = -1;
    int idx_knight_b8 = find_index_exact("6b8");
    if (idx_knight_b8 >= 0) idx_b8 = idx_knight_b8; else idx_b8 = find_index_by_dest("b8");

    if (idx_d5 < 0 || idx_b8 < 0){
        std::cerr << "FAIL: required moves not found among children" << std::endl;
        std::cerr << "Children UCIs:" << std::endl;
        for (auto &p : scores) std::cerr << "  " << p.first << " agg=" << p.second << std::endl;
        return 1;
    }

    int n = (int)scores.size();
    // Desired properties (expected to FAIL with current production behavior):
    // - d7d5 should be among the 3 best moves for black (lowest cp)
    // - c6b8 (undeveloping the knight) should be among the 5 worst moves for black (highest cp)
    bool ok_best = (idx_d5 < 3);
    bool ok_worst = (idx_b8 >= n - 5);
    if (!ok_best || !ok_worst){
        std::cerr << "FAIL: undevelopment ranking expectations not met" << std::endl;
        std::cerr << "  index(d5)=" << idx_d5 << " (expected < 3)" << std::endl;
        std::cerr << "  index(b8)=" << idx_b8 << " (expected >= " << (n-5) << ")" << std::endl;
        std::cerr << "  (lower index = better for black; higher index = worse)" << std::endl;
        return 1;
    }

    std::cout << "OK undevelopment ranking expectations satisfied" << std::endl;
    return 0;
}
