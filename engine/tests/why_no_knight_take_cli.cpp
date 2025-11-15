// Diagnostic: depth-4 candidate analysis for the given FEN.
// FEN: r1b1kbnr/p1Bp3p/1pn5/5Pp1/2BQ4/2N5/PPP2PPP/R3K2R b KQkq - 0 10
// Goal: Show why engine didn't play c6d4 (Nxd4 taking the white queen).
#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
#include <sstream>

extern "C" {
    const char* choose_best_move(const char* fen, const char* optionsJson);
    const char* score_children(const char* fen, const char* optionsJson);
}

// Very small/lenient JSON helpers for expected engine JSON shape
static std::string find_string_field(const std::string &src, const std::string &key){
    const std::string pat = '"' + key + '"' + std::string(":\"");
    auto p = src.find(pat); if (p==std::string::npos) return {};
    size_t s = p + pat.size(); size_t e = src.find('"', s); if (e==std::string::npos) return {};
    return src.substr(s, e-s);
}
static std::string parse_best_uci(const char* json){
    if(!json) return {};
    std::string s(json);
    return find_string_field(s, "uci");
}

struct Child { std::string uci; int agg=0; int imm=0; int nodes=0; int plies=0; std::string pv; };

static int extract_int_after(const std::string &s, size_t start){
    int sign=1; size_t i=start; if (i<s.size() && s[i]=='-'){ sign=-1; i++; }
    long v=0; while (i<s.size() && s[i]>='0' && s[i]<='9'){ v = v*10 + (s[i]-'0'); i++; }
    return int(sign * v);
}

int main(){
    const std::string fen = "r1b1kbnr/p1Bp3p/1pn5/5Pp1/2BQ4/2N5/PPP2PPP/R3K2R b KQkq - 0 10";
    const int depth = 4;
    std::ostringstream opts; opts << "{\"searchDepth\":" << depth << "}";

    const char* jbest = choose_best_move(fen.c_str(), opts.str().c_str());
    if(!jbest){ std::cerr << "choose_best_move returned null" << std::endl; return 1; }
    const std::string bestUci = parse_best_uci(jbest);

    const char* j = score_children(fen.c_str(), opts.str().c_str());
    if(!j){ std::cerr << "score_children returned null" << std::endl; return 1; }
    std::string s(j);

    // Parse children in a very lenient way: look for {"uci":"...","agg":...,"imm":...}
    std::vector<Child> kids; kids.reserve(64);
    size_t pos = 0; while (true){
        const std::string key = "\"uci\":\"";
        size_t p = s.find(key, pos); if (p==std::string::npos) break;
        size_t us = p + key.size(); size_t ue = s.find('"', us); if (ue==std::string::npos) break;
        Child ch; ch.uci = s.substr(us, ue-us);
        // agg
        size_t a = s.find("\"agg\":", ue); if (a!=std::string::npos) ch.agg = extract_int_after(s, a+7);
        // imm
        size_t m = s.find("\"imm\":", ue); if (m!=std::string::npos) ch.imm = extract_int_after(s, m+7);
        // nodes
        size_t n = s.find("\"nodes\":", ue); if (n!=std::string::npos) ch.nodes = extract_int_after(s, n+9);
        // actualPlies
        size_t ap = s.find("\"actualPlies\":", ue); if (ap!=std::string::npos) ch.plies = extract_int_after(s, ap+15);
        // pv (optional first token)
        size_t pvk = s.find("\"pv\":[", ue);
        if (pvk!=std::string::npos){
            size_t pvEnd = s.find(']', pvk);
            if (pvEnd!=std::string::npos){ ch.pv = s.substr(pvk, pvEnd-pvk+1); }
        }
        kids.push_back(ch);
        pos = ue + 1;
    }

    std::sort(kids.begin(), kids.end(), [](const Child&a, const Child&b){ return a.agg > b.agg; });

    std::cout << "FEN: " << fen << "\n";
    std::cout << "Depth: " << depth << "\n";
    std::cout << "Engine best: " << bestUci << "\n";
    std::cout << "\nCandidates (sorted by agg cp):\n";
    for (const auto &c : kids){
        std::cout << "  " << c.uci << "  agg=" << c.agg << " imm=" << c.imm;
        if (c.nodes>0) std::cout << " nodes=" << c.nodes;
        if (c.plies>0) std::cout << " plies=" << c.plies;
        std::cout << '\n';
    }

    // Spotlight c6d4, if present
    auto it = std::find_if(kids.begin(), kids.end(), [](const Child &c){ return c.uci == "c6d4"; });
    if (it != kids.end()){
        std::cout << "\nFocus: c6d4 (Nxd4)  agg=" << it->agg << " imm=" << it->imm << "\n";
    } else {
        std::cout << "\nFocus: c6d4 (Nxd4) not in legal children at depth root.\n";
    }

    return 0;
}
