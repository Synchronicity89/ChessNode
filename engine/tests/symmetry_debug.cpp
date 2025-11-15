#include "engine.h"
#include <iostream>
#include <vector>
#include <string>
#include <sstream>
#include <cctype>
#include <set>

extern "C" {
    const char* list_legal_moves(const char* fen, const char* fromSqOrNull, const char* optionsJson);
}

static std::string rotateAndSwap(const std::string &placement){
    std::vector<char> squares(64,'.'); std::vector<std::string> ranks; std::string tmp; for(char ch: placement){ if(ch=='/'){ ranks.push_back(tmp); tmp.clear(); } else tmp.push_back(ch); } ranks.push_back(tmp);
    if(ranks.size()!=8) return std::string();
    for(int r=0;r<8;r++){ int f=0; for(char ch: ranks[r]){ if(std::isdigit((unsigned char)ch)){ int n=ch-'0'; for(int k=0;k<n;k++){ squares[r*8+f]='.'; f++; } } else { squares[r*8+f]=ch; f++; } } if(f!=8) return std::string(); }
    std::vector<char> out(64,'.'); for(int i=0;i<64;i++){ char p=squares[i]; int j=63-i; if(p!='.') p = std::isupper((unsigned char)p)? std::tolower((unsigned char)p): std::toupper((unsigned char)p); out[j]=p; }
    std::string res; for(int r=0;r<8;r++){ int empty=0; for(int c=0;c<8;c++){ char p=out[r*8+c]; if(p=='.'){ empty++; } else { if(empty){ res+=char('0'+empty); empty=0; } res+=p; } } if(empty) res+=char('0'+empty); if(r!=7) res+='/'; }
    return res;
}
static char flipSide(char s){ return s=='w'?'b':'w'; }
static std::string flipCast(const std::string &c){ if(c=="-") return c; bool wK=false,wQ=false,bK=false,bQ=false; for(char ch: c){ if(ch=='K') bK=true; else if(ch=='Q') bQ=true; else if(ch=='k') wK=true; else if(ch=='q') wQ=true; } std::string out; if(wK) out+='K'; if(wQ) out+='Q'; if(bK) out+='k'; if(bQ) out+='q'; if(out.empty()) out="-"; return out; }
static std::string flipEP(const std::string &ep){ if(ep.size()!=2) return std::string("-"); char f=ep[0], r=ep[1]; if(f<'a'||f>'h'||r<'1'||r>'8') return std::string("-"); int fi=f-'a', ri=r-'1'; int nfi=7-fi, nri=7-ri; return std::string()+char('a'+nfi)+char('1'+nri); }
static std::string flipFen(const std::string &fen){ std::istringstream ss(fen); std::string p,s,c,e,h,fn; if(!(ss>>p>>s>>c>>e>>h>>fn)) return std::string(); std::string np=rotateAndSwap(p); if(np.empty()) return std::string(); std::ostringstream out; out<<np<<" "<<flipSide(s[0])<<" "<<flipCast(c)<<" "<<flipEP(e)<<" "<<h<<" "<<fn; return out.str(); }

static std::vector<std::string> extractMoves(const char* json){ std::vector<std::string> out; if(!json) return out; std::string s(json); size_t pos=0; const std::string key="\"uci\":\""; while((pos=s.find(key,pos))!=std::string::npos){ pos+=key.size(); size_t end=s.find('"',pos); if(end==std::string::npos) break; out.push_back(s.substr(pos,end-pos)); pos=end+1; } return out; }

