#include "engine.h"
#include <iostream>
#include <vector>
#include <string>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <cmath>

extern "C" const char* list_legal_moves(const char* fen, const char* fromSqOrNull, const char* optionsJson);
extern "C" const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson);
extern "C" int evaluate_fen_opts(const char* fen, const char* optionsJson);

static std::vector<std::string> extract_ucis(const char* json){
    std::vector<std::string> out; if (!json) return out; std::string s(json);
    const std::string pat = "\"uci\":\""; size_t pos=0; while ((pos=s.find(pat,pos))!=std::string::npos){ size_t st=pos+pat.size(); size_t en=s.find('"', st); if (en==std::string::npos) break; out.push_back(s.substr(st, en-st)); pos=en+1; }
    return out;
}

// Minimal board parse helpers to mirror engine combined score
static std::string board_part(const char* fen){ if(!fen) return {}; std::string s(fen); auto sp=s.find(' '); return (sp==std::string::npos)?s:s.substr(0,sp); }
static char stm_of(const char* fen){ if(!fen) return 'w'; std::string s(fen); auto sp=s.find(' '); if(sp==std::string::npos) return 'w'; return s[sp+1]; }
static std::string castling_rights(const char* fen){ if(!fen) return "-"; std::string s(fen); size_t p1=s.find(' '); if(p1==std::string::npos) return "-"; size_t p2=s.find(' ', p1+1); if(p2==std::string::npos) return "-"; size_t p3=s.find(' ', p2+1); if(p3==std::string::npos) return "-"; return s.substr(p2+1, p3-(p2+1)); }
static void build_grid(const std::string &bp, char g[8][8]){ for(int r=0;r<8;r++) for(int c=0;c<8;c++) g[r][c]='.'; int r=0,c=0; for(char ch: bp){ if(ch=='/'){ r++; c=0; continue; } if(std::isdigit((unsigned char)ch)){ c += (ch-'0'); } else { if(r>=0&&r<8&&c>=0&&c<8) g[r][c]=ch; c++; } } }
static bool isU(char c){ return std::isupper((unsigned char)c)!=0; } static bool isL(char c){ return std::islower((unsigned char)c)!=0; }
static int manh(int r,int c){ int best=99; int T[4][2]={{3,3},{3,4},{4,3},{4,4}}; for(auto &t:T){ int d=std::abs(t[0]-r)+std::abs(t[1]-c); if(d<best) best=d; } return best==99?0:best; }
static void findKing(char g[8][8], bool white, int &kr, int &kc){ char t=white?'K':'k'; for(int i=0;i<8;i++) for(int j=0;j<8;j++) if(g[i][j]==t){ kr=i; kc=j; return; } kr=-1; kc=-1; }
static int oppStrength(char g[8][8], bool oppIsWhite){ int n=0,b=0,r=0,q=0; for(int i=0;i<8;i++) for(int j=0;j<8;j++){ char ch=g[i][j]; if(!ch||ch=='.') continue; bool opp = oppIsWhite?isU(ch):isL(ch); if(opp){ char lc=(char)std::tolower((unsigned char)ch); if(lc=='n') n++; else if(lc=='b') b++; else if(lc=='r') r++; else if(lc=='q') q++; } } return 3*(n+b)+5*r+9*q; }
static double endg(char g[8][8], bool oppIsWhite){ const int T=31,L=6; int S=oppStrength(g,oppIsWhite); double x=(double)(T-S)/std::max(1,(T-L)); if(x<0)x=0; if(x>1)x=1; return x; }

