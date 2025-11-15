// Simple CLI to flip a FEN by rotating the board 180 degrees and swapping piece colors.
// Usage: fen_flip_cli --fen "<FEN>"
#include <iostream>
#include <string>
#include <vector>
#include <cctype>
#include <sstream>

static std::string rotateAndSwap(const std::string &placement){
    // Expand ranks into 64 squares
    std::vector<char> squares(64,'.');
    int idx=0; // from a8 to h1? FEN lists ranks 8->1 left->right
    std::istringstream in(placement);
    std::string rank;
    std::vector<std::string> ranks; size_t start=0; std::string tmp; 
    for(char ch: placement){ if(ch=='/') { ranks.push_back(tmp); tmp.clear(); } else tmp.push_back(ch); } ranks.push_back(tmp);
    if(ranks.size()!=8) return ""; // invalid
    for(int r=0;r<8;r++){ const std::string &rk = ranks[r]; int file=0; for(char ch: rk){ if(std::isdigit(static_cast<unsigned char>(ch))){ int n=ch-'0'; for(int k=0;k<n;k++){ squares[r*8 + file] = '.'; file++; } } else { squares[r*8 + file] = ch; file++; } }
        if(file!=8) return ""; }
    // Create new square vector after 180 rotation + color swap
    std::vector<char> out(64,'.');
    for(int i=0;i<64;i++){
        char p = squares[i];
        int j = 63 - i; // 180 degree rotation
        if(p!='.'){
            if(std::isupper(static_cast<unsigned char>(p))) p = std::tolower(static_cast<unsigned char>(p));
            else p = std::toupper(static_cast<unsigned char>(p));
        }
        out[j] = p;
    }
    // Compress back into FEN ranks (8->1)
    std::ostringstream fen;
    for(int r=0;r<8;r++){ int empty=0; for(int c=0;c<8;c++){ char p=out[r*8+c]; if(p=='.'){ empty++; } else { if(empty){ fen<<empty; empty=0; } fen<<p; } } if(empty) fen<<empty; if(r!=7) fen<<"/"; }
    return fen.str();
}

static char flipSide(char side){ return side=='w'?'b':'w'; }

static std::string flipCastling(const std::string &cast){
    // Swap colors: K<->k, Q<->q
    std::string nw=""; bool wK=false,wQ=false,bK=false,bQ=false;
    for(char ch: cast){
        switch(ch){
            case 'K': bK=true; break;
            case 'Q': bQ=true; break;
            case 'k': wK=true; break;
            case 'q': wQ=true; break;
        }
    }
    if(wK) nw.push_back('K'); if(wQ) nw.push_back('Q'); if(bK) nw.push_back('k'); if(bQ) nw.push_back('q');
    if(nw.empty()) nw = "-"; return nw;
}

static std::string flipEnPassant(const std::string &ep){
    if(ep=="-" || ep.size()!=2) return "-";
    char file = ep[0]; char rank = ep[1];
    if(file<'a'||file>'h'||rank<'1'||rank>'8') return "-";
    int f = file - 'a'; int r = rank - '1';
    int nf = 7 - f; int nr = 7 - r; // 180 rotation
    char nfch = char('a' + nf); char nrch = char('1' + nr);
    return std::string() + nfch + nrch;
}

static std::string flipFen(const std::string &fen){
    std::istringstream ss(fen);
    std::string placement, side, castling, ep, half, full;
    if(!(ss>>placement>>side>>castling>>ep>>half>>full)) return "{""error"":""bad-fen""}"; 
    std::string newPlacement = rotateAndSwap(placement);
    if(newPlacement.empty()) return "{""error"":""bad-board""}";
    std::string newSide(1, flipSide(side.empty()? 'w': side[0]));
    std::string newCast = flipCastling(castling);
    std::string newEp = flipEnPassant(ep);
    // Keep clocks unchanged (could adjust fullmove if side flipped from black->white but not needed for symmetry test)
    std::ostringstream out; out << newPlacement << " " << newSide << " " << newCast << " " << newEp << " " << half << " " << full;
    return out.str();
}

int main(int argc, char** argv){
    std::string fen=""; for(int i=1;i<argc;i++){ std::string a=argv[i]; if(a=="--fen" && i+1<argc) fen=argv[++i]; else if(a=="--help"){ std::cout << "Usage: fen_flip_cli --fen <FEN>\n"; return 0; } }
    if(fen.empty()){ std::cerr << "Provide FEN via --fen" << std::endl; return 1; }
    std::string flipped = flipFen(fen);
    std::cout << flipped << std::endl;
    return 0;
}