#include "EngineController.hpp"
#include <QString>
#include <vector>
#include <algorithm>

EngineController::EngineController(QObject* parent): QObject(parent) {}

void EngineController::setPosition(const engine::Position& pos){
    current = pos;
}

std::string EngineController::encodeSquare(int sq) const {
    int file = sq & 7; int rank = sq >> 3;
    char f = char('a'+file); char r = char('1'+rank);
    return std::string({f,r});
}

bool EngineController::makeMoveUci(const std::string& uci){
    if (uci.size()<4) return false;
    std::string fromS = uci.substr(0,2);
    std::string toS = uci.substr(2,2);
    int from = (fromS[0]-'a') + (fromS[1]-'1')*8;
    int to = (toS[0]-'a') + (toS[1]-'1')*8;
    // Generate legal moves
    std::vector<engine::Move> pseudo; engine::generate_pseudo_moves(current, pseudo);
    std::vector<engine::Move> legal; engine::filter_legal(current, pseudo, legal);
    auto it = std::find_if(legal.begin(), legal.end(), [&](const engine::Move& m){ return m.from==from && m.to==to; });
    if (it == legal.end()) return false;
    engine::Position next; engine::apply_move(current, *it, next);
    current = next;
    emit positionChanged(current, QString::fromStdString(uci));
    return true;
}

void EngineController::enginePlayWhite(int depth){
    if (current.sideToMove != 0) return; // white only
    std::string fen = engine::to_fen(current);
    std::string move = engine::choose_move(fen, depth);
    if (move.empty()) {
        emit infoMessage("Engine has no move (game end?)");
        return;
    }
    if (!makeMoveUci(move)) {
        emit infoMessage("Engine chose illegal move: " + QString::fromStdString(move));
    }
}

bool EngineController::applyBlackMove(int from, int to){
    if (current.sideToMove != 1) return false;
    std::string uci = encodeSquare(from) + encodeSquare(to);
    bool ok = makeMoveUci(uci);
    if (!ok) emit infoMessage("Rejected black move: " + QString::fromStdString(uci));
    return ok;
}
