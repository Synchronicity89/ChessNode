#include <gtest/gtest.h>
#include "engine.h"
#include <string>
#include <cstring>
#include <cstdlib>

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

static bool json_contains(const char* json, const char* needle){
    if (!json || !needle) return false; std::string s(json); return s.find(needle) != std::string::npos;
}

// Position after: 1. e2e4 b8c6 2. d2d4 (Black to move)
static const char* FEN_AFTER_D2D4 = "r1bqkbnr/pppppppp/2n5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2";

// Mirror UI defaults for geometry terms; depth=2 to reproduce scenario.
static const char* OPTS_DEPTH2 = "{\"searchDepth\":2,\"terms\":{\"material\":true,\"tempo\":false},\"centerPiecePlacementReward\":50,\"endGameKingCenterMagnet\":15}";

TEST(Depth2Regression, AvoidsKnightEnPrise){
    std::srand(1); // deterministic tie-breaking if any
    const char* bestJson = choose_best_move(FEN_AFTER_D2D4, OPTS_DEPTH2);
    ASSERT_NE(bestJson, nullptr) << "choose_best_move returned null";
    ASSERT_FALSE(json_contains(bestJson, "error")) << bestJson;
    std::string uci = parse_best_uci(bestJson);
    ASSERT_FALSE(uci.empty()) << bestJson;
    // Desired behavior: do not play c6e5?? into d4xe5 at depth 2.
    // Note: This assertion may FAIL if the engine still blunders, which is intended for investigation.
    EXPECT_NE(uci, "c6e5") << bestJson;
}

TEST(Depth2Regression, ReplyCaptureExists){
    const char* after_knight = apply_move_if_legal(FEN_AFTER_D2D4, "c6e5", nullptr);
    ASSERT_NE(after_knight, nullptr) << "apply_move_if_legal returned null for c6e5";
    ASSERT_FALSE(json_contains(after_knight, "error")) << after_knight;
    const char* moves_after_knight = list_legal_moves(after_knight, nullptr, nullptr);
    ASSERT_NE(moves_after_knight, nullptr);
    EXPECT_TRUE(json_contains(moves_after_knight, "\"uci\":\"d4e5\"")) << moves_after_knight;
}

TEST(Depth2Regression, ScoreIsFiniteReasonable){
    const char* bestJson = choose_best_move(FEN_AFTER_D2D4, OPTS_DEPTH2);
    ASSERT_NE(bestJson, nullptr);
    std::string s(bestJson);
    auto p = s.find("\"score\":");
    ASSERT_NE(p, std::string::npos) << bestJson;
    // Parse double; crude but fine for guardrails
    double val = 0.0;
    try {
        val = std::stod(s.substr(p+8));
    } catch (...) {
        // stod fails if trailing JSON follows; be tolerant by scanning to comma
        size_t start = p+8; size_t end = s.find_first_of(",}", start);
        if (end == std::string::npos) end = s.size();
        val = std::atof(s.substr(start, end-start).c_str());
    }
    // Guardrail: avoid alpha-beta sentinel leaks like +/-1e300
    EXPECT_LT(std::abs(val), 1e6) << bestJson;
}
