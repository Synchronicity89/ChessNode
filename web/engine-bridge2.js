// Engine bridge v2 (fresh implementation)
// Provides a minimal chess "engine" that selects a preferred move
// based on one-ply material evaluation. No UI-side move selection occurs;
// the presentation must apply exactly the returned move.

(function (global) {
  'use strict';

  let debug = false;
  let prngState = 1 >>> 0;

  const pieceValue = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

  const log = (...args) => { if (debug) console.log('[EngineBridge2]', ...args); };
  const isWhite = (ch) => ch === ch.toUpperCase();
  const isBlack = (ch) => ch === ch.toLowerCase();
  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  // Simple PRNG for deterministic tie-breaks
  const rand = () => {
    prngState ^= prngState << 13; prngState >>>= 0;
    prngState ^= prngState >>> 17; prngState >>>= 0;
    prngState ^= prngState << 5; prngState >>>= 0;
    return prngState / 0xffffffff;
  };

  const parseFEN = (fen) => {
    if (!fen || typeof fen !== 'string') return null;
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 6) return null;
    const [placement, stm, castling, ep, half, full] = parts;
    const rows = placement.split('/');
    if (rows.length !== 8) return null;
    const board = Array.from({ length: 8 }, () => Array(8).fill('.'));
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        if (/^[1-8]$/.test(ch)) c += parseInt(ch, 10);
        else board[r][c++] = ch;
      }
      if (c !== 8) return null;
    }
    return { board, stm, castling, ep, half, full };
  };

  const encodeBoard = (board) => {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let row = '';
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p === '.') empty++;
        else { if (empty) { row += String(empty); empty = 0; } row += p; }
      }
      if (empty) row += String(empty);
      rows.push(row);
    }
    return rows.join('/');
  };

  const sqToRC = (sq) => {
    if (!sq || sq.length !== 2) return null;
    const file = sq.charCodeAt(0) - 97;
    const rank = sq.charCodeAt(1) - 49; // 0..7 for ranks 1..8
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return { r: 7 - rank, c: file }; // FEN top row is 8
  };

  const rcToSq = (r, c) => String.fromCharCode(97 + c) + String.fromCharCode(49 + (7 - r));

  // Material-only evaluation (white positive)
  const evaluate = (board) => {
    let score = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p === '.') continue;
        const pv = pieceValue[p.toLowerCase()] ?? 0;
        score += isWhite(p) ? pv : -pv;
      }
    }
    return score;
  };

  // Generate a small set of pseudo-legal moves (pawns + knights + king one-square; no checks)
  const genMoves = (pos) => {
    const sideWhite = pos.stm === 'w';
    const moves = [];
    const add = (fr, fc, tr, tc, promo = '') => {
      if (!inside(tr, tc)) return;
      const fromP = pos.board[fr][fc];
      const toP = pos.board[tr][tc];
      if (fromP === '.') return;
      if (sideWhite && !isWhite(fromP)) return;
      if (!sideWhite && !isBlack(fromP)) return;
      if (toP !== '.' && (isWhite(fromP) === isWhite(toP))) return;
      const uci = rcToSq(fr, fc) + rcToSq(tr, tc) + promo;
      moves.push({ from: { r: fr, c: fc }, to: { r: tr, c: tc }, uci });
    };

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = pos.board[r][c];
        if (p === '.') continue;
        if (sideWhite && !isWhite(p)) continue;
        if (!sideWhite && !isBlack(p)) continue;
        const pl = p.toLowerCase();
        if (pl === 'p') {
          const dir = sideWhite ? -1 : 1; // white moves up (toward lower r)
          const startRank = sideWhite ? 6 : 1;
          // single step
          if (inside(r + dir, c) && pos.board[r + dir][c] === '.') add(r, c, r + dir, c);
          // double step from start
          if (r === startRank && pos.board[r + dir][c] === '.' && pos.board[r + 2 * dir][c] === '.') add(r, c, r + 2 * dir, c);
          // captures
          for (const dc of [-1, 1]) {
            const tr = r + dir, tc = c + dc;
            if (!inside(tr, tc)) continue;
            const target = pos.board[tr][tc];
            if (target !== '.' && (isWhite(target) !== sideWhite)) add(r, c, tr, tc);
          }
        } else if (pl === 'n') {
          const deltas = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
          for (const [dr, dc] of deltas) add(r, c, r + dr, c + dc);
        } else if (pl === 'k') {
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            add(r, c, r + dr, c + dc);
          }
        } else if (pl === 'b' || pl === 'r' || pl === 'q') {
          const rays = [];
          if (pl !== 'r') rays.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
          if (pl !== 'b') rays.push([-1, 0], [1, 0], [0, -1], [0, 1]);
          for (const [dr, dc] of rays) {
            let tr = r + dr, tc = c + dc;
            while (inside(tr, tc)) {
              const tp = pos.board[tr][tc];
              if (tp === '.') { add(r, c, tr, tc); }
              else { if (isWhite(tp) !== isWhite(p)) add(r, c, tr, tc); break; }
              tr += dr; tc += dc;
            }
          }
        }
      }
    }
    // Small random shuffle for tie-break stability control
    moves.sort(() => rand() - 0.5);
    return moves;
  };

  const findKingSquare = (board, white) => {
    const target = white ? 'K' : 'k';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] === target) return { r, c };
      }
    }
    return null;
  };

  // Filter moves by 2-ply rule: after making the move, if any opponent pseudo-legal
  // reply captures the moving side's king, then the move is illegal (pruned).
  const legalMoves2Ply = (fen) => {
    const pos = parseFEN(fen);
    if (!pos) return { moves: [], nodes: 0 };
    const sideWhite = pos.stm === 'w';
    const parentMoves = genMoves(pos);
    const legal = [];
    let nodes = 0;
    for (const m of parentMoves) {
      const np = applyMove(pos, m);
      const kingSq = findKingSquare(np.board, sideWhite);
      if (!kingSq) continue; // king already gone -> illegal
      const replies = genMoves(np);
      nodes += 1 + replies.length;
      let kingCapturable = false;
      for (const rm of replies) {
        if (rm.to.r === kingSq.r && rm.to.c === kingSq.c) { kingCapturable = true; break; }
      }
      if (!kingCapturable) legal.push(m.uci);
    }
    return { moves: legal, nodes };
  };

  const applyMove = (pos, move, promo = '') => {
    const board = pos.board.map(row => row.slice());
    const piece = board[move.from.r][move.from.c];
    board[move.from.r][move.from.c] = '.';
    let placed = piece;
    if (promo) placed = isWhite(piece) ? promo.toUpperCase() : promo.toLowerCase();
    board[move.to.r][move.to.c] = placed;
    const newStm = pos.stm === 'w' ? 'b' : 'w';
    let full = parseInt(pos.full, 10) || 1;
    if (pos.stm === 'b') full += 1;
    return {
      board,
      stm: newStm,
      castling: pos.castling,
      ep: '-',
      half: pos.half,
      full: String(full)
    };
  };

  const posToFEN = (pos) => `${encodeBoard(pos.board)} ${pos.stm} ${pos.castling || '-'} ${pos.ep || '-'} ${pos.half || '0'} ${pos.full || '1'}`;

  const choose = (fen, opts) => {
    const pos = parseFEN(fen);
    if (!pos) return null;
    const sideWhite = pos.stm === 'w';
    const moves = genMoves(pos);
    if (moves.length === 0) return { uci: null, score: 0, nodes: 0, explain: 'No moves available.' };
    const base = evaluate(pos.board);
    let bestIdx = -1;
    let bestScore = sideWhite ? -1e9 : 1e9;
    let nodes = 0;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const np = applyMove(pos, m);
      const sc = evaluate(np.board);
      nodes++;
      if (sideWhite) {
        if (sc > bestScore) { bestScore = sc; bestIdx = i; }
      } else {
        if (sc < bestScore) { bestScore = sc; bestIdx = i; }
      }
    }
    if (bestIdx < 0) bestIdx = 0; // fallback
    const chosen = moves[bestIdx];
    const cp = bestScore; // absolute eval after move
    const delta = (sideWhite ? (bestScore - base) : (base - bestScore));
    const math = `one-ply material: base=${base}cp, after=${bestScore}cp, delta=${delta}cp, nodes=${nodes}`;
    return { uci: chosen.uci, score: cp, nodes, explain: math };
  };

  const EngineBridge = {
    wasmReady: false,
    wasmModule: null,

    setDebug(flag) { debug = !!flag; },
    setRandomSeed(seed) { prngState = (seed >>> 0) || 1; },

    evaluateFEN(fen) {
      const pos = parseFEN(fen);
      if (!pos) return 0;
      return evaluate(pos.board);
    },

    chooseBestMove(fen, optionsJson) {
      try {
        const opts = optionsJson ? JSON.parse(optionsJson) : {};
        const res = choose(fen, opts) || { uci: null, score: 0, nodes: 0, explain: 'no-result' };
        const out = {
          depth: 1,
          nodesTotal: res.nodes || 0,
          best: { uci: res.uci, score: res.score },
          explain: { math: res.explain }
        };
        return JSON.stringify(out);
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    },

    listLegalMoves2Ply(fen, optionsJson) {
      try {
        const res = legalMoves2Ply(fen);
        return JSON.stringify({ moves: res.moves, nodesTotal: res.nodes, ply: 2 });
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    },

    applyMoveIfLegal(fen, uci, opts) {
      try {
        if (!fen || !uci || uci.length < 4) return null;
        const pos = parseFEN(fen);
        if (!pos) return null;
        const from = sqToRC(uci.slice(0, 2));
        const to = sqToRC(uci.slice(2, 4));
        const promo = uci.length > 4 ? uci.slice(4, 5).toLowerCase() : '';
        if (!from || !to) return null;
        const piece = pos.board[from.r][from.c];
        if (piece === '.') return null;
        if (pos.stm === 'w' && !isWhite(piece)) return null;
        if (pos.stm === 'b' && !isBlack(piece)) return null;
        // Apply without strict legality checks
        const np = applyMove(pos, { from, to }, promo);
        return posToFEN(np);
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    }
  };

  global.EngineBridge = EngineBridge;
  EngineBridge.wasmReady = true;
  try {
    const evt = new Event('engine-bridge-ready');
    window.dispatchEvent(evt);
  } catch (e) {
    const evt = document.createEvent('Event');
    evt.initEvent('engine-bridge-ready', true, true);
    window.dispatchEvent(evt);
  }
})(window);
