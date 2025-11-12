#include "engine.h"
#include <iostream>

static int failures = 0;

void assert_eq(const char* name, int got, int expected) {
    if (got != expected) {
        std::cerr << "FAIL: " << name << " got=" << got << " expected=" << expected << std::endl;
        failures++;
    }
}

int main() {
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
    // Inject a black rook on f3 (square f6 rank? We'll use piece layout minimal). Use a simple piece that attacks f1 in a straight line.
    // Simpler: place a black rook on f2 (FEN: .../5r2/... ), but adjust board: We'll craft a custom FEN.
    const char* attackFen = "rnbqkbnr/pppppppp/8/8/8/5r2/PPPPPPPP/RNBQK1NR w KQkq - 0 1"; // black rook at f3 attacks f1 path through f2
    const char* jsonSafe = generate_descendants_opts(attackFen, 1, 0, "{\"includeCastling\":true,\"castleSafety\":true}");
    if (!jsonSafe){ std::cerr<<"FAIL: castleSafety generation failed"<<std::endl; failures++; }
    if (jsonSafe){
        std::string s(jsonSafe);
        if (s.find("7 6 w") != std::string::npos){ std::cerr<<"FAIL: unsafe king-side castling not filtered"<<std::endl; failures++; }
    }
    const char* jsonUnsafe = generate_descendants_opts(attackFen, 1, 0, "{\"includeCastling\":true,\"castleSafety\":false}");
    if (jsonUnsafe){
        std::string s(jsonUnsafe);
        // Should allow castle when safety disabled (not guaranteed by rights alone; we approximate by presence of target square substring)
        if (s.find("7 6 w") == std::string::npos){ std::cerr<<"FAIL: castling move missing when safety disabled"<<std::endl; failures++; }
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

    if (failures) return 1;
    std::cout << "OK" << std::endl;
    return 0;
}
