// Minimal colorblind move-generation (no castling/EP). Generates king + knight moves only.
#include "engine.h"
#include <string>
#include <vector>
#include <cctype>
#include <sstream>

static const char* storeJson(const std::string &s){
    static std::string bufs[4];
    static int idx = 0;
    bufs[idx] = s;
    const char* ret = bufs[idx].c_str();
    idx = (idx + 1) & 3;
    return ret;
}

struct Board {
    // board[r][f], r=0 is rank8, f=0 is file a
    char b[8][8];
    bool flipped=false; // true if we rotated+swapped to make stm white
};

static void clearBoard(Board &bd){ for(int r=0;r<8;r++) for(int f=0;f<8;f++) bd.b[r][f]='.'; bd.flipped=false; }

static bool parseFen(const std::string &fen, std::string &placement, char &stm, std::string &cast, std::string &ep, std::string &half, std::string &full){
    std::istringstream ss(fen); if(!(ss>>placement>>stm>>cast>>ep>>half>>full)) return false; return true;
}

static void placePieces(Board &bd, const std::string &placement){
    clearBoard(bd);
    int r=0, f=0; for(char ch: placement){
        if(ch=='/') { r++; f=0; continue; }
        if(std::isdigit((unsigned char)ch)) { int n=ch-'0'; for(int k=0;k<n;k++){ if(r<8&&f<8) bd.b[r][f]='.'; f++; } }
        else { if(r<8&&f<8) bd.b[r][f]=ch; f++; }
    }
}

static char swapCase(char c){ if(std::isalpha((unsigned char)c)) return std::islower((unsigned char)c)? (char)std::toupper((unsigned char)c):(char)std::tolower((unsigned char)c); return c; }

static void rotateSwap(Board &dst, const Board &src){
    clearBoard(dst);
    for(int r=0;r<8;r++){
        for(int f=0;f<8;f++){
            int rr = 7 - r, ff = 7 - f;
            char p = src.b[r][f];
            if(p!='.') p = swapCase(p);
            dst.b[rr][ff] = p;
        }
    }
}

static std::string squareToUci(int r, int f){ // r=0 rank8 -> '8'
    char file = (char)('a' + f);
    char rank = (char)('8' - r);
    return std::string()+file+rank;
}

static void toOriginalCoords(bool flipped, int r, int f, int &or_r, int &or_f){
    if(!flipped){ or_r=r; or_f=f; return; }
    or_r = 7 - r; or_f = 7 - f;
}

static bool isWhite(char p){ return p>='A' && p<='Z'; }
static bool isBlack(char p){ return p>='a' && p<='z'; }
static bool isBlackKing(char p){ return p=='k'; }

struct Move { int r1,f1,r2,f2; char promo; };

static void genKnight(const Board &bd, int r, int f, std::vector<Move>& out){
    static const int D[8][2]={{2,1},{2,-1},{-2,1},{-2,-1},{1,2},{1,-2},{-1,2},{-1,-2}};
    for(auto &d: D){ int r2=r+d[0], f2=f+d[1]; if(r2<0||r2>7||f2<0||f2>7) continue; char t=bd.b[r2][f2]; if(isBlackKing(t)) continue; if(!isWhite(t)) out.push_back({r,f,r2,f2,0}); }
}

static void genKing(const Board &bd, int r, int f, std::vector<Move>& out){
    for(int dr=-1; dr<=1; ++dr){ for(int df=-1; df<=1; ++df){ if(dr==0&&df==0) continue; int r2=r+dr, f2=f+df; if(r2<0||r2>7||f2<0||f2>7) continue; char t=bd.b[r2][f2]; if(isBlackKing(t)) continue; if(!isWhite(t)) out.push_back({r,f,r2,f2,0}); }}
}

static void genSlideDir(const Board &bd, int r, int f, int dr, int df, std::vector<Move>& out){
    int r2=r+dr, f2=f+df; while(r2>=0&&r2<8&&f2>=0&&f2<8){ char t=bd.b[r2][f2]; if(isWhite(t)) break; if(isBlackKing(t)) break; out.push_back({r,f,r2,f2,0}); if(isBlack(t)) break; r2+=dr; f2+=df; }
}

static void genBishop(const Board &bd, int r, int f, std::vector<Move>& out){
    genSlideDir(bd, r, f, 1, 1, out);
    genSlideDir(bd, r, f, 1,-1, out);
    genSlideDir(bd, r, f,-1, 1, out);
    genSlideDir(bd, r, f,-1,-1, out);
}

static void genRook(const Board &bd, int r, int f, std::vector<Move>& out){
    genSlideDir(bd, r, f, 1, 0, out);
    genSlideDir(bd, r, f,-1, 0, out);
    genSlideDir(bd, r, f, 0, 1, out);
    genSlideDir(bd, r, f, 0,-1, out);
}

