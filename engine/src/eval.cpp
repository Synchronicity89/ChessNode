#include "engine.h"
#include <string>
#include <cctype>
#include <sstream>
#include <vector>

// We keep evaluation intentionally simple and configurable. Default is material-only.
// All scores are white-centric centipawns (int). GUI may format as pawns with 3 decimals.

namespace {
struct EvalWeights { int p=100,n=300,b=300,r=500,q=900,k=0; };
struct EvalTerms { bool material=true; bool tempo=false; };
struct EvalOptions { EvalWeights w; EvalTerms t; int tempo=10; };

static EvalOptions parseEvalOptions(const char* json){
    EvalOptions o; if (!json || !*json) return o; std::string s(json);
    auto findInt = [&](const char* key, int &dst){ auto p=s.find(std::string("\"")+key+"\""); if(p==std::string::npos) return; auto c=s.find(':',p); if(c==std::string::npos) return; dst=std::atoi(s.c_str()+c+1); };
    auto findBool = [&](const char* key, bool &dst){ auto p=s.find(std::string("\"")+key+"\""); if(p==std::string::npos) return; auto c=s.find(':',p); if(c==std::string::npos) return; auto sub=s.substr(c+1); if(sub.find("true")!=std::string::npos) dst=true; else if(sub.find("false")!=std::string::npos) dst=false; };
    // Weights under "weights"
    auto findIntNested = [&](const char* parent,const char* child,int &dst){ auto p=s.find(std::string("\"")+parent+"\""); if(p==std::string::npos) return; auto br=s.find('{',p); if(br==std::string::npos) return; auto end=s.find('}',br); if(end==std::string::npos) return; std::string sub=s.substr(br,end-br+1); auto k=sub.find(std::string("\"")+child+"\""); if(k==std::string::npos) return; auto c=sub.find(':',k); if(c==std::string::npos) return; dst=std::atoi(sub.c_str()+c+1); };
    auto findBoolNested = [&](const char* parent,const char* child,bool &dst){ auto p=s.find(std::string("\"")+parent+"\""); if(p==std::string::npos) return; auto br=s.find('{',p); if(br==std::string::npos) return; auto end=s.find('}',br); if(end==std::string::npos) return; std::string sub=s.substr(br,end-br+1); auto k=sub.find(std::string("\"")+child+"\""); if(k==std::string::npos) return; auto c=sub.find(':',k); if(c==std::string::npos) return; auto v=sub.substr(c+1); if(v.find("true")!=std::string::npos) dst=true; else if(v.find("false")!=std::string::npos) dst=false; };
    findIntNested("weights","p", o.w.p);
    findIntNested("weights","n", o.w.n);
    findIntNested("weights","b", o.w.b);
    findIntNested("weights","r", o.w.r);
    findIntNested("weights","q", o.w.q);
    findIntNested("weights","k", o.w.k);
    findBoolNested("terms","material", o.t.material);
    findBoolNested("terms","tempo", o.t.tempo);
    findInt("tempo", o.tempo);
    return o;
}

static int pieceValue(char c, const EvalWeights &w){
    switch(std::tolower((unsigned char)c)){
        case 'p': return w.p; case 'n': return w.n; case 'b': return w.b; case 'r': return w.r; case 'q': return w.q; case 'k': return w.k; default: return 0;
    }
}

static int evalMaterial(const std::string &board, const EvalWeights &w){
    int score=0; for(char c: board){ if(c=='/'||std::isdigit((unsigned char)c)) continue; int v=pieceValue(c,w); if(std::isupper((unsigned char)c)) score+=v; else score-=v; }
    return score;
}

static std::string boardPart(const char* fen){ if(!fen) return {}; std::string s(fen); auto sp=s.find(' '); return (sp==std::string::npos)?s:s.substr(0,sp); }
static char sideToMove(const char* fen){ if(!fen) return 'w'; std::string s(fen); auto sp=s.find(' '); if(sp==std::string::npos) return 'w'; auto sp2=s.find(' ', sp+1); if(sp2==std::string::npos) return 'w'; return s[sp+1]; }
}

namespace chess {
static int evaluateFENWithOptions(const char* fen, const EvalOptions &opt){
    int score=0; if(opt.t.material){ score += evalMaterial(boardPart(fen), opt.w); }
    if(opt.t.tempo){ score += (sideToMove(fen)=='w' ? opt.tempo : -opt.tempo); }
    return score;
}
}

extern "C" int evaluate_fen_opts(const char* fen, const char* optionsJson){
    auto opt = parseEvalOptions(optionsJson);
    return chess::evaluateFENWithOptions(fen, opt);
}

extern "C" const char* evaluate_move_line(const char* fen, const char* movesJson, const char* optionsJson){
    // We'll reuse descendants.cpp engine to apply moves and build JSON
    extern const char* apply_move_if_legal(const char*, const char*, const char*);
    static std::string g_json;
    auto opt = parseEvalOptions(optionsJson);
    // naive parse of ["uci","uci2",...]
    std::vector<std::string> moves;
    if (movesJson && *movesJson){
        std::string s(movesJson);
        size_t i=0; while((i=s.find('"', i))!=std::string::npos){ size_t j=s.find('"', i+1); if(j==std::string::npos) break; moves.push_back(s.substr(i+1, j-(i+1))); i=j+1; }
    }
    std::ostringstream out; out << "{\"start\":\""<< (fen?fen:"") <<"\",\"nodes\":[";
    std::string cur = fen?fen:""; int ply=0; int lastEval = 0; bool first=true;
    for (size_t k=0; k<moves.size(); ++k){
        const char* next = apply_move_if_legal(cur.c_str(), moves[k].c_str(), nullptr);
        if (!next || std::string(next).find("error")!=std::string::npos){
            if (!first) out << ","; first=false;
            out << "{\"ply\":"<< (k+1) <<",\"uci\":\""<< moves[k] <<"\",\"error\":\"illegal\"}";
            break;
        }
        cur = next;
        int ev = evaluate_fen_opts(cur.c_str(), optionsJson);
        if (!first) out << ","; first=false;
        out << "{\"ply\":"<< (k+1) <<",\"uci\":\""<< moves[k] <<"\",\"fen\":\""<< cur <<"\",\"eval\":"<< ev <<"}";
        lastEval = ev; ply = int(k+1);
    }
    out << "],\"finalFen\":\""<< cur <<"\",\"finalEval\":"<< lastEval <<"}";
    g_json = out.str();
    return g_json.c_str();
}
