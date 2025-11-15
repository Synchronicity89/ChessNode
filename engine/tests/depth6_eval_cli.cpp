#include "engine.h"
#include <iostream>
#include <string>
#include <sstream>
#include <cctype>
#include <vector>

extern "C" {
    const char* score_children(const char* fen, const char* optionsJson);
}

static std::string rotateAndSwap(const std::string &placement){
    std::vector<char> squares(64,'.'); std::vector<std::string> ranks; std::string tmp;
    for(char ch: placement){ if(ch=='/'){ ranks.push_back(tmp); tmp.clear(); } else tmp.push_back(ch); }
    ranks.push_back(tmp);
    if(ranks.size()!=8) return {};
    for(int r=0;r<8;r++){ int f=0; for(char ch: ranks[r]){
        if(std::isdigit((unsigned char)ch)){ int n=ch-'0'; for(int k=0;k<n;k++){ squares[r*8+f]='.'; f++; } }
        else { squares[r*8+f]=ch; f++; }
    } if(ranks[r].empty()){} }
    std::vector<char> out(64,'.');
    for(int i=0;i<64;i++){
        char p=squares[i]; int j=63-i; if(p!='.') p = std::isupper((unsigned char)p)? std::tolower((unsigned char)p): std::toupper((unsigned char)p);
        out[j]=p;
    }
    std::string res; for(int r=0;r<8;r++){
        int empty=0; for(int c=0;c<8;c++){ char p=out[r*8+c]; if(p=='.'){ empty++; } else { if(empty){ res+=char('0'+empty); empty=0; } res+=p; } }
        if(empty) res+=char('0'+empty); if(r!=7) res+='/';
    }
    return res;
}
static char flipSide(char s){ return s=='w'?'b':'w'; }
static std::string flipCast(const std::string &c){ return "-"; }
static std::string flipEP(const std::string &ep){ if(ep.size()!=2) return "-"; char f=ep[0], r=ep[1]; if(f<'a'||f>'h'||r<'1'||r>'8') return "-"; int fi=f-'a', ri=r-'1'; int nfi=7-fi, nri=7-ri; return std::string()+char('a'+nfi)+char('1'+nri); }
static std::string flipFen(const std::string &fen){ std::istringstream ss(fen); std::string p,s,c,e,h,fn; if(!(ss>>p>>s>>c>>e>>h>>fn)) return {}; std::string np=rotateAndSwap(p); if(np.empty()) return {}; std::ostringstream out; out<<np<<" "<<flipSide(s[0])<<" "<<flipCast(c)<<" "<<flipEP(e)<<" "<<h<<" "<<fn; return out.str(); }

static bool extractInt(const std::string &s, const std::string &key, int &out){ size_t p=s.find(key); if(p==std::string::npos) return false; p+=key.size(); while(p<s.size() && std::isspace((unsigned char)s[p])) ++p; bool neg=false; if(p<s.size() && (s[p]=='-'||s[p]=='+')){ neg=(s[p]=='-'); ++p; } long v=0; bool any=false; while(p<s.size() && std::isdigit((unsigned char)s[p])){ any=true; v=v*10+(s[p]-'0'); ++p; } if(!any) return false; out=(int)(neg?-v:v); return true; }
static std::vector<int> extractAggs(const std::string &s){ std::vector<int> vals; size_t pos=0; const std::string key="\"agg\":"; while((pos=s.find(key,pos))!=std::string::npos){ pos+=key.size(); size_t p=pos; bool neg=false; if(p<s.size() && (s[p]=='-'||s[p]=='+')){ neg=(s[p]=='-'); ++p; } long v=0; bool any=false; while(p<s.size() && std::isdigit((unsigned char)s[p])){ any=true; v=v*10+(s[p]-'0'); ++p; } if(any) vals.push_back((int)(neg?-v:v)); }
    return vals; }

int main(){
    const std::string fen = "8/8/k7/P7/p7/K7/8/8 w - - 0 1";
    const std::string flip = flipFen(fen);
    if(flip.empty()){ std::cerr << "Flip failed" << std::endl; return 1; }

    const char* j1c = score_children(fen.c_str(), "{\"searchDepth\":6}");
    if(!j1c){ std::cerr << "score_children returned null (j1)" << std::endl; return 1; }
    std::string j1(j1c);
    const char* j2c = score_children(flip.c_str(), "{\"searchDepth\":6}");
    if(!j2c){ std::cerr << "score_children returned null (j2)" << std::endl; return 1; }
    std::string j2(j2c);
    // Compute best agg per side
    auto v1 = extractAggs(j1); auto v2 = extractAggs(j2);
    if(v1.empty() || v2.empty()){
        std::cerr << "No children parsed in score_children" << std::endl;
        std::cerr << "JSON1: " << j1 << std::endl;
        std::cerr << "JSON2: " << j2 << std::endl;
        return 1;
    }
    int s1 = -10000000; for(int x: v1) if(x>s1) s1=x;
    int s2 = -10000000; for(int x: v2) if(x>s2) s2=x;

    // Check symmetry: s1 ~= -s2 and both near zero (drawish). Allow +/- 100 cp tolerance.
    int sym = s1 + s2; // should be ~0
    if(sym < -100 || sym > 100){ std::cerr << "FAIL: symmetry mismatch at depth 6: s1="<<s1<<" s2="<<s2<<" sum="<<sym<<"\n"; return 1; }
    if(s1 < -150 || s1 > 150){ std::cerr << "FAIL: drawish magnitude too large: s1="<<s1<<"\n"; return 1; }
    std::cout << "PASS: depth6 drawish symmetry ok: s1="<<s1<<" s2="<<s2<<"\n"; return 0;
}
