# Portable Makefile for Unix-like systems (optional alternative to CMake)
# Requirements: a C++17 compiler (g++/clang++)

CXX ?= c++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -Iinclude
SRC := src/example.cpp src/fen.cpp
OBJ := $(SRC:.cpp=.o)
LIB := libchess_engine.a
TEST := chess_tests

all: $(LIB) $(TEST)

$(LIB): $(OBJ)
	ar rcs $@ $^

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(TEST): tests/tests_main.cpp $(LIB)
	$(CXX) $(CXXFLAGS) $^ -o $@

clean:
	rm -f $(OBJ) $(LIB) $(TEST)

.PHONY: all clean
