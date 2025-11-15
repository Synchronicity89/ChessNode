// Simple symmetry trace driver: evaluates known failing FENs and their flips
// Emits instrumentation JSON lines via SYMM_TRACE plus a compact summary.
// Usage:
//   set SYMM_TRACE=1; symm_trace_driver.exe

#include <iostream>
#include <vector>
#include <string>

extern "C" {
    int evaluate_fen_opts(const char* fen, const char* optionsJson);
    int evaluate_fen_colorblind(const char* fen, const char* optionsJson);
}

struct Pair { std::string a; std::string b; };

int main(){
    // Hard-coded current failing symmetry pairs (original, flip)
    std::vector<Pair> pairs = {
        {"rnbq1rk1/pppp1ppp/5n2/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - - 8 8","1kr1qb1r/ppp1pppp/2n2n2/3p1b2/3P4/2N5/PPP1PPPP/1KR1QBNR b - - 8 8"},
        {"rnbqkbnr/pppppppp/8/4P3/3P4/8/PPP1PPPP/RNBQKBNR b KQkq e3 0 3","rnbkqbnr/pppp1ppp/8/4p3/3p4/8/PPPPPPPP/RNBKQBNR w KQkq d6 0 3"},
        {"r1bqkbnr/pppp1ppp/2n5/4P3/3P4/8/PPP2PPP/RNBQKBNR b KQkq d3 0 5","rnbkqbnr/ppp2ppp/8/4p3/3p4/5N2/PPP1PPPP/RNBKQB1R w KQkq e6 0 5"}
    };

    std::cout << "{\n  \"pairs\": [\n";
    for(size_t i=0;i<pairs.size();++i){
        const auto &p = pairs[i];
        int legacyA = evaluate_fen_opts(p.a.c_str(), "{}");
        int legacyB = evaluate_fen_opts(p.b.c_str(), "{}");
        int cbA = evaluate_fen_colorblind(p.a.c_str(), "{}");
        int cbB = evaluate_fen_colorblind(p.b.c_str(), "{}");
        std::cout << "    {\n";
        std::cout << "      \"index\": " << (i+1) << ",\n";
        std::cout << "      \"fen\": \"" << p.a << "\",\n";
        std::cout << "      \"flip\": \"" << p.b << "\",\n";
        std::cout << "      \"legacyA\": " << legacyA << ",\n";
        std::cout << "      \"legacyB\": " << legacyB << ",\n";
        std::cout << "      \"colorblindA\": " << cbA << ",\n";
        std::cout << "      \"colorblindB\": " << cbB << "\n";
        std::cout << "    }" << (i+1<pairs.size()?",":"") << "\n";
    }
    std::cout << "  ]\n}\n";
    return 0;
}