// Development/forward control: count squares controlled in opponent's half
static bool inB(int r,int c){ return r>=0&&r<8&&c>=0&&c<8; }
static void markRay(char g[8][8], bool ctrl[8][8], int r,int c,int dr,int dc, bool countThroughFriends){
    int i=r+dr, j=c+dc;
    while(inB(i,j)){
        ctrl[i][j]=true;
        if(g[i][j] != '.'){
            // stop at first blocker
            break;
        }
        i+=dr; j+=dc;
    }
}
static void addControls(char g[8][8], bool whiteSide, bool ctrl[8][8]){
    for(int r=0;r<8;r++){
        for(int c=0;c<8;c++){
            char ch=g[r][c]; if(ch=='.') continue;
            bool own = whiteSide? isU(ch) : isL(ch); if(!own) continue;
            char lc=(char)std::tolower((unsigned char)ch);
            if(lc=='p'){
                int dr = whiteSide? -1: +1;
                if(inB(r+dr,c-1)) ctrl[r+dr][c-1]=true;
                if(inB(r+dr,c+1)) ctrl[r+dr][c+1]=true;
            } else if(lc=='n'){
                static const int K[8][2]={{-2,-1},{-2,1},{-1,-2},{-1,2},{1,-2},{1,2},{2,-1},{2,1}};
                for(auto &d:K){ int i=r+d[0], j=c+d[1]; if(inB(i,j)) ctrl[i][j]=true; }
            } else if(lc=='k'){
                for(int dr=-1;dr<=1;dr++) for(int dc=-1;dc<=1;dc++){ if(!dr&&!dc) continue; int i=r+dr,j=c+dc; if(inB(i,j)) ctrl[i][j]=true; }
            } else if(lc=='b' || lc=='q'){
                markRay(g,ctrl,r,c,-1,-1,false); markRay(g,ctrl,r,c,-1,1,false);
                markRay(g,ctrl,r,c,1,-1,false);  markRay(g,ctrl,r,c,1,1,false);
            }
            if(lc=='r' || lc=='q'){
                markRay(g,ctrl,r,c,-1,0,false); markRay(g,ctrl,r,c,1,0,false);
                markRay(g,ctrl,r,c,0,-1,false); markRay(g,ctrl,r,c,0,1,false);
            }
        }
    }
}
static double development_control_score(char g[8][8], bool engineWhite, double devIncentive, double rankAttackFactor, bool countThreatOccupied){
    bool ctrl[8][8]={false};
    addControls(g, engineWhite, ctrl);
    double sum=0.0;
    // Opponent half: for white engine => rows 0..3; for black => rows 4..7
    for(int r=0;r<8;r++){
        for(int c=0;c<8;c++){
            bool inOppHalf = engineWhite? (r<=3) : (r>=4);
            if(!inOppHalf) continue;
            if(!ctrl[r][c]) continue;
            if(!countThreatOccupied && g[r][c] != '.') continue;
            int rdepth = engineWhite? (4 - r) : (r - 3); // 1..4
            if(rdepth<1) rdepth=1; if(rdepth>4) rdepth=4;
            sum += devIncentive * std::pow(rankAttackFactor, (double)rdepth);
        }
    }
    return sum;
}

struct RootRef { bool white=true; int startCenter=0; int startKMan=0; int startKR=-1, startKC=-1; int oppStartKR=-1, oppStartKC=-1; std::string startRights; };
static RootRef root_ref(const char* fen){ RootRef rr; rr.white = (stm_of(fen)=='w'); std::string bp = board_part(fen); char g[8][8]; build_grid(bp,g); auto own=[&](char ch){ return ch!='.' && ((rr.white && isU(ch)) || (!rr.white && isL(ch))); }; auto inC=[&](int r,int c){ return (r==3&&c==3)||(r==3&&c==4)||(r==4&&c==3)||(r==4&&c==4); }; for(int r=0;r<8;r++) for(int c=0;c<8;c++) if(inC(r,c)&&own(g[r][c])) rr.startCenter++; int kr=-1,kc=-1; findKing(g, rr.white, kr, kc); rr.startKR=kr; rr.startKC=kc; rr.startKMan = (kr>=0? manh(kr,kc):0); int okr=-1,okc=-1; findKing(g, !rr.white, okr, okc); rr.oppStartKR=okr; rr.oppStartKC=okc; rr.startRights = castling_rights(fen); return rr; }

