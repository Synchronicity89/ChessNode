// app.js (ES module)
import { Chess } from '/vendor/chess-esm.js';

(function () {
  const game = new Chess();
  let board = null;
  let humanIsWhite = true;
  const statusEl = document.getElementById('status');
  const logEl = document.getElementById('log');
  const pgnsEl = document.getElementById('pgns');
  const copyStatusEl = document.getElementById('copy-status');
  const pvEl = document.getElementById('pv');
  // Accumulated PV history text
  let pvHistory = '';
  const profilingCheckbox = document.getElementById('profiling');
  const profilingStatusEl = document.getElementById('profiling-status');
  const sessionGames = []; // array of PGN strings for completed games
  let currentMoves = []; // SAN moves for current game

  function log(msg) {
    const div = document.createElement('div');
    div.textContent = msg;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

    function renderEngineInfo(info) {
      const box = document.getElementById('engine-info');
      if(!info) { box.textContent = '(no data)'; return; }
      const {
        requestedDepth,
        depthReached,
        nodes,
        ms,
        nps,
        fhCount,
        flCount,
        ttHits,
        ttHitRate,
        lmrReductions,
        nullTries,
        nullCutoffs,
        nullCutRate,
        mateDistance,
        sessionTotals,
        recentSearches,
        failReason,
        source
      } = info;
      const lineParts = [];
      lineParts.push(`source: ${source}`);
      if (requestedDepth != null) lineParts.push(`requestedDepth: ${requestedDepth}`);
      if (depthReached != null) lineParts.push(`depthReached: ${depthReached}`);
      if (nodes != null) lineParts.push(`nodes: ${nodes}`);
      if (ms != null) lineParts.push(`time(ms): ${ms}`);
      if (nps != null) lineParts.push(`nps: ${nps}`);
  if (mateDistance != null) lineParts.push(`mateDistance: ${mateDistance}`);
      if (fhCount != null) lineParts.push(`failHighs: ${fhCount}`);
      if (flCount != null) lineParts.push(`failLows: ${flCount}`);
        if (ttHits != null) lineParts.push(`ttHits: ${ttHits}`);
        if (ttHitRate != null) lineParts.push(`ttHitRate(%): ${ttHitRate}`);
        if (lmrReductions != null) lineParts.push(`lmrReductions: ${lmrReductions}`);
        if (nullTries != null) lineParts.push(`nullTries: ${nullTries}`);
        if (nullCutoffs != null) lineParts.push(`nullCutoffs: ${nullCutoffs}`);
        if (nullCutRate != null) lineParts.push(`nullCutRate(%): ${nullCutRate}`);
      if (sessionTotals) {
        lineParts.push('--- totals ---');
        lineParts.push(`searches: ${sessionTotals.searches}`);
        lineParts.push(`totalNodes: ${sessionTotals.nodes}`);
        lineParts.push(`totalMs: ${sessionTotals.ms}`);
        lineParts.push(`avgNps: ${sessionTotals.avgNps}`);
        lineParts.push(`totalFh: ${sessionTotals.fh}`);
        lineParts.push(`totalFl: ${sessionTotals.fl}`);
        lineParts.push(`totalTtHits: ${sessionTotals.ttHits}`);
        if (sessionTotals.ttHitRate != null) lineParts.push(`ttHitRateCum(%): ${sessionTotals.ttHitRate}`);
      }
      if (recentSearches && recentSearches.length) {
        lineParts.push('--- recent ---');
        recentSearches.forEach((r,i)=>{
    lineParts.push(`#${i+1} d=${r.depth} nodes=${r.nodes} ms=${r.ms} nps=${r.nps} scoreW=${r.score} fh=${r.fh} fl=${r.fl} ttRate=${r.ttHitRate != null ? r.ttHitRate+'%' : 'n/a'} lmr=${r.lmrReductions||0} null=${r.nullTries||0}/${r.nullCutoffs||0}${r.nullCutRate!=null?('('+r.nullCutRate+'%)'):''}`);
        });
      }
      if (failReason) lineParts.push(`explanation: ${failReason}`);
      box.textContent = lineParts.join('\n');
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
    if (source === target) return 'snapback';
    let move = null;
    try {
      move = game.move({ from: source, to: target, promotion: 'q' });
    } catch (e) {
      console.error('onDrop error', e);
      return 'snapback';
    }
    if (move === null) return 'snapback';
    updateStatus();
    board.position(game.fen());
    log('Human: ' + move.san);
    currentMoves.push(move.san);
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
    // If it's human's turn, trigger pondering on server to precompute replies
    if (!game.isGameOver()) {
      const humanToMove = (humanIsWhite && game.turn() === 'w') || (!humanIsWhite && game.turn() === 'b');
      if (humanToMove) {
        // Fire and forget
        ponderCurrent().catch(() => {});
      }
    }
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
    // Capture side-to-move and move number BEFORE the engine moves, for labeling PV output
    const stmBefore = (fen[1] === 'w') ? 'White' : 'Black';
    const moveCount = game.history().length; // number of plies already played in current game
    const moveNo = Math.floor(moveCount / 2) + 1;
    const moveTag = (fen[1] === 'w') ? `${moveNo}.` : `${moveNo}...`;
    const modeEl = document.getElementById('mode');
    const mode = modeEl ? modeEl.value : 'prefer-db';
    const pliesEl = document.getElementById('plies');
  const plies = pliesEl ? Math.max(1, Math.min(10, parseInt(pliesEl.value || '2', 10))) : 2;
    const verbose = !!document.getElementById('verbose')?.checked;
    try {
      const res = await fetch('/api/engine/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen: shortFen, mode, plies, verbose }),
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
        if (data.depth != null) {
          const d = data.depth;
          const req = data.requestedDepth || d;
          parts.push(`d=${d}${req && req !== d ? '/' + req : ''}`);
        }
        if (data.nodes != null) parts.push(`nodes=${data.nodes}`);
        // Scores are white-centric; also show side-to-move perspective for clarity
        const fmt = (n) => (n===0 ? '0.00' : (n>0?'+':'') + (Number(n).toFixed(2)));
        if (data.score != null) {
          const stm = game.turn() === 'w' ? data.score : -data.score;
          parts.push(`scoreW=${fmt(data.score)}`);
          parts.push(`scoreSTM=${fmt(stm)}`);
        }
  const extra = parts.length ? ` [${parts.join(', ')}]` : '';
        log(src + ': ' + move.san + ' (' + best + ')' + extra);
        currentMoves.push(move.san);
        updateStatus();
          // Render engine info panel
          // Safe extraction for engine info (only for engine sources that return depth info)
            if (data.source && data.source.startsWith('engine')) {
              renderEngineInfo({
                requestedDepth: data.requestedDepth || data.depth || null,
                depthReached: data.depth || null,
                nodes: data.nodes || 0,
                ms: data.ms,
                nps: data.nps,
                fhCount: data.fhCount,
                flCount: data.flCount,
                ttHits: data.ttHits,
                lmrReductions: data.lmrReductions,
                nullTries: data.nullTries,
                nullCutoffs: data.nullCutoffs,
                nullCutRate: data.nullCutRate,
                ttHitRate: data.ttHitRate,
                sessionTotals: data.sessionTotals,
                recentSearches: data.recentSearches,
                failReason: data.explanation,
                source: data.source
              });
          } else if (data.source === 'cache') {
            renderEngineInfo({
              requestedDepth: data.requestedDepth || data.depth || null,
              depthReached: data.depth || null,
              nodes: data.nodes || 0,
              ms: null,
              nps: null,
              fhCount: null,
              flCount: null,
                ttHits: null,
                ttHitRate: null,
                sessionTotals: data.sessionTotals,
                recentSearches: data.recentSearches,
              failReason: data.explanation,
              source: 'cache'
            });
          } else {
            renderEngineInfo(null);
          }
        if (verbose) {
          if (data.bestLines || data.worstLines) {
            renderPV(data, { stmLabel: stmBefore, moveTag });
          } else {
            // Avoid polluting history with cache placeholders; only append when this
            // response actually performed a search (engine sources)
            if (data.source && data.source.startsWith('engine')) {
              renderPVPlaceholder(data, { stmLabel: stmBefore, moveTag });
            }
          }
        }
        if (game.isGameOver()) finalizeGame();
        else {
          // After engine moves, it's human's turn -> ponder
          ponderCurrent().catch(() => {});
        }
      } else {
        log('Engine produced illegal move: ' + best);
      }
    } catch (e) {
      log('Error: ' + e.message);
    }
  }

  async function ponderCurrent() {
    try {
      const fen = game.fen().split(' ').slice(0,4).join(' ');
      const pliesEl = document.getElementById('plies');
      const plies = pliesEl ? Math.max(1, Math.min(10, parseInt(pliesEl.value || '2', 10))) : 2;
      const verbose = !!document.getElementById('verbose')?.checked;
      await fetch('/api/engine/ponder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, plies, verbose })
      });
    } catch (e) {
      // non-fatal
    }
  }

  function reset(humanWhite = true) {
    humanIsWhite = humanWhite;
    game.reset();
    board.orientation(humanWhite ? 'white' : 'black');
    board.start();
    updateStatus();
    log('--- New game ---');
    // If prior game unfinished, finalize it before clearing
    if (currentMoves.length && !game.isGameOver()) finalizeGame();
    currentMoves = [];
    fetch('/api/engine/new', { method: 'POST' });
    if (!humanWhite) setTimeout(engineMove, 200);
    else {
      // If human starts, kick off pondering for potential replies after human's first move
      ponderCurrent().catch(() => {});
    }
  }

  function resultTag() {
    if (game.isCheckmate()) return game.turn() === 'w' ? '0-1' : '1-0';
    if (game.isDraw()) return '1/2-1/2';
    return '*';
  }

  function finalizeGame() {
    const res = resultTag();
    const moveLines = [];
    let moveNumber = 1;
    for (let i = 0; i < currentMoves.length; ) {
      const whiteMove = currentMoves[i++];
      const blackMove = currentMoves[i++] || '';
      const line = blackMove ? `${moveNumber}. ${whiteMove} ${blackMove}` : `${moveNumber}. ${whiteMove}`;
      moveLines.push(line);
      moveNumber++;
    }
    const pgn = `[Event "Local Session"]\n[Site "Localhost"]\n[Date "${new Date().toISOString().slice(0,10)}"]\n[Round "-"]\n[White "Human"]\n[Black "Engine"]\n[Result "${res}"]\n\n${moveLines.join(' ')} ${res}`;
    sessionGames.push(pgn);
    renderPgns();
  }

  function renderPgns() {
    pgnsEl.value = sessionGames.join('\n\n');
  }

  function renderPV(data, meta) {
    const fmtScore = (s) => {
      if (s == null || Number.isNaN(Number(s))) return 'n/a';
      const n = Number(s);
      if (!Number.isFinite(n)) return 'n/a';
      // Keep mate sentinel obvious; otherwise show 2 decimals
      if (Math.abs(n) >= 99990) return String(n);
      return (n === 0 ? '0.00' : (n > 0 ? '+' : '') + n.toFixed(2));
    };
    const best = (data.bestLines || []).map((l, i) => `#${i+1} score=${fmtScore(l.score)}  ${l.line}`).join('\n');
    const worst = (data.worstLines || []).map((l, i) => `#${i+1} score=${fmtScore(l.score)}  ${l.line}`).join('\n');
    // Determine side labeling more accurately: meta.stmLabel already holds side-to-move before engine moved.
    // For clarity, show "for <side>" meaning the side that was to move when lines were generated.
    const side = meta?.stmLabel || 'Side';
    const moveTag = meta?.moveTag ? `${meta.moveTag} ` : '';
    const header = `${moveTag}Best lines for ${side}:`;
    const headerW = `${moveTag}Worst lines for ${side}:`;
    const chunk = `${header}\n${best || '(none)'}\n\n${headerW}\n${worst || '(none)'}\n`;
    pvHistory += (pvHistory ? '\n' : '') + chunk;
    pvEl.textContent = pvHistory;
    // auto-scroll to bottom
    pvEl.scrollTop = pvEl.scrollHeight;
  }

  function renderPVPlaceholder(data, meta) {
    const reason = data.explanation || 'No search lines available (book/DB move or shallow depth).';
    const side = meta?.stmLabel || 'Side';
    const moveTag = meta?.moveTag ? `${meta.moveTag} ` : '';
    const chunk = `${moveTag}Best/Worst lines for ${side}: ${reason}`;
    pvHistory += (pvHistory ? '\n' : '') + chunk + '\n';
    pvEl.textContent = pvHistory;
    pvEl.scrollTop = pvEl.scrollHeight;
  }

  document.getElementById('btn-copy-pgns').addEventListener('click', () => {
    if (!pgnsEl.value) { copyStatusEl.textContent = 'Nothing to copy'; return; }
    pgnsEl.select();
    try {
      document.execCommand('copy');
      copyStatusEl.textContent = 'Copied';
      setTimeout(() => { copyStatusEl.textContent = ''; }, 1500);
    } catch (e) {
      copyStatusEl.textContent = 'Copy failed';
    }
  });

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
  document.getElementById('btn-reset-stats').addEventListener('click', async () => {
    try {
      const r = await fetch('/api/stats/reset', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'reset failed');
      log('Stats reset.');
      // Clear engine info panel to reflect reset
      renderEngineInfo(null);
    } catch (e) {
      log('Reset error: ' + e.message);
    }
  });

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

  // --- Profiling toggle logic ---
  async function refreshProfilingStatus() {
    try {
      const r = await fetch('/api/profile/status');
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'status failed');
      profilingCheckbox.checked = !!d.profilingEnabled;
      profilingStatusEl.textContent = d.profilingEnabled ? 'ON' : 'OFF';
    } catch (e) {
      profilingStatusEl.textContent = 'error';
    }
  }
  async function toggleProfiling() {
    const want = profilingCheckbox.checked;
    profilingStatusEl.textContent = '...';
    try {
      const r = await fetch('/api/profile/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: want }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'toggle failed');
      profilingStatusEl.textContent = d.profilingEnabled ? 'ON' : 'OFF';
      log('Profiling ' + (d.profilingEnabled ? 'enabled' : 'disabled') + '. Logs will ' + (d.profilingEnabled ? 'be written to logs/.' : 'stop being written.'));
    } catch (e) {
      log('Profiling toggle error: ' + e.message);
      // revert checkbox visual state to previous status
      await refreshProfilingStatus();
    }
  }
  profilingCheckbox.addEventListener('change', toggleProfiling);
  // Initial status fetch
  refreshProfilingStatus();
})();
