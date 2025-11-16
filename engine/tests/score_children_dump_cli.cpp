#include "engine.h"
#include <string>
#include <vector>
#include <iostream>
#include <sstream>
#include <algorithm>
#include <iomanip>
#include <cctype>

extern "C" {
    const char* score_children(const char* fen, const char* optionsJson);
    const char* list_legal_moves(const char* fen, const char* fromSqOrNull, const char* optionsJson);
    const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson);
    int evaluate_fen_opts(const char* fen, const char* optionsJson);
}

static std::string initialFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

static char stm(const std::string &fen){ auto p = fen.find(' '); return (p==std::string::npos)?'w':fen[p+1]; }
static std::string optJson(int depth, bool debug){ std::ostringstream o; o << "{\"searchDepth\":"<< depth; if(debug) o << ",\"debugNegamax\":true"; o << "}"; return o.str(); }

struct ChildRow{
    std::string uci;
    int agg=0;
    int imm=0;
    long long nodes=0;
    int actualPlies=0;
    int base=0;
    int centerDelta=0;
    int kingImp=0;
    int matW=0;
    int matB=0;
    int tempo=0;
    int rootWhite=0;
    std::vector<std::string> reasons;
    std::vector<std::string> pv;
    std::string fen;
};

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
    std::vector<ChildRow> rows;
    size_t pos = json.find("\"children\":["); if (pos==std::string::npos) return rows; size_t i = pos;
    while (true){
        size_t u = json.find("\"uci\":\"", i); if (u==std::string::npos) break;
        ChildRow row; row.uci = extractString(json, "\"uci\":\"", u+7);
        if (row.uci.empty()){ i = u+7; continue; }
        extractInt(json, "\"agg\":", row.agg, u);
        extractInt(json, "\"imm\":", row.imm, u);
        long long nodes=0; if (extractLL(json, "\"nodes\":", nodes, u)) row.nodes = nodes;
        int ap=0; if (extractInt(json, "\"actualPlies\":", ap, u)) row.actualPlies = ap;
        // dbg block
        size_t dbgPos = json.find("\"dbg\":{", u);
        if (dbgPos != std::string::npos){
            extractInt(json, "\"base\":", row.base, dbgPos);
            extractInt(json, "\"centerDelta\":", row.centerDelta, dbgPos);
            extractInt(json, "\"kingImp\":", row.kingImp, dbgPos);
            extractInt(json, "\"matW\":", row.matW, dbgPos);
            extractInt(json, "\"matB\":", row.matB, dbgPos);
            extractInt(json, "\"tempo\":", row.tempo, dbgPos);
            extractInt(json, "\"rootWhite\":", row.rootWhite, dbgPos);
        }
        row.reasons = extractArrayStrings(json, "\"continuationReasons\":");
        row.pv = extractArrayStrings(json, "\"pv\":");
        row.fen = extractString(json, "\"fen\":\"", u);
        rows.push_back(row); i = u+7;
    }
    return rows;
}

static std::vector<std::string> extractMoves(const std::string &json){ std::vector<std::string> out; size_t i=0; while(true){ size_t p = json.find("\"uci\":\"", i); if (p==std::string::npos) break; auto u = extractString(json, "\"uci\":\"", p+7); out.push_back(u); i = p+7; } return out; }

