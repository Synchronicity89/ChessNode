// app.js (ES module)
import { Chess } from '/vendor/chess-esm.js';

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
  if (game.isGameOver()) return false;
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
    if (game.isCheckmate()) {
      status = 'Game over, ' + (moveColor === 'White' ? 'Black' : 'White') + ' is victorious via checkmate.';
    } else if (game.isDraw()) {
      status = 'Game over, drawn position';
    } else {
      status = moveColor + ' to move';
      if (game.isCheck()) status += ', ' + moveColor + ' is in check';
    }

    statusEl.textContent = status;
  }

  function fen4() {
    const parts = game.fen().split(' ');
    return parts.slice(0, 4).join(' ');
  }

  async function showFen() {
    const f4 = fen4();
    log('FEN4: ' + f4);
  }

  async function searchPosition() {
    const f4 = fen4();
    try {
      const res = await fetch('/api/book/position?fen=' + encodeURIComponent(f4));
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'query failed');
      log('DB has current position: ' + (data.exists ? 'YES' : 'NO'));
    } catch (e) { log('Error: ' + e.message); }
  }

  function listCountersLocal() {
    const legal = game.moves({ verbose: true });
    const f4 = fen4();
    const counters = [];
    for (const m of legal) {
      const tmp = new Chess(game.fen());
      tmp.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
      const f4to = tmp.fen().split(' ').slice(0, 4).join(' ');
      const uci = m.from + m.to + (m.promotion || '');
      counters.push({ uci, san: m.san, toFen: f4to });
    }
    counters.sort((a, b) => a.uci.localeCompare(b.uci));
    log('Counters (' + counters.length + '):');
    for (const c of counters) log(' - ' + c.san + ' (' + c.uci + ') => ' + c.toFen);
    return counters;
  }

  async function searchCountersInDB(counters) {
    const fens = counters.map(c => c.toFen);
    try {
      const res = await fetch('/api/book/positions/exist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fens })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'query failed');
      let hits = 0;
      for (const c of counters) {
        c.inDB = !!data.exists[c.toFen];
        if (c.inDB) hits++;
      }
      log('DB hits among counters: ' + hits + ' of ' + counters.length);
      for (const c of counters) log('   ' + c.uci + ' -> ' + (c.inDB ? 'HIT' : 'miss'));
    } catch (e) { log('Error: ' + e.message); }
  }

  async function listBookCounters() {
    const f4 = fen4();
    try {
      const res = await fetch('/api/book/countermoves?fen=' + encodeURIComponent(f4));
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'query failed');
      const cands = data.candidates || [];
      if (cands.length === 0) { log('Book candidates: 0'); return []; }
      log('Book candidates: ' + cands.length);
      for (const c of cands) log(` • ${c.uci} (count=${c.count}) => ${c.to}`);
      return cands;
    } catch (e) { log('Error: ' + e.message); return []; }
  }

  async function playRandomDBCounter() {
    // Prefer book candidates; fall back to local counters with DB hits
    const cands = await listBookCounters();
    let pool = cands.map(c => ({ uci: c.uci }));
    if (pool.length === 0) {
      const counters = listCountersLocal();
      await searchCountersInDB(counters);
      pool = counters.filter(c => c.inDB).map(c => ({ uci: c.uci }));
    }
    if (pool.length === 0) { log('No DB-backed counters available.'); return; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const u = pick.uci;
    const from = u.slice(0,2), to = u.slice(2,4), promo = u.slice(4) || undefined;
    const mv = game.move({ from, to, promotion: promo || 'q' });
    if (!mv) { log('Picked illegal counter? ' + u); return; }
    board.position(game.fen());
    log('Manual DB: ' + mv.san + ' (' + u + ')');
    updateStatus();
  }
  async function engineMove() {
  if (game.isGameOver()) return;
    const fen = game.fen().split(' ');
    // chess.js returns FEN with halfmove/fullmove; our server expects 4 fields
    const shortFen = fen.slice(0, 4).join(' ');
    const modeEl = document.getElementById('mode');
    const mode = modeEl ? modeEl.value : 'prefer-book';
    try {
      const res = await fetch('/api/engine/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: shortFen, mode }),
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
  const src = data.source === 'book' ? 'Book' : data.source === 'db' ? 'DB' : 'Engine';
  const parts = [];
  if (data.bookCandidates != null) parts.push(`book=${data.bookCandidates}`);
  if (data.dbHits != null) parts.push(`dbHits=${data.dbHits}`);
  const extra = parts.length ? ` [${parts.join(', ')}]` : '';
        log(src + ': ' + move.san + ' (' + best + ')' + extra);
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
  document.getElementById('btn-fen').addEventListener('click', showFen);
  document.getElementById('btn-search').addEventListener('click', searchPosition);
  document.getElementById('btn-counters').addEventListener('click', listCountersLocal);
  document.getElementById('btn-counters-db').addEventListener('click', async () => {
    const counters = listCountersLocal();
    await searchCountersInDB(counters);
  });
  document.getElementById('btn-play-db').addEventListener('click', playRandomDBCounter);

  const config = {
    draggable: true,
    position: 'start',
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
  };
  board = Chessboard('board', config);

  updateStatus();
})();
