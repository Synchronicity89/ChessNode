#include "engine.h"
#include <iostream>

int main(){
    const char* fenW = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
    const char* fenB = "4k3/8/8/8/8/8/8/4K3 b - - 0 1";
    const char* opts = "{\"terms\":{\"tempo\":true},\"tempo\":10}";
    int ew = evaluate_fen_opts(fenW, opts);
    int eb = evaluate_fen_opts(fenB, opts);
    std::cout << "ew=" << ew << " eb=" << eb << " diff=" << (ew-eb) << "\n";
    return 0;
}
