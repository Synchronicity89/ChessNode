#include "engine.h"
#include <iostream>
#include <cstring>
#include <cstdlib>
#include <vector>
#include <string>
#include <sstream>
#include <cctype>

static int failures = 0;

// Forward declarations for regression
int depth2_knight_blunder_regression();

void assert_eq(const char* name, int got, int expected) {
    if (got != expected) {
        std::cerr << "FAIL: " << name << " got=" << got << " expected=" << expected << std::endl;
        failures++;
    }
}

int main() {
    // Seed PRNG to make any tie-breakers in choose_best_move deterministic for tests
    std::srand(1);
    assert_eq("engine_version", engine_version(), 1);
    // Empty board
    assert_eq("eval empty", evaluate_fen("8/8/8/8/8/8/8/8 w - - 0 1"), 0);
    // Start position (material balanced)
    assert_eq("eval start", evaluate_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), 0);
    // White extra queen
    int eq = evaluate_fen("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKQNR w KQkq - 0 1");
    if (eq <= 0) {
        std::cerr << "FAIL: eval extra white queen should be > 0, got=" << eq << std::endl;
        failures++;
    }

    if (failures) return 1;
    // Basic descendant generation sanity (depth 1 start position)
    const char* json = generate_descendants("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 1, 0);
    if (!json || std::strlen(json)==0 || std::string(json).find("\"nodes\":") == std::string::npos) {
        std::cerr << "FAIL: generate_descendants returned invalid JSON" << std::endl; failures++; }
    // Expect at least 20 pseudo moves from start position ply1
    if (json) {
        auto s = std::string(json); auto pos = s.find("\"totalNodes\":");
        if (pos!=std::string::npos){ int val = std::atoi(s.c_str()+pos+13); if(val < 20){ std::cerr<<"FAIL: totalNodes="<<val<<" too small"<<std::endl; failures++; }}
        // Ensure root FEN is not present as a node entry (generator should not include root)
        const char* rootFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        std::string needle = std::string("\"fen\":\"") + rootFen + "\"";
        if (s.find(needle) != std::string::npos) { std::cerr << "FAIL: root FEN appears in nodes list" << std::endl; failures++; }
        if (s.find("\"d\":0") != std::string::npos) { std::cerr << "FAIL: node with d=0 (root) present in nodes list" << std::endl; failures++; }
    }

    // Extended options: disable castling should remove 4 king moves (start position has theoretical castling targets K/Q)
    const char* json2 = generate_descendants_opts("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 1, 0, "{\"includeCastling\":false}");
    if (!json2 || std::string(json2).find("error")!=std::string::npos){ std::cerr << "FAIL: options variant returned error"<<std::endl; failures++; }
    if (json2){
        std::string s(json2);
        size_t castPos = s.find("7 6 w"); // short castle target square for white king (approx substring of FEN) -- crude detection
        if (castPos != std::string::npos){ std::cerr << "FAIL: castling move present despite includeCastling=false" << std::endl; failures++; }
    }

    // Castle safety: with safety enabled, artificially attack path to block castling
    // Position: add a black rook attacking f1 and g1 squares to invalidate king-side castling
    const char* unsafeCastleFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQK1NR w KQkq - 0 1"; // remove white bishop from f1
    // Inject a black rook on f3 to attack f1 path; ensure f1 and g1 are empty so path is clear when safety is disabled
    const char* attackFen = "rnbqkbnr/pppppppp/8/8/8/5r2/PPPPP1PP/RNBQK2R w KQkq - 0 1"; // f1,g1 empty; f2 cleared so rook on f3 attacks f1 path
    const char* jsonSafe = generate_descendants_opts(attackFen, 1, 0, "{\"includeCastling\":true,\"castleSafety\":true}");
    if (!jsonSafe){ std::cerr<<"FAIL: castleSafety generation failed"<<std::endl; failures++; }
    if (jsonSafe){
        std::string s(jsonSafe);
        // Detect presence of the FEN pattern after white K-side castling: last rank RNBQ1RK1, side to move black
        if (s.find("/RNBQ1RK1 b ") != std::string::npos){ std::cerr<<"FAIL: unsafe king-side castling not filtered"<<std::endl; failures++; }
    }
    const char* jsonUnsafe = generate_descendants_opts(attackFen, 1, 0, "{\"includeCastling\":true,\"castleSafety\":false}");
    if (jsonUnsafe){
        std::string s(jsonUnsafe);
        // Should allow castle when safety disabled. Detect FEN with castled rank and side-to-move black.
        if (s.find("/RNBQ1RK1 b ") == std::string::npos){ std::cerr<<"FAIL: castling move missing when safety disabled"<<std::endl; failures++; }
    }

    // Promotions subset: only 'q' allowed for a position with a promoting move
    const char* json3 = generate_descendants_opts("8/P7/8/8/8/8/8/k6K w - - 0 1", 1, 0, "{\"promotions\":\"q\"}");
    if (!json3){ std::cerr<<"FAIL: promotion subset generation failed"<<std::endl; failures++; }
    if (json3){
        std::string s(json3);
        // Should not contain 'n' promotion piece uppercase in resulting FEN list
        if (s.find("N8")!=std::string::npos){ std::cerr<<"FAIL: unexpected knight promotion present"<<std::endl; failures++; }
        // And still should not contain the root as a node
        if (s.find("\"fen\":\"8/P7/8/8/8/8/8/k6K w - - 0 1\"") != std::string::npos){ std::cerr<<"FAIL: root FEN appears in nodes for promotions test"<<std::endl; failures++; }
    }

    // --- Targeted legality and castling tests using apply_move_if_legal ---
    auto apply_expect_ok = [&](const char* name, const char* fen, const char* uci, const char* opts, bool expectOk){
        const char* res = apply_move_if_legal(fen, uci, opts);
        bool ok = false;
        if (res && std::strlen(res)>0) {
            std::string out(res);
            ok = out.find("error") == std::string::npos; // treat any JSON with "error" as failure
        }
        if (ok != expectOk) {
            std::cerr << "FAIL: " << name << " applying " << uci << " on FEN=\n  " << fen
                      << "\n  opts=" << (opts?opts:"<none>")
                      << "\n  got " << (ok?"OK":"ILLEGAL") << " expected " << (expectOk?"OK":"ILLEGAL") << std::endl;
            failures++;
        }
        return res; // may be nullptr; caller should not free
    };

    // 1) White K-side castling allowed when path clear and safe
    const char* fenCastleClear = "4k3/8/8/8/8/8/8/R3K2R w K - 0 1"; // f1,g1 empty; rights K
    apply_expect_ok("castle clear safe (white K)", fenCastleClear, "e1g1", "{\"includeCastling\":true,\"castleSafety\":true}", true);

    // 2) Safety blocks K-side castling when a transit square is attacked (rook on f3 attacks f1)
    const char* fenCastleUnsafe = "4k3/8/8/8/8/5r2/8/4K2R w K - 0 1"; // black rook on f3 attacks f1
    apply_expect_ok("castle blocked by attack (safety on)", fenCastleUnsafe, "e1g1", "{\"includeCastling\":true,\"castleSafety\":true}", false);
    apply_expect_ok("castle allowed when safety off", fenCastleUnsafe, "e1g1", "{\"includeCastling\":true,\"castleSafety\":false}", true);

    // 3) Path blocked should prevent castling regardless of safety
    const char* fenCastlePathBlocked = "4k3/8/8/8/8/8/8/R3K1NR w K - 0 1"; // knight on g1 blocks
    apply_expect_ok("castle blocked by piece on path", fenCastlePathBlocked, "e1g1", "{\"includeCastling\":true,\"castleSafety\":true}", false);

    // 4) Castling rights lost after king moves
    const char* afterKingMove = apply_expect_ok("king move loses castling rights", fenCastleClear, "e1f1", "{\"includeCastling\":true,\"castleSafety\":true}", true);
    if (afterKingMove) {
        apply_expect_ok("cannot castle after king has moved", afterKingMove, "e1g1", "{\"includeCastling\":true,\"castleSafety\":true}", false);
    } else { failures++; }

    // 5) Castling rights lost after rook moves
    const char* afterRookMove = apply_expect_ok("rook move loses castling rights", fenCastleClear, "h1h2", "{\"includeCastling\":true,\"castleSafety\":true}", true);
    if (afterRookMove) {
        apply_expect_ok("cannot castle after rook has moved", afterRookMove, "e1g1", "{\"includeCastling\":true,\"castleSafety\":true}", false);
    } else { failures++; }

    // 6) Black K-side castling allowed when path clear and safe
    const char* fenBlackCastle = "r3k2r/8/8/8/8/8/8/4K3 b k - 0 1";
    apply_expect_ok("black castle clear safe (K)", fenBlackCastle, "e8g8", "{\"includeCastling\":true,\"castleSafety\":true}", true);

    // 7) Regression: sequence should not eliminate all legal moves
    const char* startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const char* seq1 = apply_expect_ok("seq f2f4", startFen, "f2f4", "{\"includeCastling\":true,\"castleSafety\":true}", true);
    const char* seq2 = seq1 ? apply_expect_ok("seq e7e5", seq1, "e7e5", "{\"includeCastling\":true,\"castleSafety\":true}", true) : nullptr;
    const char* seq3 = seq2 ? apply_expect_ok("seq g1f3", seq2, "g1f3", "{\"includeCastling\":true,\"castleSafety\":true}", true) : nullptr;
    const char* seq4 = seq3 ? apply_expect_ok("seq f8c5", seq3, "f8c5", "{\"includeCastling\":true,\"castleSafety\":true}", true) : nullptr;
    const char* seq5 = seq4 ? apply_expect_ok("seq e2e4", seq4, "e2e4", "{\"includeCastling\":true,\"castleSafety\":true}", true) : nullptr;
    const char* seq6 = seq5 ? apply_expect_ok("seq g8f6", seq5, "g8f6", "{\"includeCastling\":true,\"castleSafety\":true}", true) : nullptr;
    if (seq6) {
        const char* jsonMoves = generate_descendants_opts(seq6, 1, 0, "{\"castleSafety\":true}");
        if (!jsonMoves) { std::cerr << "FAIL: descendants after sequence returned null" << std::endl; failures++; }
        if (jsonMoves) {
            std::string s(jsonMoves);
            auto pos = s.find("\"totalNodes\":");
            if (pos!=std::string::npos){ int val = std::atoi(s.c_str()+pos+13); if(val < 1){ std::cerr<<"FAIL: totalNodes after sequence is 0"<<std::endl; failures++; }}
        }
    } else {
        std::cerr << "FAIL: could not complete regression sequence" << std::endl; failures++;
    }

    // --- Evaluation tests (configurable, white-centric centipawns) ---
    // Default options should match basic material eval
    int e_default = evaluate_fen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    int e_opts = evaluate_fen_opts("4k3/8/8/8/8/8/8/4K3 w - - 0 1", "{}");
    assert_eq("eval opts matches default", e_opts, e_default);

    // Changing queen weight should affect score
    int e_wq900 = evaluate_fen_opts("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1", "{\"weights\":{\"q\":900}}" );
    int e_wq1200 = evaluate_fen_opts("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1", "{\"weights\":{\"q\":1200}}" );
    if (!(e_wq1200 > e_wq900)) { std::cerr << "FAIL: increasing queen weight should raise eval" << std::endl; failures++; }

    // Tempo term: add +10 for white to move; -10 for black to move
    int e_tempo_w = evaluate_fen_opts("4k3/8/8/8/8/8/8/4K3 w - - 0 1", "{\"terms\":{\"tempo\":true},\"tempo\":10}");
    int e_tempo_b = evaluate_fen_opts("4k3/8/8/8/8/8/8/4K3 b - - 0 1", "{\"terms\":{\"tempo\":true},\"tempo\":10}");
    if (!(e_tempo_w - e_tempo_b == 20)) { std::cerr << "FAIL: tempo term not applied symmetrically" << std::endl; failures++; }

    // --- Symmetry invariance tests: flip FEN (rotate 180 + swap colors). Evaluation should remain numerically equal. ---
    auto rotateAndSwap = [](const std::string &placement){
        std::vector<char> squares(64,'.'); std::vector<std::string> ranks; std::string tmp; for(char ch: placement){ if(ch=='/'){ ranks.push_back(tmp); tmp.clear(); } else tmp.push_back(ch); } ranks.push_back(tmp);
        if(ranks.size()!=8) return std::string();
        for(int r=0;r<8;r++){ int f=0; for(char ch: ranks[r]){ if(std::isdigit((unsigned char)ch)){ int n=ch-'0'; for(int k=0;k<n;k++){ squares[r*8+f]='.'; f++; } } else { squares[r*8+f]=ch; f++; } } if(f!=8) return std::string(); }
        std::vector<char> out(64,'.'); for(int i=0;i<64;i++){ char p=squares[i]; int j=63-i; if(p!='.') p = std::isupper((unsigned char)p)? std::tolower((unsigned char)p): std::toupper((unsigned char)p); out[j]=p; }
        std::string res; for(int r=0;r<8;r++){ int empty=0; for(int c=0;c<8;c++){ char p=out[r*8+c]; if(p=='.'){ empty++; } else { if(empty){ res+=char('0'+empty); empty=0; } res+=p; } } if(empty) res+=char('0'+empty); if(r!=7) res+='/'; }
        return res;
    };
    auto flipSide = [](char s){ return s=='w'?'b':'w'; };
    auto flipCast = [](const std::string &c){ if(c=="-") return c; bool wK=false,wQ=false,bK=false,bQ=false; for(char ch: c){ if(ch=='K') bK=true; else if(ch=='Q') bQ=true; else if(ch=='k') wK=true; else if(ch=='q') wQ=true; } std::string out; if(wK) out+='K'; if(wQ) out+='Q'; if(bK) out+='k'; if(bQ) out+='q'; if(out.empty()) out="-"; return out; };
    auto flipEP = [](const std::string &ep){ if(ep.size()!=2) return std::string("-"); char f=ep[0], r=ep[1]; if(f<'a'||f>'h'||r<'1'||r>'8') return std::string("-"); int fi=f-'a', ri=r-'1'; int nfi=7-fi, nri=7-ri; return std::string()+char('a'+nfi)+char('1'+nri); };
    auto flipFen = [&](const std::string &fen){ std::istringstream ss(fen); std::string p,s,c,e,h,fn; if(!(ss>>p>>s>>c>>e>>h>>fn)) return std::string(); std::string np=rotateAndSwap(p); if(np.empty()) return std::string(); std::ostringstream out; out<<np<<" "<<flipSide(s[0])<<" "<<flipCast(c)<<" "<<flipEP(e)<<" "<<h<<" "<<fn; return out.str(); };
    struct SymCase{ const char* fen; };
    std::vector<SymCase> symCases = {
        {"rnbq1rk1/pppp1ppp/5n2/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - - 8 8"},
        {"rnbqkbnr/pppppppp/8/4P3/3P4/8/PPP1PPPP/RNBQKBNR b KQkq e3 0 3"},
        {"r1bqkbnr/pppp1ppp/2n5/4P3/3P4/8/PPP2PPP/RNBQKBNR b KQkq d3 0 5"}
    };
    for(auto &sc: symCases){ std::string flipped = flipFen(sc.fen); if(flipped.empty()){ std::cerr << "FAIL: flipFen failed for "<< sc.fen << std::endl; failures++; continue; } int evalA = evaluate_fen_opts(sc.fen, "{}"); int evalB = evaluate_fen_opts(flipped.c_str(), "{}"); if(evalA != evalB){ std::cerr << "FAIL: symmetry mismatch evalA="<<evalA<<" evalB="<<evalB<<" FEN="<<sc.fen<<" FLIP="<<flipped<< std::endl; failures++; } }

    // Line evaluation: simple capture sequence should end up +100 for white (material-only)
    const char* capStart = "4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1"; // black pawn d4, white pawn e2 -> e2e4 d4e3 e2xe3 illegal; instead: e2e3 d4e3?? can't. Use e2xd3 from other setup
    const char* capStart2 = "4k3/8/8/8/8/3p4/4P3/4K3 w - - 0 1"; // black pawn d3, white pawn e2 -> e2xd3
    const char* lineJson = evaluate_move_line(capStart2, "[\"e2d3\"]", "{\"terms\":{\"material\":true}}" );
    if (!lineJson) { std::cerr << "FAIL: evaluate_move_line returned null" << std::endl; failures++; }
    if (lineJson) {
        std::string s(lineJson);
        auto p = s.find("\"finalEval\":");
        if (p==std::string::npos) { std::cerr << "FAIL: evaluate_move_line missing finalEval" << std::endl; failures++; }
        else { int val = std::atoi(s.c_str()+p+12); if (val < 90) { std::cerr << "FAIL: capture line finalEval too small: "<<val << std::endl; failures++; } }
    }

    // Regression: ensure engine avoids trivial en prise at depth 2 (expected to FAIL currently)
    failures += depth2_knight_blunder_regression();

    if (failures) return 1;
    std::cout << "OK" << std::endl;
    return 0;
}

// --- Additional targeted regression: depth-2 blunder into pawn capture ---
// We place the engine in the exact game state reported:
// 1. e2e4 b8c6 2. d2d4 (Black to move)
// FEN from logs: r1bqkbnr/pppppppp/2n5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2
// With searchDepth=2, the engine should see that 1... c6e5? 2. d4e5 wins a knight.
// This test asserts the engine should NOT pick c6e5 — and is expected to FAIL currently.

extern "C" const char* choose_best_move(const char* fen, const char* optionsJson);
extern "C" const char* list_legal_moves(const char* fen, const char* fromSqOrNull, const char* optionsJson);
extern "C" const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson);

