#include "engine.h"
#include <string>
#include <vector>
#include <iostream>
#include <sstream>
#include <algorithm>
#include <cctype>

extern "C" {
    const char* list_legal_moves(const char*, const char*, const char*);
    const char* apply_move_if_legal(const char*, const char*, const char*);
    const char* choose_best_move(const char*, const char*);
    const char* score_children(const char*, const char*);
}

static std::string initial_fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

static char sideToMove(const std::string &fen){ auto p = fen.find(' '); if(p==std::string::npos) return 'w'; return fen[p+1]; }

static std::string makeOptionsJson(int depth){ std::ostringstream o; o << "{\"searchDepth\":" << depth << "}"; return o.str(); }

static std::string extractBetween(const std::string &s, const std::string &pat, char end='"', size_t startPos=0){
    size_t p = s.find(pat, startPos); if (p==std::string::npos) return std::string();
    size_t q = p + pat.size(); size_t r = s.find(end, q); if (r==std::string::npos) return std::string();
    return s.substr(q, r-q);
}

static bool extractIntAfter(const std::string &s, const std::string &pat, int &out, size_t startPos=0){
    size_t p = s.find(pat, startPos); if (p==std::string::npos) return false; size_t q = p + pat.size();
    // skip spaces
    while (q < s.size() && std::isspace(static_cast<unsigned char>(s[q]))) ++q;
    // optional sign
    bool neg=false; if (q<s.size() && (s[q]=='-'||s[q]=='+')){ neg = s[q]=='-'; ++q; }
    long val=0; bool any=false; while (q<s.size() && std::isdigit(static_cast<unsigned char>(s[q]))){ any=true; val = val*10 + (s[q]-'0'); ++q; }
    if (!any) return false; out = static_cast<int>(neg? -val : val); return true;
}

struct ChildScore { std::string uci; int agg=0; };

static std::vector<ChildScore> parseChildrenAgg(const std::string &json){
    std::vector<ChildScore> out;
    size_t pos = 0;
    while (true){
        size_t p = json.find("\"uci\":\"", pos);
        if (p==std::string::npos) break;
        std::string uci = extractBetween(json, "\"uci\":\"", '"', p);
        size_t afterUci = json.find('"', p + 7) + 1; // crude advance
        int agg=0; extractIntAfter(json, "\"agg\":", agg, afterUci);
        out.push_back({uci, agg});
        pos = afterUci;
    }
    return out;
}

struct Candidate { std::string fen; std::string chosen; std::string best; int regret=0; int bestVal=0; int chosenVal=0; int low=0; int high=0; };

int main(int argc, char** argv){
    std::string fen = initial_fen;
    int steps = 80; int maxCandidates = 10; int low = 2; int high = 5; int minRegret = 80; bool verbose=false;
    // simple args: --low N --high N --steps N --minRegret N --max N --fen "..." --verbose
    for (int i=1;i<argc;i++){
        std::string a(argv[i]);
        auto nextInt = [&](int &dst){ if (i+1<argc){ dst = std::atoi(argv[++i]); } };
        if (a=="--low") nextInt(low);
        else if (a=="--high") nextInt(high);
        else if (a=="--steps") nextInt(steps);
        else if (a=="--minRegret") nextInt(minRegret);
        else if (a=="--max"||a=="--maxCandidates") nextInt(maxCandidates);
        else if (a=="--fen" && i+1<argc){ fen = argv[++i]; }
        else if (a=="--verbose") verbose=true;
    }
    std::vector<Candidate> bad;
    for (int t=0; t<steps && (int)bad.size()<maxCandidates; ++t){
        // shallow pick
        std::string optLow = makeOptionsJson(low);
        const char* res = choose_best_move(fen.c_str(), optLow.c_str());
        if (!res){ std::cerr << "choose_best_move failed at step "<<t<<"\n"; break; }
        std::string jres(res);
        std::string chosen = extractBetween(jres, "\"uci\":\"", '"');
        if (chosen.empty()) break;

        // deep children
        std::string optHigh = makeOptionsJson(high);
        const char* ch = score_children(fen.c_str(), optHigh.c_str());
        if (!ch){ std::cerr << "score_children failed at step "<<t<<"\n"; break; }
        std::string jch(ch);
        // parse children agg
        auto children = parseChildrenAgg(jch);
        if (children.empty()) break;
        int engineSide = (sideToMove(fen)=='w') ? +1 : -1; // scores are white-centric

        // find best for engine
        int bestIdx = -1; int bestEngVal = -1000000000; // engine-centric
        for (size_t i=0;i<children.size();++i){ int engVal = engineSide * children[i].agg; if (bestIdx<0 || engVal > bestEngVal){ bestIdx = (int)i; bestEngVal = engVal; } }

        // find chosen in deep list
        int chosenIdx = -1; for (size_t i=0;i<children.size();++i){ if (children[i].uci == chosen){ chosenIdx = (int)i; break; } }
        if (chosenIdx<0){ // fallback: compare the deep best only
            if (verbose) std::cerr << "Warning: chosen move not present in deep children at step "<<t<<" ("<<chosen<<")\n";
        }
        int chosenEngVal = (chosenIdx>=0) ? engineSide * children[chosenIdx].agg : -1000000000;
        int regret = bestEngVal - chosenEngVal;

        if (chosenIdx<0 || (regret >= minRegret && children[bestIdx].uci != chosen)){
            Candidate c; c.fen = fen; c.chosen = chosen; c.best = children[bestIdx].uci; c.regret = regret; c.bestVal = children[bestIdx].agg; c.chosenVal = (chosenIdx>=0? children[chosenIdx].agg:0); c.low=low; c.high=high; bad.push_back(c);
            if (verbose){ std::cout << "[bad] regret="<<regret<<" cp, stm="<<(sideToMove(fen))<<" fen=\n"<<fen<<"\n chosen="<<chosen<<" deepBest="<<children[bestIdx].uci<<"\n"; }
        }

        // advance by applying chosen move
        const char* next = apply_move_if_legal(fen.c_str(), chosen.c_str(), nullptr);
        if (!next || std::string(next).find("error")!=std::string::npos) break;
        fen = next;
    }

    // sort by regret desc (worst first)
    std::sort(bad.begin(), bad.end(), [](const Candidate &a, const Candidate &b){ return a.regret > b.regret; });

    // Output JSON for integration and a brief human-readable summary
    std::ostringstream out;
    out << "{\"count\":"<< bad.size() << ",\"items\":[";
    for (size_t i=0;i<bad.size();++i){ if(i) out << ","; const auto &c = bad[i];
        out << "{\"fen\":\""<< c.fen <<"\",\"chosen\":\""<< c.chosen <<"\",\"deepBest\":\""<< c.best
            <<"\",\"regretCp\":"<< c.regret <<",\"chosenAgg\":"<< c.chosenVal <<",\"deepBestAgg\":"<< c.bestVal
            <<",\"low\":"<< c.low <<",\"high\":"<< c.high <<"}";
    }
    out << "]}";
    std::cout << out.str() << std::endl;

    // Also echo top-3 in a compact list for quick copy
    int topN = std::min<int>(3, (int)bad.size());
    if (topN>0){
        std::cerr << "Top "<< topN << " worst (regret cp):\n";
        for (int i=0;i<topN;++i){ const auto &c = bad[i];
            std::cerr << (i+1) << ") " << c.regret << "cp | stm="<< sideToMove(c.fen) << " | chosen="<< c.chosen << " | best="<< c.best << "\n";
            std::cerr << c.fen << "\n";
        }
    }
    return 0;
}
