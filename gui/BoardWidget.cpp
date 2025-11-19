#include "BoardWidget.hpp"
#include <QPainter>
#include <QMouseEvent>
#include <QFile>
#include <QDir>

BoardWidget::BoardWidget(QWidget* parent): QWidget(parent) {
    setMinimumSize(480,480); // 60px squares
}

void BoardWidget::setAssetsRoot(const QString& root){
    assetsRoot = root;
    loadAssets();
    update();
}

void BoardWidget::loadAssets(){
    piecePix.clear();
    struct Map { char c; const char* file; } mapping[] = {
        {'P',"white-pawn.png"},{'N',"white-knight.png"},{'B',"white-bishop.png"},{'R',"white-rook.png"},{'Q',"white-queen.png"},{'K',"white-king.png"},
        {'p',"black-pawn.png"},{'n',"black-knight.png"},{'b',"black-bishop.png"},{'r',"black-rook.png"},{'q',"black-queen.png"},{'k',"black-king.png"}
    };
    for (auto &m : mapping){
        QString path = QDir(assetsRoot).filePath(m.file);
        QPixmap pm(path);
        if (!pm.isNull()) piecePix[m.c] = pm;
    }
}

void BoardWidget::setPosition(const engine::Position& pos){
    currentPos = pos;
    update();
}

int BoardWidget::squareAtPoint(int x, int y) const {
    int sqSize = std::min(width(),height())/8;
    int file = x / sqSize;
    int rank = 7 - (y / sqSize);
    if (file<0||file>7||rank<0||rank>7) return -1;
    return rank*8 + file;
}

void BoardWidget::mousePressEvent(QMouseEvent* ev){
    if (ev->button()!=Qt::LeftButton) return;
    int sq = squareAtPoint(ev->x(), ev->y());
    if (sq<0) return;
    // Only allow black manual moves (engine plays white). SideToMove==1 => black to move.
    if (currentPos.sideToMove != 1) return; // wait for engine
    if (selectedSquare == -1) {
        // ensure black piece on square
        uint64_t mask = 1ULL << sq;
        if (currentPos.bb.BP & mask || currentPos.bb.BN & mask || currentPos.bb.BB & mask || currentPos.bb.BR & mask || currentPos.bb.BQ & mask || currentPos.bb.BK & mask){
            selectedSquare = sq; update();
        }
    } else {
        if (sq != selectedSquare) {
            emit blackMoveRequested(selectedSquare, sq);
            selectedSquare = -1; update();
        } else {
            selectedSquare = -1; update();
        }
    }
}

void BoardWidget::paintEvent(QPaintEvent*){
    QPainter p(this);
    int sqSize = std::min(width(),height())/8;
    int offsetX = (width()-sqSize*8)/2;
    int offsetY = (height()-sqSize*8)/2;
    for (int rank=7; rank>=0; --rank){
        for (int file=0; file<8; ++file){
            int sq = rank*8 + file;
            QRect r(offsetX + file*sqSize, offsetY + (7-rank)*sqSize, sqSize, sqSize);
            bool light = ((rank+file)%2)==0;
            p.fillRect(r, light? QColor(240,217,181) : QColor(181,136,99));
            if (sq == selectedSquare) {
                p.fillRect(r, QColor(50,120,200,100));
            }
            // Determine piece char
            uint64_t mask = 1ULL << sq;
            char piece = 0;
            if (currentPos.bb.WP & mask) piece='P'; else if (currentPos.bb.WN & mask) piece='N'; else if (currentPos.bb.WB & mask) piece='B'; else if (currentPos.bb.WR & mask) piece='R'; else if (currentPos.bb.WQ & mask) piece='Q'; else if (currentPos.bb.WK & mask) piece='K';
            else if (currentPos.bb.BP & mask) piece='p'; else if (currentPos.bb.BN & mask) piece='n'; else if (currentPos.bb.BB & mask) piece='b'; else if (currentPos.bb.BR & mask) piece='r'; else if (currentPos.bb.BQ & mask) piece='q'; else if (currentPos.bb.BK & mask) piece='k';
            if (piece) {
                auto it = piecePix.find(piece);
                if (it != piecePix.end()) {
                    p.drawPixmap(r, it->second);
                }
            }
        }
    }
}