static std::string parse_best_uci(const char* json){
    if (!json) return std::string();
    std::string s(json);
    const std::string key = "\"best\":{\"uci\":\"";
    auto p = s.find(key);
    if (p == std::string::npos) return std::string();
    size_t start = p + key.size();
    size_t end = s.find('"', start);
    if (end == std::string::npos) return std::string();
    return s.substr(start, end - start);
}

static bool json_contains(const char* json, const char* needle){
    if (!json || !needle) return false; std::string s(json); return s.find(needle) != std::string::npos;
}

// --- Helpers for flip and UCI transformation (color + 180° rotation) ---
static std::string rotateAndSwap_U(const std::string &placement){
    std::vector<char> squares(64,'.'); std::vector<std::string> ranks; std::string tmp; for(char ch: placement){ if(ch=='/'){ ranks.push_back(tmp); tmp.clear(); } else tmp.push_back(ch); } ranks.push_back(tmp);
    if(ranks.size()!=8) return std::string();
    for(int r=0;r<8;r++){ int f=0; for(char ch: ranks[r]){ if(std::isdigit((unsigned char)ch)){ int n=ch-'0'; for(int k=0;k<n;k++){ squares[r*8+f]='.'; f++; } } else { squares[r*8+f]=ch; f++; } } if(f!=8) return std::string(); }
    std::vector<char> out(64,'.'); for(int i=0;i<64;i++){ char p=squares[i]; int j=63-i; if(p!='.'){ p = std::isupper((unsigned char)p) ? (char)std::tolower((unsigned char)p) : (char)std::toupper((unsigned char)p); } out[j]=p; }
    std::string res; for(int r=0;r<8;r++){ int empty=0; for(int c=0;c<8;c++){ char p=out[r*8+c]; if(p=='.'){ empty++; } else { if(empty){ res+=char('0'+empty); empty=0; } res+=p; } } if(empty) res+=char('0'+empty); if(r!=7) res+='/'; }
    return res;
}
static inline char flipSideU(char s){ return s=='w'?'b':'w'; }
static std::string flipCastU(const std::string &c){ if(c=="-") return c; bool wK=false,wQ=false,bK=false,bQ=false; for(char ch: c){ if(ch=='K') bK=true; else if(ch=='Q') bQ=true; else if(ch=='k') wK=true; else if(ch=='q') wQ=true; } std::string out; if(wK) out+='K'; if(wQ) out+='Q'; if(bK) out+='k'; if(bQ) out+='q'; if(out.empty()) out="-"; return out; }
static std::string flipEPU(const std::string &ep){ if(ep.size()!=2) return std::string("-"); char f=ep[0], r=ep[1]; if(f<'a'||f>'h'||r<'1'||r>'8') return std::string("-"); int fi=f-'a', ri=r-'1'; int nfi=7-fi, nri=7-ri; return std::string()+char('a'+nfi)+char('1'+nri); }
static std::string flipFenU(const std::string &fen){ std::istringstream ss(fen); std::string p,s,c,e,h,fn; if(!(ss>>p>>s>>c>>e>>h>>fn)) return std::string(); std::string np=rotateAndSwap_U(p); if(np.empty()) return std::string(); std::ostringstream out; out<<np<<" "<<flipSideU(s[0])<<" "<<flipCastU(c)<<" "<<flipEPU(e)<<" "<<h<<" "<<fn; return out.str(); }
static std::string flipUci(const std::string &uci){ if(uci.size()<4) return uci; auto f=[&](char file,char rank){ int fi=file-'a', ri=rank-'1'; int nfi=7-fi, nri=7-ri; return std::string()+char('a'+nfi)+char('1'+nri); }; std::string from = f(uci[0],uci[1]); std::string to = f(uci[2],uci[3]); std::string out = from + to; if(uci.size()>=5) out.push_back(uci[4]); return out; }