static void genQueen(const Board &bd, int r, int f, std::vector<Move>& out){
    genBishop(bd, r, f, out);
    genRook(bd, r, f, out);
}

static void genPawn(const Board &bd, int r, int f, std::vector<Move>& out){
    // White-centric pawns move upwards (toward decreasing r)
    int r1 = r - 1;
    if(r1>=0){
        if(bd.b[r1][f]=='.'){
            if(r1==0){
                out.push_back({r,f,r1,f,'q'});
                out.push_back({r,f,r1,f,'r'});
                out.push_back({r,f,r1,f,'b'});
                out.push_back({r,f,r1,f,'n'});
            } else {
                out.push_back({r,f,r1,f,0});
            }
            // Initial double push from starting rank (rank2 => r index 6)
            if(r==6){
                int r2 = r - 2;
                if(r2>=0 && bd.b[r2][f]=='.'){
                    out.push_back({r,f,r2,f,0});
                }
            }
        }
        if(f-1>=0){ char t = bd.b[r1][f-1]; if(!isBlackKing(t) && isBlack(t)){
            if(r1==0){
                out.push_back({r,f,r1,f-1,'q'});
                out.push_back({r,f,r1,f-1,'r'});
                out.push_back({r,f,r1,f-1,'b'});
                out.push_back({r,f,r1,f-1,'n'});
            } else {
                out.push_back({r,f,r1,f-1,0});
            }
        } }
        if(f+1<8){ char t = bd.b[r1][f+1]; if(!isBlackKing(t) && isBlack(t)){
            if(r1==0){
                out.push_back({r,f,r1,f+1,'q'});
                out.push_back({r,f,r1,f+1,'r'});
                out.push_back({r,f,r1,f+1,'b'});
                out.push_back({r,f,r1,f+1,'n'});
            } else {
                out.push_back({r,f,r1,f+1,0});
            }
        } }
    }
}

static bool squareAttackedByBlack(const Board &bd, int r, int f){
    // Knights
    static const int KN[8][2]={{2,1},{2,-1},{-2,1},{-2,-1},{1,2},{1,-2},{-1,2},{-1,-2}};
    for(auto &d: KN){ int r2=r+d[0], f2=f+d[1]; if(r2>=0&&r2<8&&f2>=0&&f2<8){ if(bd.b[r2][f2]=='n') return true; }}
    // King
    for(int dr=-1; dr<=1; ++dr){ for(int df=-1; df<=1; ++df){ if(dr==0&&df==0) continue; int r2=r+dr, f2=f+df; if(r2>=0&&r2<8&&f2>=0&&f2<8){ if(bd.b[r2][f2]=='k') return true; } }}
    // Black pawns attack downwards: king at (r,f) attacked by pawn at (r-1,f±1)
    if(r-1>=0){ if(f-1>=0 && bd.b[r-1][f-1]=='p') return true; if(f+1<8 && bd.b[r-1][f+1]=='p') return true; }
    // Sliders: bishops/rooks/queens
    auto ray = [&](int dr,int df){ int r2=r+dr, f2=f+df; while(r2>=0&&r2<8&&f2>=0&&f2<8){ char t=bd.b[r2][f2]; if(t!='.'){ if(dr!=0 && df!=0){ if(t=='b'||t=='q') return true; } else { if(t=='r'||t=='q') return true; } return false; } r2+=dr; f2+=df; } return false; };
    if(ray(1,0)||ray(-1,0)||ray(0,1)||ray(0,-1)||ray(1,1)||ray(1,-1)||ray(-1,1)||ray(-1,-1)) return true;
    return false;
}

static bool whiteKingInCheck(const Board &bd){
    int kr=-1,kf=-1; for(int r=0;r<8;r++){ for(int f=0;f<8;f++){ if(bd.b[r][f]=='K'){ kr=r; kf=f; break; } } if(kr!=-1) break; }
    if(kr==-1) return false; // no king found; treat as not in check to avoid over-pruning
    return squareAttackedByBlack(bd, kr, kf);
}

static void applyOnBoard(Board &bd, const Move &m){
    char piece = bd.b[m.r1][m.f1];
    bd.b[m.r1][m.f1]='.';
    char placed = piece;
    if (piece=='P' && m.r2==0 && m.promo){
        char lc = (char)std::tolower((unsigned char)m.promo);
        if (lc=='r') placed='R'; else if(lc=='b') placed='B'; else if(lc=='n') placed='N'; else placed='Q';
    }
    bd.b[m.r2][m.f2]=placed;
}

