// CLI: choose_best_move_cli
// Usage: choose_best_move_cli "<FEN>" [depth]
#include <iostream>
#include <string>
#include <cstdlib>

extern "C" const char* choose_best_move(const char* fen, const char* optionsJson);

int main(int argc, char** argv){
    std::string fen;
    int depth = 1;
    if (argc >= 2){ fen = argv[1]; }
    else {
        std::cerr << "Provide FEN as first argument" << std::endl; return 2; }
    if (argc >= 3){ depth = std::atoi(argv[2]); if (depth < 1) depth = 1; }
    std::string opts = std::string("{\"searchDepth\":") + std::to_string(depth) + "}";
    const char* js = choose_best_move(fen.c_str(), opts.c_str());
    if(!js){ std::cerr << "{\"error\":\"null-result\"}" << std::endl; return 1; }
    std::cout << js << std::endl;
    return 0;
}
