// Test: position and flipped must evaluate to 0 cp at given depth.
#include <iostream>
#include <string>
#include <sstream>
#include <vector>
#include <cctype>

extern "C" {
    const char* choose_best_move(const char* fen, const char* optionsJson);
}

static std::string rotateAndSwap(const std::string &placement){
    std::vector<char> squares(64,'.');
    std::vector<std::string> ranks; std::string tmp;
    for(char ch: placement){ if(ch=='/'){ ranks.push_back(tmp); tmp.clear(); } else tmp.push_back(ch); }
    ranks.push_back(tmp);
    if(ranks.size()!=8) return "";
    for(int r=0;r<8;r++){
        int file=0; for(char ch: ranks[r]){
            if(std::isdigit(static_cast<unsigned char>(ch))){ int n=ch-'0'; for(int k=0;k<n;k++){ squares[r*8+file]='.'; file++; } }
            else { squares[r*8+file]=ch; file++; }
        }
        if(file!=8) return "";
    }
    std::vector<char> out(64,'.');
    for(int i=0;i<64;i++){ char p=squares[i]; int j=63-i; if(p!='.') p = std::isupper((unsigned char)p)? std::tolower((unsigned char)p): std::toupper((unsigned char)p); out[j]=p; }
    std::ostringstream fen; for(int r=0;r<8;r++){ int empty=0; for(int c=0;c<8;c++){ char p=out[r*8+c]; if(p=='.'){ empty++; } else { if(empty){ fen<<empty; empty=0; } fen<<p; } } if(empty) fen<<empty; if(r!=7) fen<<"/"; }
    return fen.str();
}
static char flipSide(char s){ return s=='w'?'b':'w'; }
static std::string flipCast(const std::string &c){ if(c=="-") return c; bool wK=false,wQ=false,bK=false,bQ=false; for(char ch: c){ if(ch=='K') bK=true; else if(ch=='Q') bQ=true; else if(ch=='k') wK=true; else if(ch=='q') wQ=true; } std::string out; if(wK) out+='K'; if(wQ) out+='Q'; if(bK) out+='k'; if(bQ) out+='q'; if(out.empty()) out="-"; return out; }
static std::string flipEP(const std::string &ep){ if(ep.size()!=2) return "-"; char f=ep[0], r=ep[1]; if(f<'a'||f>'h'||r<'1'||r>'8') return "-"; int fi=f-'a', ri=r-'1'; int nfi=7-fi, nri=7-ri; return std::string()+char('a'+nfi)+char('1'+nri); }
static std::string flipFen(const std::string &fen){ std::istringstream ss(fen); std::string p,s,c,e,h,fn; if(!(ss>>p>>s>>c>>e>>h>>fn)) return fen; std::string np=rotateAndSwap(p); if(np.empty()) return fen; std::ostringstream out; out<<np<<" "<<flipSide(s[0])<<" "<<flipCast(c)<<" "<<flipEP(e)<<" "<<h<<" "<<fn; return out.str(); }

// Extract int field value after key
static bool extractInt(const std::string &s, const std::string &key, int &out){ size_t p=s.find(key); if(p==std::string::npos) return false; p=s.find(':',p); if(p==std::string::npos) return false; ++p; while(p<s.size() && std::isspace((unsigned char)s[p])) ++p; bool neg=false; if(p<s.size() && (s[p]=='-'||s[p]=='+')){ neg=(s[p]=='-'); ++p; } long v=0; bool any=false; while(p<s.size() && std::isdigit((unsigned char)s[p])){ any=true; v=v*10+(s[p]-'0'); ++p; } if(!any) return false; out=(int)(neg?-v:v); return true; }
static bool extractBestScore(const std::string &j, int &out){
    // Anchor to best block to avoid accidental other score keys
    size_t bestPos = j.find("\"best\"");
    if(bestPos==std::string::npos) return false;
    size_t scorePos = j.find("\"score\"", bestPos);
    if(scorePos==std::string::npos) return false;
    size_t p = j.find(':', scorePos); if(p==std::string::npos) return false; ++p;
    while(p<j.size() && std::isspace((unsigned char)j[p])) ++p;
    bool neg=false; if(p<j.size() && (j[p]=='-'||j[p]=='+')){ neg=(j[p]=='-'); ++p; }
    long v=0; bool any=false; while(p<j.size() && std::isdigit((unsigned char)j[p])){ any=true; v=v*10+(j[p]-'0'); ++p; }
    if(!any) return false; out = (int)(neg?-v:v); return true;
}
static bool extractBaseEval(const std::string &j, int &out){ return extractInt(j, "\"baseEval\"", out); }

int main(){
    // Revised neutrality test FEN: kings only, no material change possible.
    // This should remain 0 evaluation at any search depth.
    const std::string fen = "7k/8/8/8/8/8/8/7K w - - 0 1";
    const std::string flipped = flipFen(fen);
    const int depth = 20; // deep neutrality verification
    std::ostringstream opts; opts<<"{\"searchDepth\":"<<depth<<"}";
    const char* r1 = choose_best_move(fen.c_str(), opts.str().c_str());
    if(!r1){ std::cerr<<"Engine choose_best_move returned null (original)"<<std::endl; return 1; }
    std::string j1(r1); // copy immediately before second call overwrites static buffer
    const char* r2 = choose_best_move(flipped.c_str(), opts.str().c_str());
    if(!r2){ std::cerr<<"Engine choose_best_move returned null (flipped)"<<std::endl; return 1; }
    std::string j2(r2);
    std::cout << "Raw JSON original: " << j1 << "\n";
    std::cout << "Raw JSON flipped:  " << j2 << "\n";
    int best1=999999, best2=999999, base1=999999, base2=999999;
    bool ok=true;
    if(!extractBestScore(j1,best1)){ std::cerr<<"Parse fail best1"<<std::endl; ok=false; }
    if(!extractBestScore(j2,best2)){ std::cerr<<"Parse fail best2"<<std::endl; ok=false; }
    if(!extractBaseEval(j1,base1)){ std::cerr<<"Parse fail base1"<<std::endl; ok=false; }
    if(!extractBaseEval(j2,base2)){ std::cerr<<"Parse fail base2"<<std::endl; ok=false; }
    std::cout<<"Position: "<<fen<<"\nFlipped:  "<<flipped<<"\nDepth: "<<depth<<"\n";
    std::cout<<"Original baseEval="<<base1<<" best.score="<<best1<<"\n";
    std::cout<<"Flipped  baseEval="<<base2<<" best.score="<<best2<<"\n";
    if(base1!=0||base2!=0||best1!=0||best2!=0){ std::cerr<<"Failure: expected all evaluations == 0 cp"<<std::endl; ok=false; }
    return ok?0:1;
}
