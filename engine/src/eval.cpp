#include "engine.h"
#include <string>
#include <cctype>
#include <sstream>
#include <vector>
#include <functional>
#include <cmath>
#include <unordered_map>
#include <algorithm>

extern "C" int side_in_check(const char*); // from descendants.cpp

// We keep evaluation intentionally simple and configurable. Default is material-only.
// All scores are white-centric centipawns (int). GUI may format as pawns with 3 decimals.

namespace {
struct EvalWeights { int p=100,n=300,b=300,r=500,q=900,k=0; };
struct EvalTerms { bool material=true; bool tempo=false; };
struct EvalOptions {
    EvalWeights w; EvalTerms t; int tempo=10;
    int centerReward=0; int kingMagnet=0; int searchDepth=1;
    // Development/forward control
    double devIncentive=0.0; double rankAttack=1.0; bool countThreatOccupied=true;
    // Opponent development weighting (Own - devOppWeight * Opp)
    // Default 0.0 to match previous JS behavior unless explicitly configured
    double devOppWeight=0.0;
    // Castling and king movement knobs
    int castleKReward=0; int castleQReward=0; int kingNonCastlePenalty=0;
    // Manual test toggle
    bool forceKnightLoop=false;
};

static EvalOptions parseEvalOptions(const char* json){
    EvalOptions o; if (!json || !*json) return o; std::string s(json);
    auto findInt = [&](const char* key, int &dst){
        size_t p = 0; std::string needle = std::string("\"") + key + "\"";
        while ((p = s.find(needle, p)) != std::string::npos) {
            size_t c = s.find(':', p); if (c==std::string::npos) return; size_t i = c+1;
            while (i < s.size() && std::isspace((unsigned char)s[i])) ++i;
            // Accept optional minus sign and digits
            if (i < s.size() && (s[i]=='-' || std::isdigit((unsigned char)s[i]))) { dst = std::atoi(s.c_str()+i); return; }
            p = c+1; // continue searching next occurrence
        }
    };
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
    findInt("centerPiecePlacementReward", o.centerReward);
    findInt("endGameKingCenterMagnet", o.kingMagnet);
    findInt("searchDepth", o.searchDepth);
    // Development controls (optional)
    auto findDouble = [&](const char* key, double &dst){ auto p=s.find(std::string("\"")+key+"\""); if(p==std::string::npos) return; auto c=s.find(':',p); if(c==std::string::npos) return; dst=std::atof(s.c_str()+c+1); };
    findDouble("developmentIncentive", o.devIncentive);
    findDouble("rankAttackFactor", o.rankAttack);
    findBool("notJustEmptySquaresThreatReward", o.countThreatOccupied);
    findDouble("developmentOpponentWeight", o.devOppWeight);
    findInt("castleKingSideReward", o.castleKReward);
    findInt("castleQueenSideReward", o.castleQReward);
    findInt("kingNonCastleMovePenalty", o.kingNonCastlePenalty);
    findBool("forceKnightCenterLoop", o.forceKnightLoop);
    // Safety clamps to prevent extreme UI configs from blowing up scores
    if (o.devIncentive < 0.0) o.devIncentive = 0.0;
    if (o.devIncentive > 50.0) o.devIncentive = 50.0;
    if (o.rankAttack < 0.5) o.rankAttack = 0.5;
    if (o.rankAttack > 2.5) o.rankAttack = 2.5;
    if (o.centerReward < -500) o.centerReward = -500; if (o.centerReward > 500) o.centerReward = 500;
    if (o.kingMagnet < -200) o.kingMagnet = -200; if (o.kingMagnet > 200) o.kingMagnet = 200;
    if (o.castleKReward < -500) o.castleKReward = -500; if (o.castleKReward > 500) o.castleKReward = 500;
    if (o.castleQReward < -500) o.castleQReward = -500; if (o.castleQReward > 500) o.castleQReward = 500;
    if (o.kingNonCastlePenalty < 0) o.kingNonCastlePenalty = 0; if (o.kingNonCastlePenalty > 1000) o.kingNonCastlePenalty = 1000;
    if (o.searchDepth <= 0) o.searchDepth = 1;
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

// Debug helper: return separate white and black material sums (centipawns)
static std::pair<int,int> evalMaterialWB(const std::string &board, const EvalWeights &w){
    int wsum=0, bsum=0; 
    for(char c: board){
        if (c=='/' || std::isdigit((unsigned char)c)) continue;
        int v = pieceValue(c, w);
        if (std::isupper((unsigned char)c)) wsum += v; else bsum += v;
    }
    return {wsum, bsum};
}

static std::string boardPart(const char* fen){ if(!fen) return {}; std::string s(fen); auto sp=s.find(' '); return (sp==std::string::npos)?s:s.substr(0,sp); }
static char sideToMove(const char* fen){ if(!fen) return 'w'; std::string s(fen); auto sp=s.find(' '); if(sp==std::string::npos) return 'w'; auto sp2=s.find(' ', sp+1); if(sp2==std::string::npos) return 'w'; return s[sp+1]; }
static std::string castlingRights(const char* fen){ if(!fen) return "-"; std::string s(fen); size_t p1=s.find(' '); if(p1==std::string::npos) return "-"; size_t p2=s.find(' ', p1+1); if(p2==std::string::npos) return "-"; size_t p3=s.find(' ', p2+1); if(p3==std::string::npos) return "-"; return s.substr(p2+1, p3-(p2+1)); }
static void buildBoardGrid(const std::string &board, char grid[8][8]){
    int r=0,c=0; for(char ch: board){
        if (ch=='/'){ r++; c=0; continue; }
        if (std::isdigit((unsigned char)ch)){ c += (ch - '0'); continue; }
        if (r>=0&&r<8&&c>=0&&c<8) grid[r][c]=ch; c++;
    }
}
static int manhattanToCenter(int r, int c){ int best=99; int targets[4][2]={{4,3},{4,4},{3,3},{3,4}}; for(auto &t:targets){ int d=std::abs(t[0]-r)+std::abs(t[1]-c); if(d<best) best=d; } return best==99?0:best; }
static bool isUpper(char c){ return std::isupper((unsigned char)c)!=0; }
static bool isLower(char c){ return std::islower((unsigned char)c)!=0; }
static void findKing(const char grid[8][8], bool white, int &kr, int &kc){ char target = white?'K':'k'; for(int r=0;r<8;r++) for(int c=0;c<8;c++) if(grid[r][c]==target){ kr=r; kc=c; return; } kr=-1; kc=-1; }
static int countOpponentStrength(const char grid[8][8], bool opponentIsWhite){ int n=0,b=0,r=0,q=0; for(int i=0;i<8;i++) for(int j=0;j<8;j++){ char ch=grid[i][j]; if(!ch||ch=='.') continue; if(opponentIsWhite?isUpper(ch):isLower(ch)){ char lc=(char)std::tolower((unsigned char)ch); if(lc=='n') n++; else if(lc=='b') b++; else if(lc=='r') r++; else if(lc=='q') q++; } } return 3*(n+b)+5*r+9*q; }
static double endgamishness(const char grid[8][8], bool opponentIsWhite){ int S = countOpponentStrength(grid, opponentIsWhite); const int T=31, L=6; double x = (double)(T - S) / (double)std::max(1, T - L); if (x<0) x=0; if (x>1) x=1; return x; }

// Development/forward control helpers (piece-weighted, unique square via max controller strength)
static bool inB(int r,int c){ return r>=0&&r<8&&c>=0&&c<8; }
static void markRayCtrl(const char grid[8][8], bool ctrl[8][8], int r,int c,int dr,int dc){
    int i=r+dr, j=c+dc;
    while(inB(i,j)){
        ctrl[i][j] = true;
        if (grid[i][j] != '.') break; // stop at first blocker
        i+=dr; j+=dc;
    }
}
static double humpMidgame(double e){ // 0 at 0/1, peak 1 at e=0.5
    double h = 4.0*e*(1.0-e); if (h<0) h=0; return h; }
static double developmentControlScore(const char grid[8][8], bool engineWhite, const EvalOptions &opt){
    // Boolean control of squares in opponent half (unweighted), similar to CLI tool and UI expectations
    bool ctrl[8][8]; for(int i=0;i<8;i++) for(int j=0;j<8;j++) ctrl[i][j]=false;
    for(int r=0;r<8;r++){
        for(int c=0;c<8;c++){
            char ch = grid[r][c]; if (ch=='.') continue; bool own = engineWhite? isUpper(ch): isLower(ch); if(!own) continue;
            char lc=(char)std::tolower((unsigned char)ch);
            if (lc=='p'){
                int dr = engineWhite? -1: +1; int i=r+dr; if (inB(i,c-1)) ctrl[i][c-1]=true; if (inB(i,c+1)) ctrl[i][c+1]=true;
            } else if (lc=='n'){
                const int K[8][2]={{-2,-1},{-2,1},{-1,-2},{-1,2},{1,-2},{1,2},{2,-1},{2,1}};
                for (auto &d:K){ int i=r+d[0], j=c+d[1]; if(inB(i,j)) ctrl[i][j]=true; }
            } else if (lc=='k'){
                for(int dr=-1;dr<=1;dr++) for(int dc=-1;dc<=1;dc++){ if(!dr&&!dc) continue; int i=r+dr, j=c+dc; if(inB(i,j)) ctrl[i][j]=true; }
            } else if (lc=='b' || lc=='q'){
                markRayCtrl(grid,ctrl,r,c,-1,-1); markRayCtrl(grid,ctrl,r,c,-1,1); markRayCtrl(grid,ctrl,r,c,1,-1); markRayCtrl(grid,ctrl,r,c,1,1);
            }
            if (lc=='r' || lc=='q'){
                markRayCtrl(grid,ctrl,r,c,-1,0); markRayCtrl(grid,ctrl,r,c,1,0); markRayCtrl(grid,ctrl,r,c,0,-1); markRayCtrl(grid,ctrl,r,c,0,1);
            }
        }
    }
    double sum=0.0; for(int r=0;r<8;r++) for(int c=0;c<8;c++){
        bool inOpp = engineWhite? (r<=3) : (r>=4); if(!inOpp) continue; if (!ctrl[r][c]) continue;
        if (!opt.countThreatOccupied && grid[r][c] != '.') continue;
        int rdepth = engineWhite? (4 - r) : (r - 3); if (rdepth<1) rdepth=1; if (rdepth>4) rdepth=4;
        sum += opt.devIncentive * std::pow(std::max(1.0, opt.rankAttack), (double)rdepth);
    }
    return sum;
}
}

// Shared evaluation helpers for search and scoring (engine-wide)
namespace {
struct RootRef {
    int startCenter=0; double startCenterW=0.0; int startKMan=0; bool rootWhite=true;
    double startDev=0.0; double startDevOpp=0.0;
    int startKR=-1, startKC=-1; // engine king start square
    int oppStartKR=-1, oppStartKC=-1; // opponent king start square
    std::string startRights; // starting castling rights string
};

static RootRef computeRootRef(const char* startFen, const EvalOptions &opt){
    RootRef rr; rr.rootWhite = (sideToMove(startFen)=='w');
    auto boardStart = boardPart(startFen);
    char gridStart[8][8]; for(int r=0;r<8;r++) for(int c=0;c<8;c++) gridStart[r][c]='.'; buildBoardGrid(boardStart, gridStart);
    auto isOwn = [&](char ch){ return ch!='.' && ((rr.rootWhite && isUpper(ch)) || (!rr.rootWhite && isLower(ch))); };
    auto inCenter = [&](int r,int c){ return (r==4&&c==3)||(r==4&&c==4)||(r==3&&c==3)||(r==3&&c==4); };
    auto centerWeightOf = [&](char ch)->double{
        char lc = (char)std::tolower((unsigned char)ch);
        if (lc=='p') return 2.0;
        if (lc=='n' || lc=='b') return 1.0;
        if (lc=='r') return 0.8;
        if (lc=='q') return 0.6;
        return 0.0; // king excluded; king magnet term handles
    };
    for(int r=0;r<8;r++) for(int c=0;c<8;c++) if(inCenter(r,c) && isOwn(gridStart[r][c])){ rr.startCenter++; rr.startCenterW += centerWeightOf(gridStart[r][c]); }
    int kr=-1,kc=-1; findKing(gridStart, rr.rootWhite, kr, kc); rr.startKR=kr; rr.startKC=kc; rr.startKMan = (kr>=0? manhattanToCenter(kr,kc):0);
    int okr=-1,okc=-1; findKing(gridStart, !rr.rootWhite, okr, okc); rr.oppStartKR=okr; rr.oppStartKC=okc;
    // Root development baseline
    rr.startDev = developmentControlScore(gridStart, rr.rootWhite, opt);
    rr.startDevOpp = developmentControlScore(gridStart, !rr.rootWhite, opt);
    rr.startRights = castlingRights(startFen);
    return rr;
}

static double combinedScore(const char* someFen, const RootRef &rr, const EvalOptions &opt){
    int base = 0;
    if (opt.t.material){ base += evalMaterial(boardPart(someFen), opt.w); }
    if (opt.t.tempo){ base += (sideToMove(someFen)=='w' ? opt.tempo : -opt.tempo); }
    std::string b = boardPart(someFen);
    char grid[8][8]; for(int r=0;r<8;r++) for(int c=0;c<8;c++) grid[r][c]='.'; buildBoardGrid(b, grid);
    auto isOwn = [&](char ch){ return ch!='.' && ((rr.rootWhite && isUpper(ch)) || (!rr.rootWhite && isLower(ch))); };
    auto inCenter = [&](int r,int c){ return (r==4&&c==3)||(r==4&&c==4)||(r==3&&c==3)||(r==3&&c==4); };
    // Weighted center occupancy: pawns exert strong central influence; others moderate; king excluded here
    auto centerWeightOf = [&](char ch)->double{
        char lc = (char)std::tolower((unsigned char)ch);
        if (lc=='p') return 2.0;
        if (lc=='n' || lc=='b') return 1.0;
        if (lc=='r') return 0.8;
        if (lc=='q') return 0.6;
        return 0.0; // king handled by king magnet term
    };
    double centerNowW=0.0; for(int r=0;r<8;r++) for(int c=0;c<8;c++) if(inCenter(r,c) && isOwn(grid[r][c])) centerNowW += centerWeightOf(grid[r][c]);
    double centerDeltaW = (centerNowW - rr.startCenterW);
    int kr=-1,kc=-1; findKing(grid, rr.rootWhite, kr, kc); int kMan = (kr>=0? manhattanToCenter(kr,kc):0);
    double endg = endgamishness(grid, !rr.rootWhite);
    double kingImp = std::max(0, rr.startKMan - kMan);
    // Engine-centric geometric term (own center occupancy change and own king improvement)
    double geomEngine = (double)opt.centerReward * centerDeltaW + (double)opt.kingMagnet * kingImp * endg;
    // Development net delta since root (own - weight * opponent)
    double devOwnNow = (opt.devIncentive>0.0 && opt.rankAttack>0.0) ? developmentControlScore(grid, rr.rootWhite, opt) : 0.0;
    double devOppNow = (opt.devIncentive>0.0 && opt.rankAttack>0.0) ? developmentControlScore(grid, !rr.rootWhite, opt) : 0.0;
    double devDeltaEngine = (devOwnNow - rr.startDev) - opt.devOppWeight * (devOppNow - rr.startDevOpp);

    // Castling and king movement terms (engine-centric with opponent inversion), end-FEN heuristics
    auto addCastleAndKing = [&]()->double{
        if (opt.castleKReward==0 && opt.castleQReward==0 && opt.kingNonCastlePenalty==0) return 0.0;
        auto isCastledK = [&](bool white)->bool{
            int kr=-1,kc=-1; findKing(grid, white, kr, kc);
            if (white){ if (kr!=7 || kc!=6) return false; return grid[7][5]=='R'; }
            else { if (kr!=0 || kc!=6) return false; return grid[0][5]=='r'; }
        };
        auto isCastledQ = [&](bool white)->bool{
            int kr=-1,kc=-1; findKing(grid, white, kr, kc);
            if (white){ if (kr!=7 || kc!=2) return false; return grid[7][3]=='R'; }
            else { if (kr!=0 || kc!=2) return false; return grid[0][3]=='r'; }
        };
        auto kingMovedNonCastle = [&](bool white, int startR, int startC)->bool{
            int homeR = white? 7:0; int homeC = 4;
            if (startR!=homeR || startC!=homeC) return false;
            int kr=-1,kc=-1; findKing(grid, white, kr, kc);
            if (kr==homeR && kc==homeC) return false;
            if ((kr==(white?7:0) && (kc==6 || kc==2))) return false;
            return true;
        };
        auto rightsNow = castlingRights(someFen);
        auto hadRight = [&](bool white, bool kingSide){ char flag = white? (kingSide?'K':'Q') : (kingSide?'k':'q'); return rr.startRights.find(flag)!=std::string::npos; };
        auto hasRightNow = [&](bool white, bool kingSide){ char flag = white? (kingSide?'K':'Q') : (kingSide?'k':'q'); return rightsNow.find(flag)!=std::string::npos; };
        double sum = 0.0;
        // Engine side
        if (isCastledK(rr.rootWhite)) sum += (double)opt.castleKReward;
        if (isCastledQ(rr.rootWhite)) sum += (double)opt.castleQReward;
        if (opt.kingNonCastlePenalty>0 && kingMovedNonCastle(rr.rootWhite, rr.startKR, rr.startKC)) sum -= (double)opt.kingNonCastlePenalty;
        if (hadRight(rr.rootWhite, true) && !hasRightNow(rr.rootWhite, true)){
            if (!isCastledK(rr.rootWhite) && !kingMovedNonCastle(rr.rootWhite, rr.startKR, rr.startKC)) sum -= (double)opt.castleKReward;
        }
        if (hadRight(rr.rootWhite, false) && !hasRightNow(rr.rootWhite, false)){
            if (!isCastledQ(rr.rootWhite) && !kingMovedNonCastle(rr.rootWhite, rr.startKR, rr.startKC)) sum -= (double)opt.castleQReward;
        }
        // Opponent inverted
        if (isCastledK(!rr.rootWhite)) sum -= (double)opt.castleKReward;
        if (isCastledQ(!rr.rootWhite)) sum -= (double)opt.castleQReward;
        if (opt.kingNonCastlePenalty>0 && kingMovedNonCastle(!rr.rootWhite, rr.oppStartKR, rr.oppStartKC)) sum += (double)opt.kingNonCastlePenalty;
        if (hadRight(!rr.rootWhite, true) && !hasRightNow(!rr.rootWhite, true)){
            if (!isCastledK(!rr.rootWhite) && !kingMovedNonCastle(!rr.rootWhite, rr.oppStartKR, rr.oppStartKC)) sum += (double)opt.castleKReward;
        }
        if (hadRight(!rr.rootWhite, false) && !hasRightNow(!rr.rootWhite, false)){
            if (!isCastledQ(!rr.rootWhite) && !kingMovedNonCastle(!rr.rootWhite, rr.oppStartKR, rr.oppStartKC)) sum += (double)opt.castleQReward;
        }
        return sum;
    };

    double castleEngineCentric = addCastleAndKing();
    int engineSideLocal = rr.rootWhite ? +1 : -1;
    // Convert engine-centric terms to white-centric by multiplying engine side (+1 white, -1 black)
    double geomWhiteCentric = (double)engineSideLocal * geomEngine;
    double devWhiteCentric = (double)engineSideLocal * devDeltaEngine;
    double castleWhiteCentric = (double)engineSideLocal * castleEngineCentric;
    return (double)base + geomWhiteCentric + devWhiteCentric + castleWhiteCentric;
}
}

namespace chess {
static int evaluateFENWithOptions(const char* fen, const EvalOptions &opt){
    int score=0; if(opt.t.material){ score += evalMaterial(boardPart(fen), opt.w); }
    if(opt.t.tempo){ score += (sideToMove(fen)=='w' ? opt.tempo : -opt.tempo); }
    return score;
}
}

// Helper to safely convert a double centipawn value to int with sane bounds
static int clampToCp(double cp){
    if (!std::isfinite(cp)) return 0;
    if (cp > 30000.0) return 30000; // 300 pawns cap
    if (cp < -30000.0) return -30000;
    return (int)std::llround(cp);
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

extern "C" const char* choose_best_move(const char* fen, const char* optionsJson){
    // Use existing engine to enumerate legal moves and evaluate simple line score terms
    extern const char* list_legal_moves(const char*, const char*, const char*);
    extern const char* apply_move_if_legal(const char*, const char*, const char*);
    static std::string g_json;
    if (!fen || !*fen){ g_json = "{\"error\":\"no-fen\"}"; return g_json.c_str(); }
    auto opt = parseEvalOptions(optionsJson);
    // Helper: extract all UCI strings from a JSON array of moves
    auto extractUcis = [](const std::string &s){
        std::vector<std::string> out; size_t pos=0; const std::string pat = "\"uci\":\"";
        while ((pos = s.find(pat, pos)) != std::string::npos) { size_t start = pos + pat.size(); size_t end = s.find('"', start); if (end == std::string::npos) break; out.push_back(s.substr(start, end - start)); pos = end + 1; }
        return out;
    };


    // Prepare root reference and orientation
    RootRef rr = computeRootRef(fen, opt);
    // Alpha-beta search in engine-centric space (engineSide = +1 for white, -1 for black)
    const int engineSide = rr.rootWhite ? +1 : -1;
    // Alpha-beta returning engine-centric value and principal variation
    struct ScorePV { double val; std::vector<std::string> pv; long long nodes; std::vector<std::string> reasons; };
    struct LineState { std::unordered_map<std::string,int> rep; std::vector<std::string> reasons; };
    auto hasReason = [](const std::vector<std::string> &v, const char* r){ return std::find(v.begin(), v.end(), r) != v.end(); };
    auto addReason = [&](std::vector<std::string> &v, const char* r){ if (!hasReason(v, r)) v.push_back(r); };
    auto epTarget = [](const char* f){ if(!f) return std::string("-"); std::string s(f); size_t p1=s.find(' '); if(p1==std::string::npos) return std::string("-"); size_t p2=s.find(' ', p1+1); if(p2==std::string::npos) return std::string("-"); size_t p3=s.find(' ', p2+1); if(p3==std::string::npos) return std::string("-"); size_t p4=s.find(' ', p3+1); if(p4==std::string::npos) return std::string("-"); size_t p5=s.find(' ', p4+1); if(p5==std::string::npos) return s.substr(p4+1); return s.substr(p4+1, p5-(p4+1)); };
    auto repKey = [&](const char* f){ std::ostringstream k; k<< boardPart(f) <<" "<< sideToMove(f) <<" "<< castlingRights(f) <<" "<< epTarget(f); return k.str(); };
    std::function<ScorePV(const char*, int, double, double, LineState)> search;
    search = [&](const char* curFen, int depth, double alpha, double beta, LineState st)->ScorePV{
        long long nodesHere = 1; // count current node
        // Threefold repetition cutoff (line-level): if this key already seen twice
        auto key = repKey(curFen);
        int cnt = st.rep[key];
        if (cnt >= 2){
            if (!hasReason(st.reasons, "threefold-cutoff")) st.reasons.push_back("threefold-cutoff");
            return { 0.0, {}, nodesHere, st.reasons };
        }
        st.rep[key] = cnt + 1;
        // Depth or terminal
        const char* jsonMoves = list_legal_moves(curFen, nullptr, optionsJson);
        std::vector<std::string> moves = jsonMoves ? extractUcis(std::string(jsonMoves)) : std::vector<std::string>{};
        if (depth<=0 || moves.empty()){
            // Leaf: return engine-centric value (engineSide * white-centric)
            return { (double)engineSide * combinedScore(curFen, rr, opt), {}, nodesHere, st.reasons };
        }

        // Decide whose turn relative to the engine's color
        bool engineToMove = ((sideToMove(curFen) == 'w') == rr.rootWhite);
        // Check extension if side to move is in check
        bool inCheckHere = side_in_check(curFen) != 0;

        if (engineToMove){
            // Maximizing for the engine
            double value = -1e300; std::vector<std::string> pvBest; bool progressed=false; long long nodesSum=nodesHere; std::vector<std::string> reasonsBest = st.reasons;
            for (const auto &uci : moves){
                const char* nextFen = apply_move_if_legal(curFen, uci.c_str(), optionsJson);
                if (!nextFen || std::string(nextFen).find("error")!=std::string::npos) continue;
                progressed = true;
                // Material swing extension: compare net material
                auto wbNow = evalMaterialWB(boardPart(curFen), opt.w);
                auto wbNext = evalMaterialWB(boardPart(nextFen), opt.w);
                int netNow = wbNow.first - wbNow.second;
                int netNext = wbNext.first - wbNext.second;
                bool matSwing = (netNow != netNext);
                int ext = 0; if (inCheckHere) ext = 1; if (matSwing) ext = std::min(1, ext + 1);
                LineState stChild = st;
                if (inCheckHere) addReason(stChild.reasons, "check-extension");
                if (matSwing) addReason(stChild.reasons, "material-swing-extension");
                auto child = search(nextFen, depth-1+ext, alpha, beta, stChild);
                nodesSum += child.nodes;
                if (child.val > value){ value = child.val; pvBest.clear(); pvBest.push_back(uci); pvBest.insert(pvBest.end(), child.pv.begin(), child.pv.end()); reasonsBest = child.reasons; }
                if (child.val > alpha) alpha = child.val;
                if (alpha >= beta) break; // beta cut-off
            }
            if (!progressed){
                // All candidates failed to apply; treat as leaf to avoid sentinel propagation
                return { (double)engineSide * combinedScore(curFen, rr, opt), {}, nodesHere, st.reasons };
            }
            return { value, pvBest, nodesSum, reasonsBest };
        } else {
            // Minimizing for the opponent (worst for the engine)
            double value = 1e300; std::vector<std::string> pvBest; bool progressed=false; long long nodesSum=nodesHere; std::vector<std::string> reasonsBest = st.reasons;
            for (const auto &uci : moves){
                const char* nextFen = apply_move_if_legal(curFen, uci.c_str(), optionsJson);
                if (!nextFen || std::string(nextFen).find("error")!=std::string::npos) continue;
                progressed = true;
                auto wbNow = evalMaterialWB(boardPart(curFen), opt.w);
                auto wbNext = evalMaterialWB(boardPart(nextFen), opt.w);
                int netNow = wbNow.first - wbNow.second;
                int netNext = wbNext.first - wbNext.second;
                bool matSwing = (netNow != netNext);
                int ext = 0; if (inCheckHere) ext = 1; if (matSwing) ext = std::min(1, ext + 1);
                LineState stChild = st;
                if (inCheckHere) addReason(stChild.reasons, "check-extension");
                if (matSwing) addReason(stChild.reasons, "material-swing-extension");
                auto child = search(nextFen, depth-1+ext, alpha, beta, stChild);
                nodesSum += child.nodes;
                if (child.val < value){ value = child.val; pvBest.clear(); pvBest.push_back(uci); pvBest.insert(pvBest.end(), child.pv.begin(), child.pv.end()); reasonsBest = child.reasons; }
                if (child.val < beta) beta = child.val;
                if (alpha >= beta) break; // alpha cut-off
            }
            if (!progressed){
                // All candidates failed to apply; treat as leaf to avoid sentinel propagation
                return { (double)engineSide * combinedScore(curFen, rr, opt), {}, nodesHere, st.reasons };
            }
            return { value, pvBest, nodesSum, reasonsBest };
        }
    };

    // Root legal moves
    const char* movesStr = list_legal_moves(fen, nullptr, optionsJson);
    if (!movesStr){ g_json = "{\"error\":\"no-moves\"}"; return g_json.c_str(); }
    std::vector<std::string> ucis = extractUcis(std::string(movesStr));
    if (ucis.empty()){ g_json = "{\"error\":\"no-legal\"}"; return g_json.c_str(); }
    int searchDepth = std::max(1, opt.searchDepth);
    

    struct Cand{ std::string uci; double score=0.0; int base=0; int centerDelta=0; int kingImp=0; long long nodes=0; int actualPlies=0; };
    std::vector<Cand> cands; cands.reserve(ucis.size());
    double bestAdj = -1e300; bool hasBest=false; int bestIdx=-1;
    long long nodesTotal = 0;
    for (const auto &uci : ucis){
        const char* nextFen = apply_move_if_legal(fen, uci.c_str(), optionsJson);
        if (!nextFen || std::string(nextFen).find("error")!=std::string::npos) continue;
        // Evaluate subtree (engine-centric) and capture PV; also get immediate white-centric
        LineState stRoot; stRoot.rep[repKey(fen)] = 1; // include root once for this line
        ScorePV subtreeSPV = (searchDepth>1) ? search(nextFen, searchDepth-1, -1e300, 1e300, stRoot)
                     : ScorePV{ (double)engineSide * combinedScore(nextFen, rr, opt), {}, 1, {} };
        double subtree = subtreeSPV.val;
        nodesTotal += subtreeSPV.nodes;
        double rawForJson = combinedScore(nextFen, rr, opt);
        // Also compute base metrics for breakdown at root child
        int base = evaluate_fen_opts(nextFen, optionsJson);
        std::string bNext = boardPart(nextFen);
        char gNext[8][8]; for(int r=0;r<8;r++) for(int c=0;c<8;c++) gNext[r][c]='.'; buildBoardGrid(bNext, gNext);
        auto inCenter = [&](int r,int c){ return (r==4&&c==3)||(r==4&&c==4)||(r==3&&c==3)||(r==3&&c==4); };
        auto isOwn = [&](char ch){ return ch!='.' && ((rr.rootWhite && isUpper(ch)) || (!rr.rootWhite && isLower(ch))); };
        int endCenter=0; for(int r=0;r<8;r++) for(int c=0;c<8;c++) if(inCenter(r,c) && isOwn(gNext[r][c])) endCenter++;
        int kr1=-1,kc1=-1; findKing(gNext, rr.rootWhite, kr1, kc1); int endKMan = (kr1>=0? manhattanToCenter(kr1,kc1):0);
        Cand cd; cd.uci=uci; cd.score=rawForJson; cd.base=base; cd.centerDelta=(endCenter-rr.startCenter); cd.kingImp=std::max(0, rr.startKMan-endKMan); cd.nodes=subtreeSPV.nodes; cd.actualPlies = 1 + (int)subtreeSPV.pv.size();
        // Temporarily attach PV via parallel vector (store index to a side map)
        // We'll re-run PV for the chosen best below for inclusion in JSON.
        cands.push_back(cd);
        if (!hasBest || subtree>bestAdj){ hasBest=true; bestAdj=subtree; bestIdx=(int)cands.size()-1; }
    }
    if (cands.empty()){ g_json = "{\"error\":\"no-candidates\"}"; return g_json.c_str(); }
    // Simple pick (already tracked best by adjusted score). If ties matter, randomize among equals.
    int pick = bestIdx<0 ? 0 : bestIdx;
    const Cand &best = cands[pick];
    // Recompute PV and aggregated score for the chosen best move to include in JSON
    const char* bestNext = apply_move_if_legal(fen, best.uci.c_str(), optionsJson);
    LineState stBest; stBest.rep[repKey(fen)] = 1;
    ScorePV bestPV = (searchDepth>1) ? search(bestNext, searchDepth-1, -1e300, 1e300, stBest)
                                     : ScorePV{ (double)engineSide * combinedScore(bestNext, rr, opt), {}, 1, {} };
    int bestAggWhite = clampToCp((double)engineSide * bestPV.val);
    int bestImmWhite = clampToCp((double)combinedScore(bestNext, rr, opt));
    int bestActualPlies = 1 + (int)bestPV.pv.size();
    std::ostringstream out;
    out << "{\"depth\":"<< searchDepth <<",\"nodesTotal\":"<< nodesTotal <<",\"best\":{\"uci\":\""<< best.uci <<"\",\"score\":"<< bestAggWhite <<",\"imm\":"<< bestImmWhite <<",\"nodes\":"<< bestPV.nodes <<",\"actualPlies\":"<< bestActualPlies <<" ,\"pv\":[";
    for (size_t i=0;i<bestPV.pv.size();++i){ if(i) out<<","; out<<"\""<< bestPV.pv[i] <<"\""; }
    out << "],\"base\":"<< best.base <<",\"centerDelta\":"<< best.centerDelta <<",\"kingImp\":"<< best.kingImp <<"},\"candidates\":[";
    for(size_t idx=0; idx<cands.size(); ++idx){ if(idx) out<<","; out << "{\"uci\":\""<< cands[idx].uci <<"\",\"scoreImm\":"<< cands[idx].score <<",\"nodes\":"<< cands[idx].nodes <<",\"actualPlies\":"<< cands[idx].actualPlies <<"}"; }
    out << "],\"baseEval\":"<< evaluate_fen_opts(fen, optionsJson) <<"}";
    g_json = out.str();
    return g_json.c_str();
}

// Returns aggregated child scores for a root position using the current evaluation options.
// JSON shape:
// { "parent": FEN, "depth": D, "children": [ { "uci": "e2e4", "agg": <intWhiteCentipawns>, "imm": <intWhiteCentipawns> }, ... ] }
extern "C" const char* score_children(const char* fen, const char* optionsJson){
    extern const char* list_legal_moves(const char*, const char*, const char*);
    extern const char* apply_move_if_legal(const char*, const char*, const char*);
    static std::string g_json;
    if (!fen || !*fen){ g_json = "{\"error\":\"no-fen\"}"; return g_json.c_str(); }
    auto opt = parseEvalOptions(optionsJson);

    // Helper: extract all UCI strings from a JSON array of moves
    auto extractUcis = [](const std::string &s){
        std::vector<std::string> out; size_t pos=0; const std::string pat = "\"uci\":\"";
        while ((pos = s.find(pat, pos)) != std::string::npos) { size_t start = pos + pat.size(); size_t end = s.find('"', start); if (end == std::string::npos) break; out.push_back(s.substr(start, end - start)); pos = end + 1; }
        return out;
    };

    // Prepare root reference and orientation
    RootRef rr = computeRootRef(fen, opt);
    const int engineSide = rr.rootWhite ? +1 : -1;

    // Alpha-beta with proper min/max alternating in engine-centric space + extensions
    struct ScorePV { double val; std::vector<std::string> pv; long long nodes; std::vector<std::string> reasons; };
    struct LineState { std::unordered_map<std::string,int> rep; std::vector<std::string> reasons; };
    auto hasReason = [](const std::vector<std::string> &v, const char* r){ return std::find(v.begin(), v.end(), r) != v.end(); };
    auto addReason = [&](std::vector<std::string> &v, const char* r){ if (!hasReason(v, r)) v.push_back(r); };
    auto epTarget = [](const char* f){ if(!f) return std::string("-"); std::string s(f); size_t p1=s.find(' '); if(p1==std::string::npos) return std::string("-"); size_t p2=s.find(' ', p1+1); if(p2==std::string::npos) return std::string("-"); size_t p3=s.find(' ', p2+1); if(p3==std::string::npos) return std::string("-"); size_t p4=s.find(' ', p3+1); if(p4==std::string::npos) return std::string("-"); size_t p5=s.find(' ', p4+1); if(p5==std::string::npos) return s.substr(p4+1); return s.substr(p4+1, p5-(p4+1)); };
    auto repKey = [&](const char* f){ std::ostringstream k; k<< boardPart(f) <<" "<< sideToMove(f) <<" "<< castlingRights(f) <<" "<< epTarget(f); return k.str(); };
    std::function<ScorePV(const char*, int, double, double, LineState)> search;
    search = [&](const char* curFen, int depth, double alpha, double beta, LineState st)->ScorePV{
        long long nodesHere = 1;
        auto key = repKey(curFen);
        int cnt = st.rep[key];
        if (cnt >= 2){
            if (!hasReason(st.reasons, "threefold-cutoff")) st.reasons.push_back("threefold-cutoff");
            return { 0.0, {}, nodesHere, st.reasons };
        }
        st.rep[key] = cnt + 1;
        const char* jsonMoves = list_legal_moves(curFen, nullptr, optionsJson);
        std::vector<std::string> moves = jsonMoves ? extractUcis(std::string(jsonMoves)) : std::vector<std::string>{};
        if (depth<=0 || moves.empty()){
            return { (double)engineSide * combinedScore(curFen, rr, opt), {}, nodesHere, st.reasons };
        }
        bool engineToMove = ((sideToMove(curFen) == 'w') == rr.rootWhite);
        bool inCheckHere = side_in_check(curFen) != 0;
        if (engineToMove){
            double value = -1e300; std::vector<std::string> pvBest; bool progressed=false; long long nodesSum=nodesHere; std::vector<std::string> reasonsBest = st.reasons;
            for (const auto &uci : moves){
                const char* nextFen = apply_move_if_legal(curFen, uci.c_str(), optionsJson);
                if (!nextFen || std::string(nextFen).find("error")!=std::string::npos) continue;
                progressed = true;
                auto wbNow = evalMaterialWB(boardPart(curFen), opt.w);
                auto wbNext = evalMaterialWB(boardPart(nextFen), opt.w);
                int netNow = wbNow.first - wbNow.second;
                int netNext = wbNext.first - wbNext.second;
                bool matSwing = (netNow != netNext);
                int ext = 0; if (inCheckHere) ext = 1; if (matSwing) ext = std::min(1, ext + 1);
                LineState stChild = st;
                if (inCheckHere) addReason(stChild.reasons, "check-extension");
                if (matSwing) addReason(stChild.reasons, "material-swing-extension");
                auto child = search(nextFen, depth-1+ext, alpha, beta, stChild);
                nodesSum += child.nodes;
                if (child.val > value){ value = child.val; pvBest.clear(); pvBest.push_back(uci); pvBest.insert(pvBest.end(), child.pv.begin(), child.pv.end()); reasonsBest = child.reasons; }
                if (child.val > alpha) alpha = child.val;
                if (alpha >= beta) break;
            }
            if (!progressed){
                return { (double)engineSide * combinedScore(curFen, rr, opt), {}, nodesHere, st.reasons };
            }
            return { value, pvBest, nodesSum, reasonsBest };
        } else {
            double value = 1e300; std::vector<std::string> pvBest; bool progressed=false; long long nodesSum=nodesHere; std::vector<std::string> reasonsBest = st.reasons;
            for (const auto &uci : moves){
                const char* nextFen = apply_move_if_legal(curFen, uci.c_str(), optionsJson);
                if (!nextFen || std::string(nextFen).find("error")!=std::string::npos) continue;
                progressed = true;
                auto wbNow = evalMaterialWB(boardPart(curFen), opt.w);
                auto wbNext = evalMaterialWB(boardPart(nextFen), opt.w);
                int netNow = wbNow.first - wbNow.second;
                int netNext = wbNext.first - wbNext.second;
                bool matSwing = (netNow != netNext);
                int ext = 0; if (inCheckHere) ext = 1; if (matSwing) ext = std::min(1, ext + 1);
                LineState stChild = st;
                if (inCheckHere) addReason(stChild.reasons, "check-extension");
                if (matSwing) addReason(stChild.reasons, "material-swing-extension");
                auto child = search(nextFen, depth-1+ext, alpha, beta, stChild);
                nodesSum += child.nodes;
                if (child.val < value){ value = child.val; pvBest.clear(); pvBest.push_back(uci); pvBest.insert(pvBest.end(), child.pv.begin(), child.pv.end()); reasonsBest = child.reasons; }
                if (child.val < beta) beta = child.val;
                if (alpha >= beta) break;
            }
            if (!progressed){
                return { (double)engineSide * combinedScore(curFen, rr, opt), {}, nodesHere, st.reasons };
            }
            return { value, pvBest, nodesSum, reasonsBest };
        }
    };

    // Root legal moves
    const char* movesStr = list_legal_moves(fen, nullptr, optionsJson);
    if (!movesStr){ g_json = "{\"error\":\"no-moves\"}"; return g_json.c_str(); }
    std::vector<std::string> ucis = extractUcis(std::string(movesStr));
    if (ucis.empty()){ g_json = "{\"error\":\"no-legal\"}"; return g_json.c_str(); }
    int searchDepth = std::max(1, opt.searchDepth);

    std::ostringstream out;
    long long parentNodesTotal = 0;
    out << "{\"parent\":\"" << fen << "\",\"depth\":" << searchDepth << ",\"children\":[";
    bool first=true;
    for (const auto &uci : ucis){
        const char* nextFen = apply_move_if_legal(fen, uci.c_str(), optionsJson);
        if (!nextFen || std::string(nextFen).find("error")!=std::string::npos) continue;
        LineState stRoot; stRoot.rep[repKey(fen)] = 1;
        auto spv = (searchDepth>1) ? search(nextFen, searchDepth-1, -1e300, 1e300, stRoot)
                       : ScorePV{ (double)engineSide * combinedScore(nextFen, rr, opt), {}, 1, {} };
        parentNodesTotal += spv.nodes;
        int aggWhite = clampToCp((double)engineSide * spv.val);
        int immWhite = clampToCp((double)combinedScore(nextFen, rr, opt));
        int actualPlies = 1 + (int)spv.pv.size();
        // Compute simple breakdown terms for debug visibility at root child
        int base = evaluate_fen_opts(nextFen, optionsJson);
        std::string bNext = boardPart(nextFen);
        char gNext[8][8]; for(int r=0;r<8;r++) for(int c=0;c<8;c++) gNext[r][c]='.'; buildBoardGrid(bNext, gNext);
        auto inCenter = [&](int r,int c){ return (r==4&&c==3)||(r==4&&c==4)||(r==3&&c==3)||(r==3&&c==4); };
        auto isOwn = [&](char ch){ return ch!='.' && ((rr.rootWhite && isUpper(ch)) || (!rr.rootWhite && isLower(ch))); };
        int endCenter=0; for(int r=0;r<8;r++) for(int c=0;c<8;c++) if(inCenter(r,c) && isOwn(gNext[r][c])) endCenter++;
        int kr1=-1,kc1=-1; findKing(gNext, rr.rootWhite, kr1, kc1); int endKMan = (kr1>=0? manhattanToCenter(kr1,kc1):0);
        int centerDelta = (endCenter - rr.startCenter);
        int kingImp = std::max(0, rr.startKMan - endKMan);
        // Material breakdown for diagnostics
        auto wbMat = evalMaterialWB(bNext, opt.w);
        int tempoTerm = 0; if (opt.t.tempo){ tempoTerm = (sideToMove(nextFen)=='w' ? opt.tempo : -opt.tempo); }
        if (!first) out << ","; first=false;
        out << "{\"uci\":\""<< uci <<"\",\"agg\":"<< aggWhite <<",\"imm\":"<< immWhite
            << ",\"dbg\":{\"base\":"<< base <<",\"centerDelta\":"<< centerDelta <<",\"kingImp\":"<< kingImp
            << ",\"matW\":"<< wbMat.first <<",\"matB\":"<< wbMat.second <<",\"tempo\":"<< tempoTerm
            << ",\"rootWhite\":"<< (rr.rootWhite?1:0) <<"}"
            << ",\"nodes\":"<< spv.nodes <<",\"actualPlies\":"<< actualPlies <<",\"continuationReasons\":";
        // Continuation reasons
        out << "["; for (size_t i=0;i<spv.reasons.size();++i){ if(i) out<<","; out << "\""<< spv.reasons[i] <<"\""; } out << "]"
            << ",\"fen\":\""<< nextFen <<"\",\"pv\":[";
        // Include full PV starting with this child (add child uci + continuation)
        out << "\""<< uci <<"\"";
        for (size_t i=0;i<spv.pv.size();++i){ out << ",\""<< spv.pv[i] <<"\""; }
        out << "]}";
    }
    out << "],\"nodes\":"<< parentNodesTotal <<"}";
    g_json = out.str();
    return g_json.c_str();
}
