#include "engine.h"
#include <string>
#include <vector>
#include <iostream>
#include <sstream>
#include <algorithm>
#include <cctype>

extern "C" {
    const char* score_children(const char* fen, const char* optionsJson);
    const char* list_legal_moves(const char* fen, const char* fromSqOrNull, const char* optionsJson);
    const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson);
}

static std::string initialFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

static char stm(const std::string &fen){ auto p = fen.find(' '); return (p==std::string::npos)?'w':fen[p+1]; }
static std::string optJson(int depth){ std::ostringstream o; o << "{\"searchDepth\":"<< depth <<"}"; return o.str(); }

struct ChildRow{
    std::string uci; int agg=0; int imm=0; long long nodes=0; int actualPlies=0; std::vector<std::string> reasons; std::vector<std::string> pv; std::string fen; };

static std::string extractString(const std::string &s, const std::string &key, size_t from=0){
    size_t p = s.find(key, from); if (p==std::string::npos) return {}; size_t q = p + key.size(); size_t r = s.find('"', q); if (r==std::string::npos) return {}; return s.substr(q, r-q);
}
static bool extractInt(const std::string &s, const std::string &key, int &out, size_t from=0){ size_t p = s.find(key, from); if(p==std::string::npos) return false; size_t q=p+key.size(); bool neg=false; if(q<s.size() && (s[q]=='-'||s[q]=='+')){ neg=(s[q]=='-'); ++q; } long v=0; bool any=false; while(q<s.size() && std::isdigit(static_cast<unsigned char>(s[q]))){ any=true; v=v*10+(s[q]-'0'); ++q; } if(!any) return false; out = (int)(neg?-v:v); return true; }
static bool extractLL(const std::string &s, const std::string &key, long long &out, size_t from=0){ size_t p = s.find(key, from); if(p==std::string::npos) return false; size_t q=p+key.size(); bool neg=false; if(q<s.size() && (s[q]=='-'||s[q]=='+')){ neg=(s[q]=='-'); ++q; } long long v=0; bool any=false; while(q<s.size() && std::isdigit(static_cast<unsigned char>(s[q]))){ any=true; v=v*10+(s[q]-'0'); ++q; } if(!any) return false; out = neg?-v:v; return true; }

static std::vector<std::string> extractArrayStrings(const std::string &s, const std::string &key){
    std::vector<std::string> out; size_t p = s.find(key); if (p==std::string::npos) return out; size_t q = s.find('[', p); if (q==std::string::npos) return out; size_t r = s.find(']', q); if (r==std::string::npos) return out; std::string arr = s.substr(q+1, r-q-1);
    size_t i=0; while(true){ size_t a = arr.find('"', i); if (a==std::string::npos) break; size_t b = arr.find('"', a+1); if (b==std::string::npos) break; out.push_back(arr.substr(a+1, b-a-1)); i = b+1; }
    return out;
}

static std::vector<ChildRow> parseChildren(const std::string &json){
    std::vector<ChildRow> rows; size_t pos = json.find("\"children\":["); if (pos==std::string::npos) return rows; size_t i = pos;
    while (true){ size_t u = json.find("\"uci\":\"", i); if (u==std::string::npos) break; ChildRow row; row.uci = extractString(json, "\"uci\":\"", u+7);
        extractInt(json, "\"agg\":", row.agg, u);
        extractInt(json, "\"imm\":", row.imm, u);
        long long nodes=0; if (extractLL(json, "\"nodes\":", nodes, u)) row.nodes = nodes; int ap=0; if (extractInt(json, "\"actualPlies\":", ap, u)) row.actualPlies = ap;
        row.reasons = extractArrayStrings(json, "\"continuationReasons\":");
        row.pv = extractArrayStrings(json, "\"pv\":");
        row.fen = extractString(json, "\"fen\":\"", u);
        rows.push_back(row); i = u+7;
    }
    return rows;
}

static std::vector<std::string> extractMoves(const std::string &json){ std::vector<std::string> out; size_t i=0; while(true){ size_t p = json.find("\"uci\":\"", i); if (p==std::string::npos) break; auto u = extractString(json, "\"uci\":\"", p+7); out.push_back(u); i = p+7; } return out; }

static void dumpOnce(const std::string &fen, int depth, bool engineCentricSort){
    std::string opts = optJson(depth);
    const char* res = score_children(fen.c_str(), opts.c_str()); if (!res){ std::cerr << "score_children failed" << std::endl; return; }
    std::string j(res);
    auto rows = parseChildren(j);
    int engineSide = (stm(fen)=='w')? +1 : -1;
    if (engineCentricSort) std::sort(rows.begin(), rows.end(), [&](const ChildRow&a, const ChildRow&b){ return engineSide*a.agg > engineSide*b.agg; });
    else std::sort(rows.begin(), rows.end(), [&](const ChildRow&a, const ChildRow&b){ return a.agg > b.agg; });
    std::cout << "FEN: " << fen << "\n";
    std::cout << "Side: " << (stm(fen)=='w'?"White":"Black") << ", Depth: " << depth << "\n";
    for (size_t i=0;i<rows.size();++i){ const auto &r = rows[i];
        std::cout << (i+1) << ". " << r.uci << " | agg=" << r.agg << "cp, imm=" << r.imm << "cp"
                  << " | nodes=" << r.nodes << " | plies=" << r.actualPlies;
        if (!r.reasons.empty()){ std::cout << " | reasons="; for (size_t k=0;k<r.reasons.size();++k){ if(k) std::cout << ","; std::cout << r.reasons[k]; } }
        if (!r.pv.empty()){ std::cout << " | pv="; for (size_t k=0;k<r.pv.size();++k){ if(k) std::cout << ' '; std::cout << r.pv[k]; } }
        std::cout << "\n";
    }
}

static void recurseDump(const std::string &fen, int depth, int recurse, bool engineCentricSort){
    dumpOnce(fen, depth, engineCentricSort);
    if (recurse<=0) return;
    // apply each legal move and dump once more at reduced recurse
    const char* gen = list_legal_moves(fen.c_str(), nullptr, "{\"includeCastling\":true,\"castleSafety\":true}");
    if (!gen){ return; }
    std::string j(gen);
    auto moves = extractMoves(j);
    for (const auto &u : moves){ const char* nf = apply_move_if_legal(fen.c_str(), u.c_str(), "{\"includeCastling\":true,\"castleSafety\":true}"); if (!nf || std::string(nf).find("error")!=std::string::npos) continue; std::cout << "\n> After "<< u << ":\n"; recurseDump(nf, depth, recurse-1, engineCentricSort); }
}

int main(int argc, char** argv){
    std::string fen = initialFen; int depth=3; int recurse=0; bool engineCentricSort=false;
    for (int i=1;i<argc;i++){
        std::string a(argv[i]);
        if (a=="--fen" && i+1<argc){ fen = argv[++i]; }
        else if (a=="--depth" && i+1<argc){ depth = std::max(1, std::atoi(argv[++i])); }
        else if (a=="--recurse" && i+1<argc){ recurse = std::max(0, std::atoi(argv[++i])); }
        else if (a=="--engineCentric") engineCentricSort = true;
        else if (a=="--help"){ std::cout << "Usage: score_children_dump_cli --fen <FEN> --depth <N> [--recurse <plys>] [--engineCentric]\n"; return 0; }
    }
    recurseDump(fen, depth, recurse, engineCentricSort);
    return 0;
}