static void dumpOnce(const std::string &fen, int depth, bool engineCentricSort, bool debug){
    std::string opts = optJson(depth, debug);
    const char* res = score_children(fen.c_str(), opts.c_str()); if (!res){ std::cerr << "score_children failed" << std::endl; return; }
    std::string j(res);
    auto rows = parseChildren(j);
    int engineSide = (stm(fen)=='w')? +1 : -1;
    if (engineCentricSort) std::sort(rows.begin(), rows.end(), [&](const ChildRow&a, const ChildRow&b){ return engineSide*a.agg > engineSide*b.agg; });
    else std::sort(rows.begin(), rows.end(), [&](const ChildRow&a, const ChildRow&b){ return a.agg > b.agg; });
    std::cout << "FEN: " << fen << "\n";
    std::cout << "Side: " << (stm(fen)=='w'?"White":"Black") << ", Depth: " << depth << "\n";
    if (rows.empty()){ std::cout << "(no children)\n"; return; }
    // Column widths
    size_t uciW=4, pvW=2; for(const auto &r: rows){ uciW = std::max(uciW, r.uci.size()); size_t pvLen=0; for(auto &m: r.pv) pvLen += m.size()+1; pvW = std::max(pvW, pvLen); }
    auto pad = [](const std::string &s, size_t w){ if(s.size()>=w) return s; return s + std::string(w - s.size(),' '); };
    std::cout << "Idx Move " << std::string(uciW-4,' ') << " Agg  Imm  Nodes    Ply  CΔ  KImp MatW MatB Tp PV" << "\n";
    std::cout << "--------------------------------------------------------------------------------" << "\n";
    for (size_t i=0;i<rows.size();++i){ const auto &r = rows[i];
        std::ostringstream pvStr; for(size_t k=0;k<r.pv.size();++k){ if(k) pvStr<<' '; pvStr<<r.pv[k]; }
        std::ostringstream reasonsStr; for(size_t k=0;k<r.reasons.size();++k){ if(k) reasonsStr<<","; reasonsStr<<r.reasons[k]; }
        std::cout << std::setw(3) << (int)(i+1) << " "
                  << pad(r.uci, uciW) << " "
                  << std::setw(5) << r.agg << " "
                  << std::setw(5) << r.imm << " "
                  << std::setw(8) << r.nodes << " "
                  << std::setw(4) << r.actualPlies << " "
                  << std::setw(3) << r.centerDelta << " "
                  << std::setw(4) << r.kingImp << " "
                  << std::setw(4) << r.matW << " "
                  << std::setw(4) << r.matB << " "
                  << std::setw(2) << r.tempo << " "
                  << pvStr.str();
        if(!r.reasons.empty()) std::cout << "  ["<< reasonsStr.str() <<"]";
        std::cout << "\n";
    }
    std::cout << "Note: agg = deep search score (white-centric); imm = immediate leaf eval after the move with no further search.\n";
}

static void recurseDump(const std::string &fen, int depth, int recurse, bool engineCentricSort, bool debug){
    dumpOnce(fen, depth, engineCentricSort, debug);
    if (recurse<=0) return;
    // apply each legal move and dump once more at reduced recurse
    const char* gen = list_legal_moves(fen.c_str(), nullptr, "{\"includeCastling\":true,\"castleSafety\":true}");
    if (!gen){ return; }
    std::string j(gen);
    auto moves = extractMoves(j);
    for (const auto &u : moves){ const char* nf = apply_move_if_legal(fen.c_str(), u.c_str(), "{\"includeCastling\":true,\"castleSafety\":true}"); if (!nf || std::string(nf).find("error")!=std::string::npos) continue; std::cout << "\n> After "<< u << ":\n"; recurseDump(nf, depth, recurse-1, engineCentricSort, debug); }
}

static std::string rotateAndSwap(const std::string &placement){
    std::vector<char> squares(64,'.'); std::vector<std::string> ranks; std::string tmp;
    for(char ch: placement){ if(ch=='/'){ ranks.push_back(tmp); tmp.clear(); } else tmp.push_back(ch); }
    ranks.push_back(tmp);
    if(ranks.size()!=8) return {};
    for(int r=0;r<8;r++){
        int f=0; for(char ch: ranks[r]){
            if(std::isdigit((unsigned char)ch)){ int n=ch-'0'; for(int k=0;k<n;k++){ squares[r*8+f]='.'; f++; } }
            else { squares[r*8+f]=ch; f++; }
        }
        if(f!=8) return {};
    }
    std::vector<char> out(64,'.');
    for(int i=0;i<64;i++){
        char p=squares[i]; int j=63-i; if(p!='.') p = std::isupper((unsigned char)p)? std::tolower((unsigned char)p): std::toupper((unsigned char)p); out[j]=p;
    }
    std::string res;
    for(int r=0;r<8;r++){
        int empty=0; for(int c=0;c<8;c++){ char p=out[r*8+c]; if(p=='.'){ empty++; } else { if(empty){ res+=char('0'+empty); empty=0; } res+=p; } }
        if(empty) res+=char('0'+empty); if(r!=7) res+='/';
    }
    return res;
}
static char flipSide(char s){ return s=='w'?'b':'w'; }
static std::string flipCast(const std::string &c){ if(c=="-") return c; bool wK=false,wQ=false,bK=false,bQ=false; for(char ch: c){ if(ch=='K') bK=true; else if(ch=='Q') bQ=true; else if(ch=='k') wK=true; else if(ch=='q') wQ=true; } std::string out; if(wK) out+='K'; if(wQ) out+='Q'; if(bK) out+='k'; if(bQ) out+='q'; if(out.empty()) out="-"; return out; }
static std::string flipEP(const std::string &ep){ if(ep.size()!=2) return "-"; char f=ep[0], r=ep[1]; if(f<'a'||f>'h'||r<'1'||r>'8') return "-"; int fi=f-'a', ri=r-'1'; int nfi=7-fi, nri=7-ri; return std::string()+char('a'+nfi)+char('1'+nri); }

