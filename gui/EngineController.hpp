#pragma once
#include <QObject>
#include <QString>
#include "engine.hpp"

class EngineController : public QObject {
    Q_OBJECT
public:
    explicit EngineController(QObject* parent=nullptr);
    void setPosition(const engine::Position& pos); // replace position
    const engine::Position& position() const { return current; }
    void enginePlayWhite(int depth=2); // if sideToMove==0 (white), engine picks move
    bool applyBlackMove(int from, int to); // validates and applies black move
signals:
    void positionChanged(const engine::Position& newPos, const QString& lastMoveUci);
    void infoMessage(const QString& msg);
private:
    engine::Position current;
    bool makeMoveUci(const std::string& uci); // apply generic UCI move
    std::string encodeSquare(int sq) const;
};
