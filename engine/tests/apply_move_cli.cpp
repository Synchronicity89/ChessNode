// CLI: apply_move_cli
// Usage: apply_move_cli "<FEN>" <uci>
#include <iostream>
#include <string>

extern "C" const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson);

int main(int argc, char** argv){
    if (argc < 3){ std::cerr << "{\"error\":\"usage apply_move_cli FEN UCI\"}" << std::endl; return 2; }
    std::string fen = argv[1];
    std::string uci = argv[2];
    const char* res = apply_move_if_legal(fen.c_str(), uci.c_str(), nullptr);
    if(!res){ std::cerr << "{\"error\":\"null-result\"}" << std::endl; return 1; }
    std::string out(res);
    std::cout << out << std::endl;
    // Non-zero exit on error JSON
    if (out.find("\"error\"") != std::string::npos) return 1;
    return 0;
}