static int evalFen(const std::string &fen){ return evaluate_fen_opts(fen.c_str(), "{}"); }

int main(int argc, char** argv){
    std::string fen = initialFen; int depth=3; int recurse=0; bool engineCentricSort=false; bool doFlip=false; bool doSym=false;
    bool debug=false;
    for (int i=1;i<argc;i++){
        std::string a(argv[i]);
        if (a=="--fen" && i+1<argc){ fen = argv[++i]; }
        else if (a=="--depth" && i+1<argc){ depth = std::max(1, std::atoi(argv[++i])); }
        else if (a=="--recurse" && i+1<argc){ recurse = std::max(0, std::atoi(argv[++i])); }
        else if (a=="--engineCentric") engineCentricSort = true;
        else if (a=="--debug") debug = true;
        else if (a=="--flip") doFlip = true;
        else if (a=="--symmetryTest") doSym = true;
        else if (a=="--help"){ std::cout << "Usage: score_children_dump_cli --fen <FEN> --depth <N> [--recurse <plys>] [--engineCentric] [--flip] [--symmetryTest] [--debug]\n"; return 0; }
    }
    if (doFlip){
        std::istringstream ss(fen); std::string p,s,c,e,h,fn; if(!(ss>>p>>s>>c>>e>>h>>fn)){ std::cerr<<"Bad FEN"<<std::endl; return 1; }
        std::string np = rotateAndSwap(p); if(np.empty()){ std::cerr<<"Flip failed"<<std::endl; return 1; }
        std::ostringstream out; out<<np<<" "<<flipSide(s[0])<<" "<<flipCast(c)<<" "<<flipEP(e)<<" "<<h<<" "<<fn; std::cout<<out.str()<<"\n"; return 0;
    }
    if (doSym){
        struct Case{ const char* fen; } cases[] = {
            {"rnbq1rk1/pppp1ppp/5n2/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - - 8 8"},
            {"rnbqkbnr/pppppppp/8/4P3/3P4/8/PPP1PPPP/RNBQKBNR b KQkq e3 0 3"},
            {"r1bqkbnr/pppp1ppp/2n5/4P3/3P4/8/PPP2PPP/RNBQKBNR b KQkq d3 0 5"}
        };
        bool ok=true;
        for(auto &cs: cases){
            int a = evalFen(cs.fen);
            std::istringstream s(cs.fen); std::string p,sid,c,e,hm,fn; if(!(s>>p>>sid>>c>>e>>hm>>fn)){ std::cerr<<"Parse fail: "<<cs.fen<<"\n"; ok=false; continue; }
            std::string np = rotateAndSwap(p); if(np.empty()){ std::cerr<<"Rotate fail: "<<cs.fen<<"\n"; ok=false; continue; }
            std::ostringstream nf; nf<<np<<" "<<flipSide(sid[0])<<" "<<flipCast(c)<<" "<<flipEP(e)<<" "<<hm<<" "<<fn; std::string flipped = nf.str();
            int b = evalFen(flipped);
            if(a != -b){ std::cerr<<"Symmetry mismatch (expected eval_flip == -eval)\n  FEN:   "<<cs.fen<<" -> eval="<<a<<"\n  Flip:  "<<flipped<<" -> eval="<<b<<"\n"; ok=false; }
        }
        std::cout << (ok?"Symmetry OK":"Symmetry FAIL") << "\n"; return ok?0:1;
    }
    recurseDump(fen, depth, recurse, engineCentricSort, debug);
    return 0;
}
