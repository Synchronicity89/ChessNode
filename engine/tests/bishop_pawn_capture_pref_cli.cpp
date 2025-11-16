#include "engine.h"
#include <iostream>
#include <string>
#include <vector>
#include <cctype>

extern "C" {
    const char* score_children(const char* fen, const char* optionsJson);
    const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson);
    const char* list_legal_moves(const char* fen, const char* fromSqOrNull, const char* optionsJson);
}

static std::vector<std::string> extract_ucis(const std::string &s){
    std::vector<std::string> out; size_t pos=0; const std::string pat = "\"uci\":\"";
    while((pos = s.find(pat, pos)) != std::string::npos){ size_t st = pos + pat.size(); size_t en = s.find('"', st); if(en==std::string::npos) break; out.push_back(s.substr(st, en-st)); pos = en + 1; }
    return out;
}
static bool extract_int_after(const std::string &s, size_t from, const std::string &key, int &out){
    size_t p = s.find(key, from); if(p==std::string::npos) return false; size_t q = p + key.size(); bool neg=false; if(q<s.size() && (s[q]=='-'||s[q]=='+')){ neg = (s[q]=='-'); ++q; }
    long v=0; bool any=false; while(q<s.size() && std::isdigit((unsigned char)s[q])){ any=true; v = v*10 + (s[q]-'0'); ++q; }
    if(!any) return false; out = (int)(neg? -v : v); return true;
}
static bool extract_child_vals(const std::string &json, const std::string &uci, int &agg, int &imm){
    size_t pos = json.find("\"uci\":\"" + uci + "\""); if(pos==std::string::npos) return false;
    return extract_int_after(json, pos, "\"agg\":", agg) && extract_int_after(json, pos, "\"imm\":", imm);
}

int main(){
    const std::string fen = "r1bqkb1r/ppppp1pp/B4p2/8/3PP1n1/2N2N2/PPP2PPP/R1BQK2R b - - 0 1";
    const std::string opts = "{\"searchDepth\":2}";
    const char* j = score_children(fen.c_str(), opts.c_str());
    if(!j){ std::cerr << "score_children returned null" << std::endl; return 1; }
    std::string json(j);

    // Ensure both moves exist from movegen
    const char* mjs = list_legal_moves(fen.c_str(), nullptr, "{\"includeCastling\":true,\"castleSafety\":true}");
    if(!mjs){ std::cerr << "list_legal_moves returned null" << std::endl; return 1; }
    auto ms = extract_ucis(std::string(mjs));
    bool has_b7a6 = false, has_e7e6 = false;
    for(const auto &u : ms){ if(u=="b7a6") has_b7a6 = true; if(u=="e7e6") has_e7e6 = true; }
    if(!has_b7a6){ std::cerr << "Move b7a6 not found in legal moves" << std::endl; return 1; }
    if(!has_e7e6){ std::cerr << "Move e7e6 not found in legal moves" << std::endl; return 1; }

    int agg_b7a6=0, imm_b7a6=0, agg_e7e6=0, imm_e7e6=0;
    if(!extract_child_vals(json, "b7a6", agg_b7a6, imm_b7a6)){
        std::cerr << "Failed to parse candidate for b7a6" << std::endl; std::cerr << json << std::endl; return 1; }
    if(!extract_child_vals(json, "e7e6", agg_e7e6, imm_e7e6)){
        std::cerr << "Failed to parse candidate for e7e6" << std::endl; std::cerr << json << std::endl; return 1; }

    const char* nf_b7a6 = apply_move_if_legal(fen.c_str(), "b7a6", "{\"includeCastling\":true,\"castleSafety\":true}");
    const char* nf_e7e6 = apply_move_if_legal(fen.c_str(), "e7e6", "{\"includeCastling\":true,\"castleSafety\":true}");

    std::cout << "Parent: " << fen << "\nDepth: 2\n\n";
    std::cout << "Child e7e6: best=" << agg_e7e6 << " cp (imm=" << imm_e7e6 << " cp)\n  Next: " << (nf_e7e6?nf_e7e6:"<err>") << "\n\n";
    std::cout << "Child b7a6: best=" << agg_b7a6 << " cp (imm=" << imm_b7a6 << " cp)\n  Next: " << (nf_b7a6?nf_b7a6:"<err>") << "\n\n";

    // Expectation: in material-sum-only mode, capturing bishop (b7a6) should not rank below a quiet e7e6.
    if(agg_b7a6 < agg_e7e6){
        std::cerr << "FAIL: capture b7a6 ranks below e7e6 at depth 2 (" << agg_b7a6 << " < " << agg_e7e6 << ")\n";
        return 1;
    }
    std::cout << "PASS: b7a6 not worse than e7e6 at depth 2\n";
    return 0;
}
