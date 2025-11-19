#include <QApplication>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QPushButton>
#include <QLabel>
#include <QFileDialog>
#include <QMessageBox>
#include "BoardWidget.hpp"
#include "EngineController.hpp"
#include "engine.hpp"

// Initial FEN focusing on castling tests (standard starting position)
static const char* kInitialFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

int main(int argc, char** argv){
    QApplication app(argc, argv);

    QWidget win; win.setWindowTitle("ChessNode Native GUI (White Engine)");
    QVBoxLayout* root = new QVBoxLayout(&win);

    BoardWidget* board = new BoardWidget(&win);
    // Use web/img as assets root (relative path). Adjust if running from different cwd.
    board->setAssetsRoot(QCoreApplication::applicationDirPath() + "/../web/img");

    EngineController* controller = new EngineController(&win);

    // Parse initial FEN into Position
    engine::Position pos; if (!engine::parse_fen(kInitialFen, pos)) {
        QMessageBox::critical(&win, "FEN Error", "Failed to parse initial FEN");
        return 1;
    }
    controller->setPosition(pos);
    board->setPosition(pos);

    QHBoxLayout* buttons = new QHBoxLayout();
    QPushButton* engineMoveBtn = new QPushButton("Engine (White) Move");
    QPushButton* resetBtn = new QPushButton("Reset Game");
    QLabel* infoLabel = new QLabel("Ready.");
    infoLabel->setWordWrap(true);

    buttons->addWidget(engineMoveBtn);
    buttons->addWidget(resetBtn);
    root->addWidget(board);
    root->addLayout(buttons);
    root->addWidget(infoLabel);

    QObject::connect(engineMoveBtn, &QPushButton::clicked, [&]{
        controller->enginePlayWhite(2);
    });
    QObject::connect(resetBtn, &QPushButton::clicked, [&]{
        engine::Position np; engine::parse_fen(kInitialFen, np); controller->setPosition(np); board->setPosition(np); infoLabel->setText("Board reset.");
    });
    QObject::connect(board, &BoardWidget::blackMoveRequested, [&](int from, int to){
        if (controller->applyBlackMove(from, to)) {
            board->setPosition(controller->position());
            infoLabel->setText("Black move applied. White to move.");
        } else {
            infoLabel->setText("Illegal black move attempt.");
        }
    });
    QObject::connect(controller, &EngineController::positionChanged, [&](const engine::Position& newPos, const QString& uci){
        board->setPosition(newPos);
        infoLabel->setText(QString("White played: %1").arg(uci));
    });
    QObject::connect(controller, &EngineController::infoMessage, [&](const QString& msg){ infoLabel->setText(msg); });

    win.resize(600,700);
    win.show();
    return app.exec();
}