static double combined_score(const char* fen, const RootRef& rr, int centerReward, int kingMagnet, const char* evalOpts,
                             double devIncentive, double rankAttackFactor, bool countThreatOccupied,
                             double startDevScore,
                             int castleKReward, int castleQReward, int kingNonCastlePenalty){
    int base = evaluate_fen_opts(fen, evalOpts);
    std::string bp = board_part(fen); char g[8][8]; build_grid(bp,g);
    auto own=[&](char ch){ return ch!='.' && ((rr.white && isU(ch)) || (!rr.white && isL(ch))); };
    auto inC=[&](int r,int c){ return (r==3&&c==3)||(r==3&&c==4)||(r==4&&c==3)||(r==4&&c==4); };
    int center=0; for(int r=0;r<8;r++) for(int c=0;c<8;c++) if(inC(r,c)&&own(g[r][c])) center++;
    int kr=-1,kc=-1; findKing(g, rr.white, kr, kc); int kMan = (kr>=0? manh(kr,kc):0);
    double eg = endg(g, !rr.white);
    double geom = (double)centerReward * (center-rr.startCenter) + (double)kingMagnet * std::max(0, rr.startKMan - kMan) * eg;
    // Development: net gain of controlled squares in opponent half since root
    double devNow = development_control_score(g, rr.white, devIncentive, rankAttackFactor, countThreatOccupied);
    double devDelta = devNow - startDevScore;
    // Castling/king term (mirror of engine combinedScore white-centric)
    auto rightsNow = castling_rights(fen);
    auto isCastledK = [&](bool white)->bool{
        int r=-1,c=-1; findKing(g, white, r, c);
        if (white){ if (r!=7 || c!=6) return false; return g[7][5]=='R'; }
        else { if (r!=0 || c!=6) return false; return g[0][5]=='r'; }
    };
    auto isCastledQ = [&](bool white)->bool{
        int r=-1,c=-1; findKing(g, white, r, c);
        if (white){ if (r!=7 || c!=2) return false; return g[7][3]=='R'; }
        else { if (r!=0 || c!=2) return false; return g[0][3]=='r'; }
    };
    auto kingMovedNonCastle = [&](bool white, int startR, int startC)->bool{
        int homeR = white? 7:0; int homeC = 4; if (startR!=homeR || startC!=homeC) return false; int r=-1,c=-1; findKing(g, white, r, c); if (r==homeR && c==homeC) return false; if ((r==(white?7:0) && (c==6 || c==2))) return false; return true; };
    auto hadRight = [&](bool white, bool kingSide){ char flag = white? (kingSide?'K':'Q') : (kingSide?'k':'q'); return rr.startRights.find(flag)!=std::string::npos; };
    auto hasRightNow = [&](bool white, bool kingSide){ char flag = white? (kingSide?'K':'Q') : (kingSide?'k':'q'); return rightsNow.find(flag)!=std::string::npos; };
    double castleKingTerm = 0.0;
    if (castleKReward!=0 || castleQReward!=0 || kingNonCastlePenalty!=0){
        if (isCastledK(rr.white)) castleKingTerm += (double)castleKReward;
        if (isCastledQ(rr.white)) castleKingTerm += (double)castleQReward;
        if (kingNonCastlePenalty>0 && kingMovedNonCastle(rr.white, rr.startKR, rr.startKC)) castleKingTerm -= (double)kingNonCastlePenalty;
        if (hadRight(rr.white, true) && !hasRightNow(rr.white, true)){
            if (!isCastledK(rr.white) && !kingMovedNonCastle(rr.white, rr.startKR, rr.startKC)) castleKingTerm -= (double)castleKReward;
        }
        if (hadRight(rr.white, false) && !hasRightNow(rr.white, false)){
            if (!isCastledQ(rr.white) && !kingMovedNonCastle(rr.white, rr.startKR, rr.startKC)) castleKingTerm -= (double)castleQReward;
        }
        if (isCastledK(!rr.white)) castleKingTerm -= (double)castleKReward;
        if (isCastledQ(!rr.white)) castleKingTerm -= (double)castleQReward;
        if (kingNonCastlePenalty>0 && kingMovedNonCastle(!rr.white, rr.oppStartKR, rr.oppStartKC)) castleKingTerm += (double)kingNonCastlePenalty;
        if (hadRight(!rr.white, true) && !hasRightNow(!rr.white, true)){
            if (!isCastledK(!rr.white) && !kingMovedNonCastle(!rr.white, rr.oppStartKR, rr.oppStartKC)) castleKingTerm += (double)castleKReward;
        }
        if (hadRight(!rr.white, false) && !hasRightNow(!rr.white, false)){
            if (!isCastledQ(!rr.white) && !kingMovedNonCastle(!rr.white, rr.oppStartKR, rr.oppStartKC)) castleKingTerm += (double)castleQReward;
        }
    }
    int engineSideLocal = rr.white ? +1 : -1;
    // Convert engine-centric terms to white-centric using engine side
    return (double)base + engineSideLocal * (geom + devDelta + castleKingTerm);
}