static std::vector<Move> filterLegal(const Board &bd, const std::vector<Move>& moves){
    std::vector<Move> legal; legal.reserve(moves.size());
    for(const auto &m: moves){ Board tmp = bd; applyOnBoard(tmp, m); if(!whiteKingInCheck(tmp)) legal.push_back(m); }
    return legal;
}

static void genMovesColorblind(const Board &bd, std::vector<Move>& out){
    for(int r=0;r<8;r++){
        for(int f=0;f<8;f++){
            char p = bd.b[r][f];
            if(!isWhite(p)) continue;
            switch(p){
                case 'P': genPawn(bd, r, f, out); break;
                case 'N': genKnight(bd, r, f, out); break;
                case 'K': genKing(bd, r, f, out); break;
                // Bishops enabled
                case 'B': genBishop(bd, r, f, out); break;
                // Rooks: full rays
                case 'R': genRook(bd, r, f, out); break;
                // Queen enabled
                case 'Q': genQueen(bd, r, f, out); break;
                default: break;
            }
        }
    }
}

static std::string buildMovesJson(const std::vector<Move>& mv, bool flipped){
    std::ostringstream os; os<<"{\"moves\":[";
    bool first=true;
    for(const auto &m: mv){ int r1o,f1o,r2o,f2o; toOriginalCoords(flipped,m.r1,m.f1,r1o,f1o); toOriginalCoords(flipped,m.r2,m.f2,r2o,f2o); std::string u1=squareToUci(r1o,f1o); std::string u2=squareToUci(r2o,f2o); if(!first) os<<","; first=false; os<<"{\"uci\":\""<<u1<<u2; if(m.promo){ os<< (char)m.promo; } os<<"\"}"; }
    os<<"],\"stm\":\""<<(flipped?"b":"w")<<"\"}"; // report original stm
    return os.str();
}

static Board makeColorblindBoard(const std::string &fen){
    std::string placement, cast, ep, half, full; char stm='w';
    Board raw; clearBoard(raw);
    if(!parseFen(fen, placement, stm, cast, ep, half, full)) return raw;
    placePieces(raw, placement);
    if(stm=='b'){
        Board tmp; rotateSwap(tmp, raw); tmp.flipped=true; return tmp;
    }
    raw.flipped=false; return raw;
}

extern "C" const char* generate_descendants(const char* fen, int depth, int enableNPlus1){
    if(!fen){ return storeJson("{\"root\":\"\",\"nodes\":[],\"perf\":{}}" ); }
    if(depth<1) depth=1; if(depth>5) depth=5; // safety cap
    std::string rootFen(fen);
    struct Node { std::string parent; std::string fen; int d; };
    std::vector<Node> nodes; nodes.reserve(256);
    std::vector<std::string> frontier; frontier.push_back(rootFen);
    for(int ply=1; ply<=depth; ++ply){
        std::vector<std::string> next;
        for(const auto &pf : frontier){
            const char* mvJson = list_legal_moves(pf.c_str(), nullptr, nullptr);
            if(!mvJson) continue;
            std::string s(mvJson);
            // Extract UCIs
            std::vector<std::string> ucis; size_t pos=0; const std::string pat="\"uci\":\"";
            while((pos=s.find(pat,pos))!=std::string::npos){ size_t start=pos+pat.size(); size_t end=s.find('"', start); if(end==std::string::npos) break; ucis.push_back(s.substr(start,end-start)); pos=end+1; }
            int capPerParent = 0; // options ignored for now
            int count=0;
            for(const auto &u : ucis){
                const char* cf = apply_move_if_legal(pf.c_str(), u.c_str(), nullptr);
                if(!cf || !*cf) continue;
                std::string childFen(cf);
                if(childFen.size()>2 && childFen[0]=='{' && childFen.find("\"error\"")!=std::string::npos) continue;
                nodes.push_back(Node{pf, childFen, ply});
                next.push_back(childFen);
                count++; if(capPerParent>0 && count>=capPerParent) break;
            }
        }
        frontier.swap(next);
    }
    std::ostringstream os; os<<"{\"root\":\""<<rootFen<<"\",\"nodes\":[";
    bool first=true; for(const auto &n : nodes){ if(!first) os<<","; first=false; os<<"{\"parent\":\""<<n.parent<<"\",\"fen\":\""<<n.fen<<"\",\"d\":"<<n.d<<"}"; }
    os<<"],\"perf\":{\"totalNodes\":"<<nodes.size()<<"}}";
    return storeJson(os.str());
}

extern "C" const char* generate_descendants_opts(const char* fen, int depth, int enableNPlus1, const char* optionsJson){
    (void)optionsJson; return generate_descendants(fen, depth, enableNPlus1);
}

