// Analyze evaluation at the critical FEN where White must not abandon h1.
// Uses searchDepth=6 and prints candidate move scores, then verifies that
// moving away (e.g., g1f1) allows Black's immediate promotion and shows the
// material swing detected.

#include <iostream>
#include <string>
#include <sstream>
#include <vector>
#include <cctype>

extern "C" {
    const char* choose_best_move(const char* fen, const char* optionsJson);
    const char* score_children(const char* fen, const char* optionsJson);
    const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson);
}

static std::string get_field(const std::string &json, const std::string &key){
    auto p = json.find(key);
    if(p==std::string::npos) return {};
    p = json.find('"', p + key.size());
    if(p==std::string::npos) return {};
    auto e = json.find('"', p+1);
    if(e==std::string::npos) return {};
    return json.substr(p+1, e-(p+1));
}

static std::string parse_best_uci(const std::string &json){
    const std::string key = "\"best\":{\"uci\":\"";
    auto p = json.find(key);
    if(p==std::string::npos) return {};
    size_t s = p + key.size();
    size_t e = json.find('"', s);
    if(e==std::string::npos) return {};
    return json.substr(s, e-s);
}

struct Cand { std::string uci; int agg=0; int imm=0; };

static std::vector<Cand> parse_candidates(const std::string &json){
    std::vector<Cand> v; size_t pos = 0; const std::string uciKey = "\"uci\":\"";
    while((pos = json.find(uciKey, pos)) != std::string::npos){
        size_t us = pos + uciKey.size(); size_t ue = json.find('"', us); if(ue==std::string::npos) break;
        std::string u = json.substr(us, ue-us);
        // find agg after this
        size_t ap = json.find("\"agg\":", ue);
        if(ap==std::string::npos) break;
        ap += 7; // skip "agg":
        bool neg=false; int agg=0; size_t i=ap; if(i<json.size() && (json[i]=='-'||json[i]=='+')){ neg=(json[i]=='-'); ++i; }
        while(i<json.size() && std::isdigit((unsigned char)json[i])){ agg = agg*10 + (json[i]-'0'); ++i; }
        if(neg) agg = -agg;
        // imm
        size_t ip = json.find("\"imm\":", i);
        int imm=0;
        if(ip!=std::string::npos){ ip += 7; bool negi=false; size_t j=ip; if(j<json.size() && (json[j]=='-'||json[j]=='+')){ negi=(json[j]=='-'); ++j; }
            while(j<json.size() && std::isdigit((unsigned char)json[j])){ imm = imm*10 + (json[j]-'0'); ++j; if(negi) imm = -imm; }
        }
        v.push_back(Cand{u, agg, imm});
        pos = ue+1;
    }
    return v;
}

static std::string apply(const std::string &fen, const std::string &uci){
    const char* next = apply_move_if_legal(fen.c_str(), uci.c_str(), nullptr);
    if(!next) return {};
    std::string out(next);
    if(!out.empty() && out[0]=='{' && out.find("error")!=std::string::npos) return {};
    return out;
}

int main(){
    const std::string decisionFen = "8/7k/7P/7P/7p/8/7p/6K1 w - - 0 4";
    const int depth = 6;
    std::ostringstream opts; opts << "{\"searchDepth\":" << depth << "}";

    std::cout << "Decision FEN: " << decisionFen << "\n";
    std::cout << "Depth: " << depth << "\n";

    // Score children to see candidate agg values
    const char* sc = score_children(decisionFen.c_str(), opts.str().c_str());
    if(!sc){ std::cerr << "score_children returned null" << std::endl; return 1; }
    std::string scJson(sc);
    auto cands = parse_candidates(scJson);
    if(cands.empty()){ std::cerr << "No candidates parsed" << std::endl; return 1; }
    std::cout << "Candidates (uci, agg, imm):\n";
    for(const auto &c: cands){ std::cout << "  " << c.uci << ", agg=" << c.agg << ", imm=" << c.imm << "\n"; }

    // Probe two key moves if present: g1h1 (block) and g1f1 (abandon)
    auto find = [&](const char* u){ for(const auto &c: cands) if(c.uci==u) return true; return false; };
    bool hasBlock = find("g1h1");
    bool hasAbandon = find("g1f1");
    std::cout << "\nHas g1h1: " << (hasBlock?"yes":"no") << "; Has g1f1: " << (hasAbandon?"yes":"no") << "\n";

    // If abandoning move exists, apply it and show black's best reply
    if(hasAbandon){
        std::string next = apply(decisionFen, "g1f1");
        if(!next.empty()){
            std::ostringstream o2; o2 << "{\"searchDepth\":1}"; // shallow, just to get black reply
            const char* bres = choose_best_move(next.c_str(), o2.str().c_str());
            std::string bjson = bres? std::string(bres): std::string();
            // parse best uci
            std::string bmv = parse_best_uci(bjson);
            std::cout << "\nAfter g1f1, black best: " << (bmv.empty()?"<none>":bmv) << "\n";
            if(bmv.size()==5 && (bmv[4]=='q'||bmv[4]=='r'||bmv[4]=='b'||bmv[4]=='n')){
                std::cout << "Black has immediate promotion available after g1f1." << std::endl;
            }
        }
    }

    return 0;
}
