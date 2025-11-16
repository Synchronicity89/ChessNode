// CLI: explain_best_move_cli
// Proves that when compiled with ENGINE_EXPLAIN_MATH the engine
// returns both a preferred move and a material explanation.
//
// Usage (from engine build dir after configuring with ENGINE_EXPLAIN_MATH):
//   explain_best_move_cli
// It is hard-coded to depth 2 and the provided FEN.

#include <iostream>
#include <string>
#include <sstream>

extern "C" const char* choose_best_move(const char* fen, const char* optionsJson);

int main(){
    const char* FEN = "rn1qk1nr/ppp2ppp/8/3pp3/1b6/P1P4N/1P1PPPP1/RNBQKB1R w - - 0 1";
    const int depth = 2;
    std::string opts = std::string("{\"searchDepth\":") + std::to_string(depth) + "}";

    const char* js = choose_best_move(FEN, opts.c_str());
    if (!js){
        std::cerr << "error: choose_best_move returned null" << std::endl;
        return 1;
    }

    std::string s(js);

    // Very small JSON helpers to avoid dependencies but still be precise
    auto findObjectSection = [&](const std::string& objectKey)->std::pair<size_t,size_t>{
        std::string marker = "\"" + objectKey + "\""; // "best"
        size_t startKey = s.find(marker);
        if (startKey == std::string::npos) return {std::string::npos, std::string::npos};
        size_t brace = s.find('{', startKey);
        if (brace == std::string::npos) return {std::string::npos, std::string::npos};
        int depth = 0;
        size_t i = brace;
        for (; i < s.size(); ++i){
            if (s[i] == '{') depth++;
            else if (s[i] == '}'){
                depth--;
                if (depth == 0){
                    return {brace, i};
                }
            }
        }
        return {std::string::npos, std::string::npos};
    };

    auto findStringFieldInRange = [&](const std::string& key, size_t from, size_t to)->std::string{
        std::string pat = "\"" + key + "\""; // "key"
        size_t p = s.find(pat, from);
        if (p == std::string::npos || p >= to) return std::string();
        p = s.find('"', p + pat.size()); // first quote of value
        if (p == std::string::npos || p >= to) return std::string();
        ++p; // start of value
        std::string out;
        bool escape = false;
        for (; p < to; ++p){
            char c = s[p];
            if (escape){
                switch(c){
                    case 'n': out.push_back('\n'); break;
                    case 't': out.push_back('\t'); break;
                    case '\\': out.push_back('\\'); break;
                    case '"': out.push_back('"'); break;
                    default: out.push_back(c); break;
                }
                escape = false;
            } else {
                if (c == '\\'){
                    escape = true;
                } else if (c == '"'){
                    break; // end of string
                } else {
                    out.push_back(c);
                }
            }
        }
        return out;
    };

    // best.uci should come from the "best" object, not the candidates list
    auto bestRange = findObjectSection("best");
    std::string bestUci;
    if (bestRange.first != std::string::npos){
        bestUci = findStringFieldInRange("uci", bestRange.first, bestRange.second);
    }

    // explain.math is a top-level field; search in full string
    std::string math = findStringFieldInRange("math", 0, s.size());

    std::cout << "FEN        : " << FEN << "\n";
    std::cout << "Depth      : " << depth << "\n";
    std::cout << "Raw JSON   : " << s << "\n";
    std::cout << "Preferred  : " << (bestUci.empty() ? "(missing)" : bestUci) << "\n";
    std::cout << "Explanation:\n";
    if (math.empty()){
        std::cout << "(missing explanation: ensure ENGINE_EXPLAIN_MATH is defined)\n";
        return 2; // indicate that macro/instrumentation was not active
    }

    // math is already a multi-line human-readable string; print as-is
    std::cout << math << "\n";
    return 0;
}
