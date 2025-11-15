#include "engine.h"
#include <iostream>
#include <vector>
#include <string>
#include <cstdlib>
#include <sstream>
#include <cctype>

// Forward from fen_flip_cli logic (duplicated minimally to avoid dependency coupling)
static std::string rotateAndSwap(const std::string &placement){
    std::vector<char> squares(64,'.');
    std::vector<std::string> ranks; std::string tmp; for(char ch: placement){ if(ch=='/'){ ranks.push_back(tmp); tmp.clear(); } else tmp.push_back(ch); } ranks.push_back(tmp);
    if(ranks.size()!=8) return ""; for(int r=0;r<8;r++){ int f=0; for(char ch: ranks[r]){ if(std::isdigit((unsigned char)ch)){ int n=ch-'0'; for(int k=0;k<n;k++){ squares[r*8+f]='.'; f++; } } else { squares[r*8+f]=ch; f++; } } if(f!=8) return ""; }
    std::vector<char> out(64,'.'); for(int i=0;i<64;i++){ char p=squares[i]; int j=63-i; if(p!='.'){ if(std::isupper((unsigned char)p)) p=std::tolower((unsigned char)p); else p=std::toupper((unsigned char)p); } out[j]=p; }
    std::string res; for(int r=0;r<8;r++){ int empty=0; for(int c=0;c<8;c++){ char p=out[r*8+c]; if(p=='.'){ empty++; } else { if(empty){ res+=char('0'+empty); empty=0; } res+=p; } } if(empty) res+=char('0'+empty); if(r!=7) res+='/'; }
    return res;
}
static char flipSide(char s){ return s=='w'?'b':'w'; }
static std::string flipCast(const std::string &c){ if(c=="-") return c; bool wK=false,wQ=false,bK=false,bQ=false; for(char ch: c){ if(ch=='K') bK=true; else if(ch=='Q') bQ=true; else if(ch=='k') wK=true; else if(ch=='q') wQ=true; } std::string out; if(wK) out+='K'; if(wQ) out+='Q'; if(bK) out+='k'; if(bQ) out+='q'; if(out.empty()) out="-"; return out; }
static std::string flipEP(const std::string &ep){ if(ep.size()!=2) return "-"; char f=ep[0], r=ep[1]; if(f<'a'||f>'h'||r<'1'||r>'8') return "-"; int fi=f-'a', ri=r-'1'; int nfi=7-fi, nri=7-ri; return std::string()+char('a'+nfi)+char('1'+nri); }
static std::string flipFen(const std::string &fen){ std::istringstream ss(fen); std::string p,s,c,e,h,fn; if(!(ss>>p>>s>>c>>e>>h>>fn)) return ""; std::string np=rotateAndSwap(p); if(np.empty()) return ""; std::ostringstream out; out<<np<<" "<<flipSide(s[0])<<" "<<flipCast(c)<<" "<<flipEP(e)<<" "<<h<<" "<<fn; return out.str(); }

static int evalInt(const std::string &fen){ return evaluate_fen_opts(fen.c_str(), "{}"); }

int main(){
    struct Case{ std::string fen; };
    std::vector<Case> cases = {
        {"r1bq1rk1/ppp1bppp/2n1pn2/1B1p4/3P4/2N1PN2/PPP2PPP/R1BQ1RK1 w - - 8 8"},
        {"rnbq1rk1/1p3ppp/p3pn2/1Bpp4/3P4/2P1PN2/PP1N1PPP/R1BQ1RK1 b - - 4 10"},
        {"r2qkbnr/pp1b1ppp/2np4/2p1p3/2P1P3/2NP1N2/PP3PPP/R1BQKB1R w KQkq - 6 6"},
        {"r1bq1rk1/pp2ppbp/2n3p1/2pp4/3P4/2P1PN2/PP1N1PPP/R1BQ1RK1 b - - 3 9"}
    };

    bool allGood=true;
    for(const auto &cs: cases){
        std::string flipped = flipFen(cs.fen);
        int a = evalInt(cs.fen);
        int b = evalInt(flipped);
        if(a != -b){
            std::cout << "SYM MISMATCH (expected eval_flip == -eval):\n  FEN="<< cs.fen <<" eval="<< a <<"\n  FLIP="<< flipped <<" eval="<< b <<"\n";
            allGood=false;
        }
    }
    if(!allGood){ std::cerr << "Symmetry tests failed" << std::endl; return 1; }
    std::cout << "Symmetry tests passed" << std::endl; return 0;
}