int depth2_knight_blunder_regression(){
    int localFailures = 0;
    const char* fen_after_d2d4 = "r1bqkbnr/pppppppp/2n5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3 0 2";
    // Mirror UI defaults for geometric terms, which appear to influence the blunder case
    const char* opts = "{\"searchDepth\":2,\"terms\":{\"material\":true,\"tempo\":false},\"centerPiecePlacementReward\":50,\"endGameKingCenterMagnet\":15}";

    // Colorblind engine expects white-to-move: flip FEN if black to move, then flip best move back
    std::string inputFen = fen_after_d2d4;
    if(fen_after_d2d4 && fen_after_d2d4[0]){
        std::istringstream ss(fen_after_d2d4); std::string p,s,c,e,h,fn; if(ss>>p>>s>>c>>e>>h>>fn){ if(!s.empty() && s[0]=='b'){ std::string flipped = flipFenU(fen_after_d2d4); if(!flipped.empty()) inputFen = flipped; } }
    }
    const char* bestJson = choose_best_move(inputFen.c_str(), opts);
    if (!bestJson || std::strlen(bestJson) == 0 || json_contains(bestJson, "error")){
        std::cerr << "FAIL: choose_best_move returned error/null for depth-2 scenario" << std::endl; localFailures++;
    } else {
        std::string uciW = parse_best_uci(bestJson);
        // Flip back to original orientation if we flipped the FEN
        bool flippedIn = (inputFen != std::string(fen_after_d2d4));
        std::string uci = flippedIn ? flipUci(uciW) : uciW;
        if (uci.empty()) { std::cerr << "FAIL: best.uci missing from choose_best_move output" << std::endl; localFailures++; }
        // EXPECTATION (desired): engine should avoid c6e5 here at depth 2.
        // We intentionally assert that it avoids c6e5, which is expected to FAIL with current behavior.
        if (uci == "c6e5"){
            std::cerr << "FAIL: depth-2 search chose knight into pawn capture (c6e5)" << std::endl; localFailures++;
        }
    }

    // Sanity: verify that after c6e5, the reply d4e5 is legal and thus should be visible to depth-2 search
    const char* after_knight = apply_move_if_legal(fen_after_d2d4, "c6e5", nullptr);
    if (!after_knight || json_contains(after_knight, "error")){
        std::cerr << "FAIL: applying c6e5 on the given FEN should be legal but was rejected" << std::endl; localFailures++;
    } else {
        const char* moves_after_knight = list_legal_moves(after_knight, nullptr, nullptr);
        if (!moves_after_knight || !json_contains(moves_after_knight, "\"uci\":\"d4e5\"")){
            std::cerr << "FAIL: expected white reply d4e5 to be legal after c6e5" << std::endl; localFailures++;
        }
    }

    return localFailures;
}

// Run the regression when compiled as part of main test binary
// Note: main aggregates failures, so no static initialization side-effects are needed here.