int main(){
    std::vector<std::string> fens = {
        // Openings (1-15)
        "rnbqkbnr/ppp1pppp/8/3p4/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq d6 0 3",
        "rnbqkbnr/pp1ppppp/2p5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 2",
        "rnbqk1nr/ppp2ppp/3b4/3pp3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 4 5",
        "r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/2N5/PPP2PPP/R1BQKBNR w KQkq - 3 4",
        "rnbqk2r/pppp1ppp/5n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 4",
        "r1bqkbnr/pppppppp/2n5/8/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq - 2 3",
        "rnbq1bnr/pp1pkppp/2p5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R w KQ - 2 5",
        "rnbqkbnr/pppp1ppp/8/4p3/1PPP4/8/P3PPPP/RNBQKBNR b KQkq c3 0 3",
        "r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq - 2 3",
        "rnbqkb1r/pp2pppp/2p2n2/3p4/3P4/2N1PN2/PPP2PPP/R1BQKB1R w KQkq d6 0 4",
        "rnbqkbnr/pp2pppp/2p5/3p4/3P4/4PN2/PPP2PPP/RNBQKB1R w KQkq - 2 4",
        "r1b1kbnr/pppp1ppp/2nq4/4p3/3PP3/2N5/PPP2PPP/R1BQKBNR w KQkq - 5 5",
        "rnbqkbnr/ppp2ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R b KQkq - 2 4",
        "rnb1kbnr/ppp1qppp/8/3pp3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 4 5",
        "r1bqkbnr/pppppppp/2n5/8/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3 0 2",
        // Middlegames (16-40)
        "r1bq1rk1/ppp2ppp/2n1pn2/3p4/3P1B2/2N1PN2/PPP2PPP/R2QKB1R w KQ - 6 8",
        "r2q1rk1/pppb1ppp/2n1pn2/3p4/3P4/2N1PN2/PPPB1PPP/R2Q1RK1 b - - 7 9",
        "r1bq1rk1/pp2nppp/2pp1n2/8/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 6 10",
        "r2q1rk1/pp3ppp/2pb1n2/3p4/3P1B2/2P1PN2/PP3PPP/R2Q1RK1 w - - 7 12",
        "r1bq1rk1/p1pp1ppp/1pn2n2/3p4/3P1B2/2N1PN2/PPPQ1PPP/R3KB1R b KQ - 4 9",
        "r2q1rk1/1b1nbppp/p1n1p3/1ppp4/3P4/1PN1PN2/PB1QBPPP/R3K2R w KQ - 4 12",
        "2rq1rk1/1b1nbppp/p1n1p3/1ppp4/3P1B2/1PN1PN2/PB1Q1PPP/2R2RK1 w - - 8 14",
        "r1b2rk1/pp1n1ppp/2pq1n2/3p4/3P1B2/2NBPN2/PPQ2PPP/2KR3R w - - 8 14",
        "2r2rk1/pp1n1ppp/2pq1n2/3p4/3P1B2/2NBPN2/PPQ2PPP/2KR4 b - - 9 15",
        "r1b2rk1/p2nqppp/1pp1pn2/3p4/3P1B2/2NBPN2/PPQ2PPP/2KR3R w - - 9 14",
        "r1b2rk1/pp1n1ppp/2pq4/3p1n2/3P1B2/2NBPN2/PPQ2PPP/2KR3R w - - 10 15",
        "r1b2rk1/pp1n1pp1/2pq3p/3p1n2/3P1B2/2NBPN2/PPQ2PPP/2KR3R w - - 11 16",
        "r1b2rk1/pp1n1pp1/2pq3p/3p1n2/3P1B2/1PNBPN2/P1Q2PPP/2KR3R b - - 12 16",
        "r1b2rk1/1p1n1pp1/p1pq3p/3p1n2/3P1B2/1PNBPN2/P1Q2PPP/2KR3R w - - 13 17",
        "r4rk1/1pb2pp1/p1pq3p/3p1n2/3P1B2/1PNBPN2/P1Q2PPP/2KR3R w - - 15 18",
        "r4rk1/1pb2pp1/p1p4p/3pqn2/3P1B2/1PNBPN2/P1Q2PPP/2KR3R w - - 16 19",
        "1r3rk1/1pb2pp1/p1p4p/3pqn2/3P1B2/1PNBPN2/P1Q2PPP/2KR3R w - - 17 20",
        "1r3rk1/1pb2pp1/p1pq3p/3p1n2/3P1B2/1PNBPN2/P1Q2PPP/2KR3R w - - 18 20",
        "2r3k1/1pb2pp1/p1pq1r1p/3p1n2/3P1B2/1PN1PN2/P1Q2PPP/2KR4 w - - 19 21",
        "2r3k1/1pb2pp1/p1pq1r1p/3p1n2/3P1B2/1PN1PN2/P1QB1PPP/2KR4 w - - 20 21",
        "2r3k1/1pb2pp1/p1p2r1p/3pq3/3P1nB1/1PN1PN2/P1QB1PPP/2KR4 w - - 21 22",
        "2r3k1/1pb2pp1/p1p2r1p/3pqn2/3P1nB1/1PQ1PN2/P1N2PPP/2KR4 w - - 22 23",
        "2r3k1/1pb2pp1/p1p2r1p/3pqn2/3P1nB1/1PQ1PN2/P1N2PPP/2K1R3 b - - 23 23",
        "2r3k1/1pb2pp1/p1p2r1p/3pqn2/3P1nB1/1PQ1PN2/P1N2PPP/3KR3 w - - 24 24",
        "2r3k1/1pb2pp1/p1p2r1p/3pqn2/3P1nB1/1PQ1PN2/P1N2PPP/3KR3 b - - 25 24",
        // Endgames (41-55)
        "8/8/8/4k3/4P3/4K3/8/8 w - - 0 40",
        "8/8/8/4k3/4P3/5K2/8/8 b - - 0 40",
        "8/8/8/3k4/8/1K6/8/8 w - - 0 41",
        "8/8/8/3k4/3P4/1K6/8/8 b - - 0 42",
        "8/8/4k3/8/4P3/5K2/8/8 w - - 0 50",
        "8/8/4k3/8/8/5K2/4P3/8 b - - 0 51",
        "8/8/8/8/1k6/2P5/8/1K6 w - - 0 52",
        "8/8/8/8/1k6/2P5/8/1K6 b - - 0 52",
        "8/8/8/8/1k6/8/2P5/1K6 w - - 0 53",
        "8/8/8/8/8/1k6/2P5/1K6 w - - 0 54",
        "8/8/3k4/3P4/8/8/8/3K4 w - - 0 55",
        "8/8/3k4/3P4/8/8/8/3K4 b - - 0 55",
        "6k1/5pp1/8/6P1/8/8/5K2/8 w - - 0 58",
        "6k1/5pp1/8/6P1/8/8/5K2/8 b - - 0 58",
        "8/5k2/8/5P2/4K3/8/8/8 w - - 0 60",
        // Special rights (56-59)
        "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR b KQkq e6 0 3",
        "r1bqk2r/ppp1bppp/2np1n2/8/2BPp3/2N5/PPP2PPP/R1BQ1RK1 w kq e6 0 8",
        "r3k2r/pppq1ppp/2n1pn2/3p4/3P4/2N1PN2/PPPQ1PPP/R3K2R w KQkq d6 0 10",
        "r3k2r/pppq1ppp/2n1pn2/3p4/3P4/2N1PN2/PPPQ1PPP/R3K2R b kq d3 0 10",
        // Mate-in-1 (60 corrected)
        "6k1/5pp1/8/8/8/6P1/5P2/6KQ w - - 0 1"
    };

    std::vector<int> targets = {5,16,21,58,59,60};

    for(int idx : targets){ if(idx<1 || idx>(int)fens.size()) continue; std::string fen = fens[idx-1]; std::string flip = flipFen(fen); std::cout << "Index "<<idx<<"\nFEN: "<<fen<<"\nFlip: "<<flip<<"\n"; const char* jA = list_legal_moves(fen.c_str(), nullptr, "{}"); const char* jB = list_legal_moves(flip.c_str(), nullptr, "{}"); auto movesA = extractMoves(jA); auto movesB = extractMoves(jB); std::set<std::string> setA(movesA.begin(), movesA.end()); std::set<std::string> setB(movesB.begin(), movesB.end()); std::cout << "Original count="<<movesA.size()<<" Flipped count="<<movesB.size()<<"\n"; std::cout << "Only in original:"; for(auto &m : setA){ if(!setB.count(m)) std::cout << " "<<m; } std::cout << "\nOnly in flipped:"; for(auto &m : setB){ if(!setA.count(m)) std::cout << " "<<m; } std::cout << "\nCastling moves original:"; for(auto &m : movesA){ if(m.find("O-O")!=std::string::npos || m.find("e1g1")!=std::string::npos || m.find("e1c1")!=std::string::npos || m.find("e8g8")!=std::string::npos || m.find("e8c8")!=std::string::npos) std::cout << " "<<m; } std::cout << "\nCastling moves flipped:"; for(auto &m : movesB){ if(m.find("O-O")!=std::string::npos || m.find("e1g1")!=std::string::npos || m.find("e1c1")!=std::string::npos || m.find("e8g8")!=std::string::npos || m.find("e8c8")!=std::string::npos) std::cout << " "<<m; } std::cout << "\n---\n"; }
}