extern "C" const char* list_legal_moves(const char* fen, const char* fromSqOrNull, const char* optionsJson){
    (void)fromSqOrNull; (void)optionsJson;
    if(!fen){ return storeJson("{\"moves\":[],\"stm\":\"w\"}"); }
    Board cb = makeColorblindBoard(std::string(fen));
    std::vector<Move> pseudo; genMovesColorblind(cb, pseudo);
    std::vector<Move> legal = filterLegal(cb, pseudo);
    return storeJson(buildMovesJson(legal, cb.flipped));
}

extern "C" const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson){
    (void)optionsJson;
    if(!fen||!uciMove){ return storeJson("{\"error\":\"bad input\"}"); }
    // Generate moves and accept if present; then build naive next-FEN (no castling/EP handling)
    Board cb = makeColorblindBoard(std::string(fen));
    std::vector<Move> pseudo; genMovesColorblind(cb, pseudo);
    std::vector<Move> moves = filterLegal(cb, pseudo);
    // Parse uci move
    std::string u(uciMove);
    if(u.size()<4){ return storeJson("{\"error\":\"illegal\"}"); }
    int f1 = u[0]-'a', r1 = '8'-u[1];
    int f2 = u[2]-'a', r2 = '8'-u[3];
    char promoCh = 0; if(u.size()>=5){ char pc = (char)std::tolower((unsigned char)u[4]); if(pc=='q'||pc=='r'||pc=='b'||pc=='n') promoCh = pc; }
    if(f1<0||f1>7||f2<0||f2>7||r1<0||r1>7||r2<0||r2>7){ return storeJson("{\"error\":\"illegal\"}"); }
    // Map to colorblind coords if needed
    int cb_r1, cb_f1, cb_r2, cb_f2; if(cb.flipped){ cb_r1 = 7 - r1; cb_f1 = 7 - f1; cb_r2 = 7 - r2; cb_f2 = 7 - f2; } else { cb_r1=r1; cb_f1=f1; cb_r2=r2; cb_f2=f2; }
    bool found=false; for(const auto &m: moves){ if(m.r1==cb_r1 && m.f1==cb_f1 && m.r2==cb_r2 && m.f2==cb_f2){ found=true; break; } }
    if(!found){ return storeJson("{\"error\":\"illegal\"}"); }
    // Apply on a fresh board built from FEN placement
    std::string placement, cast, ep, half, full; char stm='w';
    parseFen(std::string(fen), placement, stm, cast, ep, half, full);
    Board orig; placePieces(orig, placement);
    // Execute move in original coordinates
    char piece = orig.b[r1][f1]; orig.b[r1][f1]='.'; orig.b[r2][f2]=piece;
    // Handle promotion if applicable (either explicit suffix or inferred on reaching last rank)
    auto toPromoPiece = [&](char basePawn, char pch){ bool white = (basePawn>='A' && basePawn<='Z'); char lc = (char)std::tolower((unsigned char)pch); char out='Q'; if(lc=='r') out='R'; else if(lc=='b') out='B'; else if(lc=='n') out='N'; else out='Q'; if(!white) out = (char)std::tolower((unsigned char)out); return out; };
    bool whitePawn = (piece=='P'); bool blackPawn = (piece=='p');
    if((whitePawn && r2==0) || (blackPawn && r2==7)){
        char use = promoCh ? promoCh : 'q';
        orig.b[r2][f2] = toPromoPiece(piece, use);
    }
    // Build new placement string
    std::ostringstream outP;
    for(int r=0;r<8;r++){
        if(r) outP << '/';
        int empty=0; for(int f=0; f<8; f++){
            char p = orig.b[r][f];
            if(p=='.'){ empty++; }
            else { if(empty){ outP<<empty; empty=0; } outP<<p; }
        }
        if(empty) outP<<empty;
    }
    // Toggle side to move; castling always '-' (ignored); ep '-' ; keep clocks as-is
    char nextStm = (stm=='w')? 'b':'w';
    std::ostringstream fenOut; fenOut<<outP.str()<<" "<<nextStm<<" - - "<<half<<" "<<full;
    return storeJson(fenOut.str());
}

extern "C" int side_in_check(const char* fen){
    if(!fen) return 0;
    Board cb = makeColorblindBoard(std::string(fen));
    // In colorblind board, side-to-move is always white; reuse whiteKingInCheck
    return whiteKingInCheck(cb) ? 1 : 0;
}

#ifdef CHESSNODE_INSTRUMENT_THREADS
extern "C" const char* debug_compare_symmetry(const char* fen, const char* optionsJson){
    (void)fen; (void)optionsJson;
    return storeJson("{\"error\":\"instrumentation disabled in stub\"}");
}
#endif