int main(int argc, char** argv){
    const char* fen = (argc>1 && std::strlen(argv[1])>0) ? argv[1] : "r1bqkbnr/pppppppp/2n5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2";
    int depth = (argc>2) ? std::max(1, std::atoi(argv[2])) : 2;
    int centerReward = 50; int kingMagnet = 15;
    int castleKReward = 60; int castleQReward = 60; int kingNonCastlePenalty = 100;
    double devIncentive = 10.0; double rankAttackFactor = 1.1; bool countThreatOccupied = true;
    // evalOpts JSON passes only base eval knobs (weights/terms/tempo)
    const char* evalOpts = "{\"weights\":{\"p\":100,\"n\":300,\"b\":300,\"r\":500,\"q\":900,\"k\":0},\"terms\":{\"material\":true,\"tempo\":false},\"tempo\":10,\"castleKingSideReward\":60,\"castleQueenSideReward\":60,\"kingNonCastleMovePenalty\":100}";
    const char* genOpts = "{\"includeCastling\":true,\"castleSafety\":true}";

    RootRef rr = root_ref(fen);
    bool rootMax = (stm_of(fen)=='w');
    // Precompute root development score for delta
    {
        std::string bp0 = board_part(fen); char g0[8][8]; build_grid(bp0,g0);
        // store in a captured variable below via lambda default init hack
    }
    auto children = extract_ucis(list_legal_moves(fen, nullptr, genOpts));
    std::cout << "Parent: " << fen << "\nDepth: " << depth << "\nChildren: " << children.size() << "\n";

    // DFS with minimax value and leaf dumps
    // Compute root development score once
    std::string bpRoot = board_part(fen); char gRoot[8][8]; build_grid(bpRoot,gRoot);
    double rootDev = development_control_score(gRoot, rr.white, devIncentive, rankAttackFactor, countThreatOccupied);

    std::function<double(const char*,int,bool,std::vector<std::string>&)> dfs;
    dfs = [&](const char* cur, int dleft, bool maxFor, std::vector<std::string>& path)->double{
        if (dleft<=0){
            double sc = combined_score(cur, rr, centerReward, kingMagnet, evalOpts,
                                       devIncentive, rankAttackFactor, countThreatOccupied, rootDev,
                                       castleKReward, castleQReward, kingNonCastlePenalty);
            std::cout << "  " << (path.empty()?"<root>":"");
            for (auto &m : path) std::cout << m << ' ';
            std::cout << "=> " << (sc/100.0) << "\n";
            return sc;
        }
        auto ms = extract_ucis(list_legal_moves(cur, nullptr, genOpts));
        if (ms.empty()){
            double sc = combined_score(cur, rr, centerReward, kingMagnet, evalOpts,
                                       devIncentive, rankAttackFactor, countThreatOccupied, rootDev,
                                       castleKReward, castleQReward, kingNonCastlePenalty);
            std::cout << "  (terminal) "; for (auto &m : path) std::cout << m << ' '; std::cout << "; => " << (sc/100.0) << "\n";
            return sc;
        }
        double best = maxFor? -1e300 : 1e300;
        for (auto &u : ms){
            const char* next = apply_move_if_legal(cur, u.c_str(), genOpts);
            if (!next || std::string(next).find("error")!=std::string::npos) continue;
            path.push_back(u);
            double v = dfs(next, dleft-1, !maxFor, path);
            path.pop_back();
            if (maxFor){ if (v>best) best=v; } else { if (v<best) best=v; }
        }
        return best;
    };

    for (auto &uci : children){
        const char* next = apply_move_if_legal(fen, uci.c_str(), genOpts);
        if (!next || std::string(next).find("error")!=std::string::npos) continue;
        std::vector<std::string> p; p.push_back(uci);
    double best = depth>1 ? dfs(next, depth-1, !rootMax, p) : combined_score(next, rr, centerReward, kingMagnet, evalOpts,
                                        devIncentive, rankAttackFactor, countThreatOccupied, rootDev,
                                        castleKReward, castleQReward, kingNonCastlePenalty);
        std::cout << "Child " << uci << ": best=" << (best/100.0) << "\n";
    }
    return 0;
}
