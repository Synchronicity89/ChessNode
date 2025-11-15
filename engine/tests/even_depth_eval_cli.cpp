// CLI test: evaluate a FEN and its flipped version at depths 2,4,6,8.
// Fails (non-zero exit) if any evaluation is not exactly 0 cp.
#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <cctype>

extern "C" {
    const char* choose_best_move(const char* fen, const char* optionsJson);
}

// Minimal JSON number extractor for field "score" inside "best": {...}
static bool extractBestScore(const std::string &json, int &out){
    // Find "best" then "score":
    size_t p = json.find("\"best\""); if(p==std::string::npos) return false;
    p = json.find("\"score\"", p); if(p==std::string::npos) return false;
    p = json.find(':', p); if(p==std::string::npos) return false; ++p;
    // Skip spaces
    while(p < json.size() && std::isspace(static_cast<unsigned char>(json[p]))) ++p;
    // Parse optional sign
    bool neg = false; if(p < json.size() && (json[p]=='-' || json[p]=='+')){ neg = (json[p]=='-'); ++p; }
    long v = 0; bool any=false;
    while(p < json.size() && std::isdigit(static_cast<unsigned char>(json[p]))){ any=true; v = v*10 + (json[p]-'0'); ++p; }
    if(!any) return false; out = static_cast<int>(neg ? -v : v); return true;
}

// Flip helpers (copy of logic from fen_flip_cli)
static std::string rotateAndSwap(const std::string &placement){
    std::vector<char> squares(64,'.');
    std::vector<std::string> ranks; std::string tmp;
    for(char ch: placement){ if(ch=='/') { ranks.push_back(tmp); tmp.clear(); } else tmp.push_back(ch); } ranks.push_back(tmp);
    if(ranks.size()!=8) return "";
    for(int r=0;r<8;r++){
        const std::string &rk = ranks[r]; int file=0;
        for(char ch: rk){
            if(std::isdigit(static_cast<unsigned char>(ch))){ int n = ch-'0'; for(int k=0;k<n;k++){ squares[r*8+file]='.'; file++; } }
            else { squares[r*8+file]=ch; file++; }
        }
        if(file!=8) return "";
    }
    std::vector<char> out(64,'.');
    for(int i=0;i<64;i++){
        char p = squares[i]; int j = 63 - i;
        if(p!='.'){
            if(std::isupper(static_cast<unsigned char>(p))) p = (char)std::tolower(static_cast<unsigned char>(p));
            else p = (char)std::toupper(static_cast<unsigned char>(p));
        }
        out[j] = p;
    }
    std::ostringstream fen;
    for(int r=0;r<8;r++){
        int empty=0; for(int c=0;c<8;c++){ char p=out[r*8+c]; if(p=='.'){ empty++; } else { if(empty){ fen<<empty; empty=0; } fen<<p; } }
        if(empty) fen<<empty; if(r!=7) fen<<"/";
    }
    return fen.str();
}
static char flipSide(char s){ return s=='w'?'b':'w'; }
static std::string flipCastling(const std::string &cast){
    std::string nw=""; bool wK=false,wQ=false,bK=false,bQ=false;
    for(char ch: cast){ if(ch=='K') bK=true; else if(ch=='Q') bQ=true; else if(ch=='k') wK=true; else if(ch=='q') wQ=true; }
    if(wK) nw.push_back('K'); if(wQ) nw.push_back('Q'); if(bK) nw.push_back('k'); if(bQ) nw.push_back('q');
    if(nw.empty()) nw = "-"; return nw;
}
static std::string flipEnPassant(const std::string &ep){
    if(ep=="-" || ep.size()!=2) return "-";
    char file = ep[0]; char rank = ep[1]; if(file<'a'||file>'h'||rank<'1'||rank>'8') return "-";
    int f=file-'a', r=rank-'1'; int nf=7-f, nr=7-r; return std::string()+char('a'+nf)+char('1'+nr);
}
static std::string flipFen(const std::string &fen){
    std::istringstream ss(fen);
    std::string placement, side, castling, ep, half, full;
    if(!(ss>>placement>>side>>castling>>ep>>half>>full)) return fen;
    std::ostringstream out;
    out << rotateAndSwap(placement) << " " << flipSide(side.empty()? 'w': side[0])
        << " " << flipCastling(castling) << " " << flipEnPassant(ep)
        << " " << half << " " << full;
    return out.str();
}

static int evalBestScore(const std::string &fen, int depth){
    std::ostringstream opts; opts << "{\"searchDepth\":" << depth << ",\"extendOnCapture\":true}";
    const char* res = choose_best_move(fen.c_str(), opts.str().c_str());
    if(!res) return 999999; std::string js(res); int sc=999999; if(!extractBestScore(js, sc)) return 999999; return sc;
}

int main(){
    const std::string fen = "k7/PP6/8/8/8/p7/p7/K7 b - - 0 1";
    const std::string flipped = flipFen(fen);
    const int depths[] = {2,4,6,8};
    bool ok = true;
    std::cout << "FEN:    " << fen << "\nFlip:   " << flipped << "\n";
    for(int d: depths){
        int s1 = evalBestScore(fen, d);
        int s2 = evalBestScore(flipped, d);
        std::cout << "Depth " << d << ": score(fen)=" << s1 << ", score(flip)=" << s2 << "\n";
        if(s1 != 0 || s2 != 0) ok = false;
    }
    if(!ok){ std::cerr << "Failure: non-zero evaluation detected." << std::endl; return 1; }
    std::cout << "All depths evaluated to 0 cp." << std::endl;
    return 0;
}
