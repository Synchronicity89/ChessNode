'use strict';

(function () {
  const game = new Chess();
  let board = null;
  let humanIsWhite = true;
  const statusEl = document.getElementById('status');
  const logEl = document.getElementById('log');

  function log(msg) {
    const div = document.createElement('div');
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function onDragStart(source, piece) {
    // do not pick up pieces if the game is over
    if (game.game_over()) return false;
    // only pick up pieces for the side to move
    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) || (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
      return false;
    }
    // prevent moving engine's pieces
    if (humanIsWhite && piece[0] === 'b') return false;
    if (!humanIsWhite && piece[0] === 'w') return false;
  }

  function onDrop(source, target) {
    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';
    updateStatus();
    board.position(game.fen());
    log('Human: ' + move.san);
    // Ask engine to move
    setTimeout(engineMove, 100);
  }

  function onSnapEnd() {
    board.position(game.fen());
  }

  function updateStatus() {
    let status = '';

    const moveColor = game.turn() === 'w' ? 'White' : 'Black';

    // checkmate?
    if (game.in_checkmate()) {
      status = 'Game over, ' + (moveColor === 'White' ? 'Black' : 'White') + ' is victorious via checkmate.';
    } else if (game.in_draw()) {
      status = 'Game over, drawn position';
    } else {
      status = moveColor + ' to move';
      if (game.in_check()) status += ', ' + moveColor + ' is in check';
    }

    statusEl.textContent = status;
  }

  async function engineMove() {
    if (game.game_over()) return;
    const fen = game.fen().split(' ');
    // chess.js returns FEN with halfmove/fullmove; our server expects 4 fields
    const shortFen = fen.slice(0, 4).join(' ');
    try {
      const res = await fetch('/api/engine/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: shortFen }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Engine error');
      const best = data.bestmove;
      const from = best.slice(0, 2);
      const to = best.slice(2, 4);
      const promo = best.slice(4, 5);
      const move = game.move({ from, to, promotion: promo || 'q' });
      if (move) {
        board.position(game.fen());
        log('Engine: ' + move.san + ' (' + best + ')');
        updateStatus();
      } else {
        log('Engine produced illegal move: ' + best);
      }
    } catch (e) {
      log('Error: ' + e.message);
    }
  }

  function reset(humanWhite = true) {
    humanIsWhite = humanWhite;
    game.reset();
    board.orientation(humanWhite ? 'white' : 'black');
    board.start();
    updateStatus();
    log('--- New game ---');
    fetch('/api/engine/new', { method: 'POST' });
    if (!humanWhite) setTimeout(engineMove, 200);
  }

  document.getElementById('btn-new').addEventListener('click', () => reset(humanIsWhite));
  document.getElementById('btn-switch').addEventListener('click', () => reset(!humanIsWhite));

  const config = {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
  };
  board = Chessboard('board', config);

  updateStatus();
})();
