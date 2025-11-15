#include "engine.h"
#include <iostream>
#include <cstdlib>

int main(){
#ifndef CHESSNODE_INSTRUMENT_THREADS
    std::cerr << "CHESSNODE_INSTRUMENT_THREADS not enabled. Reconfigure with -DCHESSNODE_INSTRUMENT_THREADS=ON" << std::endl;
    return 1;
#else
    const char* fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1"; // override via env FEN_PROBE
    if(const char* envFen = std::getenv("FEN_PROBE")) if(*envFen) fen = envFen;
    const char* json = debug_compare_symmetry(fen, "{}");
    std::cout << json << std::endl;
    return 0;
#endif
}
