#pragma once
#include <QWidget>
#include <QPixmap>
#include <array>
#include <string>
#include <unordered_map>
#include "engine.hpp"

class BoardWidget : public QWidget {
    Q_OBJECT
public:
    explicit BoardWidget(QWidget* parent=nullptr);
    void setPosition(const engine::Position& pos);
    const engine::Position& position() const { return currentPos; }
    void setAssetsRoot(const QString& root); // path to images
signals:
    void blackMoveRequested(int from, int to); // user attempts black move
protected:
    void paintEvent(QPaintEvent* ev) override;
    void mousePressEvent(QMouseEvent* ev) override;
private:
    engine::Position currentPos;
    QString assetsRoot;
    std::unordered_map<char,QPixmap> piecePix;
    int selectedSquare = -1; // for black move selection
    int squareAtPoint(int x, int y) const;
    void loadAssets();
};
