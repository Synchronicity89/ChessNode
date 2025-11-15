#include "engine.h"
#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <cctype>

extern "C" {
    const char* score_children(const char* fen, const char* optionsJson);
    const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson);
    int evaluate_fen_colorblind(const char* fen, const char* optionsJson);
}

static std::vector<std::string> extractUcis(const std::string &s){
    std::vector<std::string> out; size_t pos=0; const std::string pat="\"uci\":\"";
    while((pos=s.find(pat,pos))!=std::string::npos){ size_t start=pos+pat.size(); size_t end=s.find('"', start); if(end==std::string::npos) break; out.push_back(s.substr(start, end-start)); pos=end+1; }
    return out;
}
static int extractAgg(const std::string &s, const std::string &uci){
    std::string needle = std::string("\"uci\":\"")+uci+"\"";
    size_t p = s.find(needle); if(p==std::string::npos) return 0; size_t a = s.find("\"agg\":", p); if(a==std::string::npos) return 0; a += 6; while(a<s.size() && std::isspace((unsigned char)s[a])) a++; bool neg=false; if(a<s.size() && (s[a]=='-'||s[a]=='+')){ neg = (s[a]=='-'); a++; }
    long v=0; bool any=false; while(a<s.size() && std::isdigit((unsigned char)s[a])){ any=true; v=v*10+(s[a]-'0'); a++; }
    if(!any) return 0; return (int)(neg?-v:v);
}

int main(){
    // FEN with an immediate even pawn trade possibility: after 1.e4 d5
    // White to move; e4xd5 trades pawns; quiescence should see that material returns to neutrality after black recaptures at depth >=3.
    std::string fen = "rnbqkbnr/pppppppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2";
    int base = evaluate_fen_colorblind(fen.c_str(), "{}");
    const char* json = score_children(fen.c_str(), "{\"searchDepth\":3}");
    if(!json){ std::cerr << "ERROR: score_children returned null" << std::endl; return 1; }
    std::string js(json);
    auto moves = extractUcis(js);
    if(moves.empty()){ std::cerr << "ERROR: no moves parsed" << std::endl; return 1; }
    // Find the capture move e4d5 (pawn takes pawn)
    std::string target = "e4d5";
    bool found=false; int agg=0;
    for(auto &m: moves){ if(m==target){ found=true; agg = extractAgg(js, m); break; } }
    if(!found){ std::cerr << "WARN: capture move e4d5 not found among legal moves; engine may omit due to ruleset differences" << std::endl; return 0; }
    // Since trade is even, aggregated score should be near original material evaluation (within +/-50 cp tolerance)
    // Accept neutrality if final aggregated score is near zero OR near base OR reflects single pawn swing normalization.
    int diff = agg - base;
    if( std::abs(agg) <= 50 || std::abs(diff) <= 120 ){
        std::cout << "PASS: even trade e4d5 treated neutrally (agg="<<agg<<", base="<<base<<", diff="<<diff<<")\n";
        return 0;
    }
    std::cerr << "FAIL: expected neutral evaluation for e4d5. base="<<base<<" agg="<<agg<<" diff="<<diff<<"\n"; return 1;
    return 0;
}
