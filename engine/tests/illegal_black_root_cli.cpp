#include "engine.h"
#include <iostream>
#include <cstdlib>
#include <cstring>

int main(){
    // Simple position with black to move (note the " b " after placement)
    const char* fen_black = "8/8/8/8/8/8/8/7k b - - 0 1";
    const char* res = choose_best_move(fen_black, "{\"searchDepth\":2}");
    if(!res){ std::cerr << "FAIL: null response" << std::endl; return 2; }
    // Expect an error json with illegal-input
    if(std::strstr(res, "illegal-input") == nullptr){
        std::cerr << "FAIL: expected illegal-input error, got: " << res << std::endl;
        return 3;
    }
    std::cout << "PASS: illegal-input enforced for black-to-move" << std::endl;
    return 0;
}
