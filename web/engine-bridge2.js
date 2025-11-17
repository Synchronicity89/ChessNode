// Engine bridge v2 (fresh implementation)
// Provides a minimal chess "engine" that selects a preferred move
// based on one-ply material evaluation. No UI-side move selection occurs;
// the presentation must apply exactly the returned move.

(function (global) {
  'use strict';

  // Minimal window/document polyfill when running under plain node (vitest node env)
  if (typeof window === 'undefined') {
    global.window = {};
    const listeners = {};
    window.addEventListener = (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); };
    window.dispatchEvent = (evt) => {
      const arr = listeners[evt.type] || [];
      for (const fn of arr) fn(evt);
    };
    if (!global.document) {
      global.document = {
        createEvent: () => ({ initEvent: function(type){ this.type = type; }, type: '' })
      };
    }
  }

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

  // Material-only evaluation (white positive). Returns centipawns.
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
      const move = { from: { r: fr, c: fc }, to: { r: tr, c: tc }, uci };
      if (promo) move.promo = promo;
      moves.push(move);
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
          const promoRank = sideWhite ? 0 : 7;
          // single step
          if (inside(r + dir, c) && pos.board[r + dir][c] === '.') {
            const tr = r + dir, tc = c;
            if (tr === promoRank) {
              add(r, c, tr, tc, 'q'); add(r, c, tr, tc, 'r'); add(r, c, tr, tc, 'b'); add(r, c, tr, tc, 'n');
            } else {
              add(r, c, tr, tc);
            }
          }
          // double step from start
          if (r === startRank && pos.board[r + dir][c] === '.' && pos.board[r + 2 * dir][c] === '.') add(r, c, r + 2 * dir, c);
          // captures
          for (const dc of [-1, 1]) {
            const tr = r + dir, tc = c + dc;
            if (!inside(tr, tc)) continue;
            const target = pos.board[tr][tc];
            if (target !== '.' && (isWhite(target) !== sideWhite)) {
              if (tr === promoRank) {
                add(r, c, tr, tc, 'q'); add(r, c, tr, tc, 'r'); add(r, c, tr, tc, 'b'); add(r, c, tr, tc, 'n');
              } else {
                add(r, c, tr, tc);
              }
            }
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

  // Determine if a given square (r,c) is attacked by the opponent of `sideWhite` in position `pos.board`.
  // Uses a lightweight direct attack scan (no recursion) to allow more precise legality filtering than
  // relying on opponent move generation that may include illegal pinned moves.
  function squareAttacked(pos, r, c, byWhite) {
      // Pawns: to see if (r,c) is attacked by pawns of color `byWhite`, we must look one rank
      // behind the target square relative to that color's forward direction.
      // White pawns attack (pr-1, pc±1); Black pawns attack (pr+1, pc±1).
      // Therefore for target (r,c): white pawn attackers are at (r+1, c±1); black pawn attackers at (r-1, c±1).
      const dir = byWhite ? -1 : 1; // original forward direction (white: -1)
      const pawnRow = byWhite ? r + 1 : r - 1;
      for (const dc of [-1, 1]) {
        const pc = c + dc;
        if (inside(pawnRow, pc)) {
          const p = pos.board[pawnRow][pc];
          if (p !== '.' && p.toLowerCase() === 'p' && (byWhite ? isWhite(p) : isBlack(p))) return true;
        }
      }
    // Knights
    const knightDeltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for (const [dr, dc] of knightDeltas) {
      const nr = r + dr, nc = c + dc;
      if (!inside(nr, nc)) continue;
      const p = pos.board[nr][nc];
      if (p !== '.' && p.toLowerCase() === 'n' && (byWhite ? isWhite(p) : isBlack(p))) return true;
    }
    // Sliding pieces: bishops/rooks/queens
    const rays = [
      [-1,-1],[-1,1],[1,-1],[1,1], // diagonals
      [-1,0],[1,0],[0,-1],[0,1]    // orthogonals
    ];
    for (const [dr, dc] of rays) {
      let nr = r + dr, nc = c + dc;
      while (inside(nr, nc)) {
        const p = pos.board[nr][nc];
        if (p !== '.') {
          const whiteP = isWhite(p);
          if ((byWhite && whiteP) || (!byWhite && !whiteP)) {
            const pl = p.toLowerCase();
            const diag = dr !== 0 && dc !== 0;
            const ortho = (dr === 0 || dc === 0);
            if ((diag && (pl === 'b' || pl === 'q')) || (ortho && (pl === 'r' || pl === 'q'))) return true;
          }
          break; // blocked by any piece
        }
        nr += dr; nc += dc;
      }
    }
    // King proximity
    for (let kr = -1; kr <= 1; kr++) for (let kc = -1; kc <= 1; kc++) {
      if (kr === 0 && kc === 0) continue;
      const nr = r + kr, nc = c + kc;
      if (!inside(nr, nc)) continue;
      const p = pos.board[nr][nc];
      if (p !== '.' && p.toLowerCase() === 'k' && (byWhite ? isWhite(p) : isBlack(p))) return true;
    }
    return false;
  }

  // Produce fully legal moves (filtering king exposure) based on pseudo move list.
  function generateLegalMoves(pos) {
    const sideWhite = pos.stm === 'w';
    const pseudo = genMoves(pos);
    const legal = [];
    const kingSq = findKingSquare(pos.board, sideWhite);
    for (const m of pseudo) {
      const child = applyMove(pos, m);
      // After move, original side's king might have moved; recompute its square.
      const ksq = findKingSquare(child.board, sideWhite);
      if (!ksq) continue; // king vanished (illegal capture)
      // If square is attacked by opponent in child, move illegal.
      if (squareAttacked(child, ksq.r, ksq.c, !sideWhite)) continue;
      legal.push(m);
    }
    return legal;
  }

  const findKingSquare = (board, white) => {
    const target = white ? 'K' : 'k';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c] === target) return { r, c };
      }
    }
    return null;
  };

  // True if the given color's king is attacked in this position (pseudo-legal attack test)
  const isKingAttacked = (pos, kingWhite) => {
    const ksq = findKingSquare(pos.board, kingWhite);
    if (!ksq) return true;
    return squareAttacked(pos, ksq.r, ksq.c, !kingWhite);
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
      nodes += 1;
      if (!isKingAttacked(np, sideWhite)) {
        // legal if own king is not attacked after the move
        legal.push(m.uci);
      }
    }
    return { moves: legal, nodes };
  };

  const applyMove = (pos, move, promo = '') => {
    const board = pos.board.map(row => row.slice());
    const piece = board[move.from.r][move.from.c];
    board[move.from.r][move.from.c] = '.';
    // Determine promotion piece: prefer explicit arg, else move.promo, else parse from UCI.
    let promoChar = promo;
    if (!promoChar && move && move.promo) promoChar = move.promo;
    if (!promoChar && move && move.uci && move.uci.length > 4) promoChar = move.uci.slice(4, 5).toLowerCase();
    let placed = piece;
    if (promoChar) placed = isWhite(piece) ? promoChar.toUpperCase() : promoChar.toLowerCase();
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

  const repetitionKeyFromPos = (pos) => {
    if (!pos) return null;
    const castling = pos.castling && pos.castling !== '' ? pos.castling : '-';
    const ep = pos.ep && pos.ep !== '' ? pos.ep : '-';
    return `${encodeBoard(pos.board)} ${pos.stm} ${castling} ${ep}`;
  };

  function buildRepetitionTracker(opts) {
    const repOpts = opts && opts.repetition ? opts.repetition : null;
    const threshold = Math.max(2, Math.floor(repOpts && repOpts.threshold ? repOpts.threshold : 3) || 3);
    const tracker = {
      counts: new Map(),
      threshold,
      keyFn: repetitionKeyFromPos,
      drawKeys: new Set()
    };

    if (!repOpts) return tracker;

    const addKey = (key, inc = 1) => {
      if (!key) return;
      const delta = Number(inc) || 0;
      if (delta <= 0) return;
      tracker.counts.set(key, (tracker.counts.get(key) || 0) + delta);
    };

    const ingestFen = (fenText, weight = 1) => {
      if (!fenText || typeof fenText !== 'string') return;
      const parsed = parseFEN(fenText);
      if (!parsed) return;
      addKey(repetitionKeyFromPos(parsed), weight);
    };

    if (Array.isArray(repOpts.history)) {
      for (const entry of repOpts.history) {
        if (!entry) continue;
        if (typeof entry === 'string') {
          ingestFen(entry, 1);
        } else if (typeof entry === 'object') {
          if (entry.fen) ingestFen(entry.fen, entry.count || 1);
          else if (entry.key) addKey(String(entry.key), entry.count || 1);
        }
      }
    }

    if (Array.isArray(repOpts.keys)) {
      for (const key of repOpts.keys) addKey(String(key), 1);
    }

    if (repOpts.keyCounts && typeof repOpts.keyCounts === 'object') {
      for (const [key, count] of Object.entries(repOpts.keyCounts)) addKey(String(key), count);
    }

    return tracker;
  }

  // Terminal override scoring from white's perspective focused on stalemate-as-zero.
  // Returns 0 for stalemate/insufficient material/repetition, else null.
  function mateFactorWhite(pos, options) {
    try {
      const fastOnly = !!(options && options.fastOnly);
      const repetitionInfo = options && options.repetitionInfo;
      if (repetitionInfo && repetitionInfo.isDraw) {
        if (repetitionInfo.markDraw) repetitionInfo.markDraw();
        return 0;
      }
      if (onlyTwoKings(pos.board)) return 0;
      if (fastOnly) return null;
      const sideWhite = pos.stm === 'w';
      const pseudo = genMoves(pos);
      let hasLegal = false;
      for (const m of pseudo) { const child = applyMove(pos, m); if (!isKingAttacked(child, sideWhite)) { hasLegal = true; break; } }
      if (!hasLegal) {
        const inCheck = isKingAttacked(pos, sideWhite);
        if (!inCheck) return 0; // stalemate
        // For checkmates, let the main search terminal scoring handle (MATE-depth).
        return null;
      }
      return null;
    } catch {
      return null;
    }
  }

  // Basic alpha-beta negamax style search (side to move maximizes its perspective).
  // We keep evaluation white-positive; for black we negate when comparing.
  function orderMoves(pos, moves) {
    // Simple MVV/LVA style: prioritize captures by captured piece value descending.
    const scored = [];
    for (const m of moves) {
      const target = pos.board[m.to.r][m.to.c];
      const val = target === '.' ? 0 : (pieceValue[target.toLowerCase()] || 0);
      // Small random jitter to break ties deterministically via PRNG
      scored.push({ m, score: val + rand() * 0.01 });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.m);
  }

  function search(pos, depth, alpha, beta, nodesObj, ctx) {
    const sideWhite = pos.stm === 'w';
    let repKey = null;
    let prevRepCount = 0;
    let repetitionInfo = null;
    if (ctx && ctx.rep) {
      repKey = ctx.rep.keyFn(pos);
      prevRepCount = ctx.rep.counts.get(repKey) || 0;
      const nextCount = prevRepCount + 1;
      ctx.rep.counts.set(repKey, nextCount);
      repetitionInfo = {
        key: repKey,
        isDraw: nextCount >= ctx.rep.threshold,
        markDraw: () => ctx.rep.drawKeys.add(repKey)
      };
    }

    const fastMate = mateFactorWhite(pos, { repetitionInfo, fastOnly: true });
    if (fastMate !== null && fastMate !== undefined) {
      if (ctx && ctx.rep && repKey) {
        if (prevRepCount === 0) ctx.rep.counts.delete(repKey);
        else ctx.rep.counts.set(repKey, prevRepCount);
      }
      return { score: sideWhite ? fastMate : -fastMate, pv: [] };
    }

    // Generate and filter to legal moves (do not leave own king attacked)
    const legal = generateLegalMoves(pos);
    if (legal.length === 0) {
      // Terminal: no legal moves. If in check -> checkmate; else stalemate
      const inCheck = isKingAttacked(pos, sideWhite);
      if (inCheck) {
        // Losing for side to move. Scale with remaining depth to prefer faster mates.
        const MATE = 1000000;
        if (ctx && ctx.rep && repKey) {
          if (prevRepCount === 0) ctx.rep.counts.delete(repKey);
          else ctx.rep.counts.set(repKey, prevRepCount);
        }
        return { score: - (MATE - depth), pv: [] };
      }
      if (ctx && ctx.rep && repKey) {
        if (prevRepCount === 0) ctx.rep.counts.delete(repKey);
        else ctx.rep.counts.set(repKey, prevRepCount);
      }
      return { score: 0, pv: [] };
    }
    if (depth === 0) {
      nodesObj.count++;
      const mf = mateFactorWhite(pos, { repetitionInfo, fastOnly: false });
      if (mf !== null && mf !== undefined) {
        if (ctx && ctx.rep && repKey) {
          if (prevRepCount === 0) ctx.rep.counts.delete(repKey);
          else ctx.rep.counts.set(repKey, prevRepCount);
        }
        return { score: sideWhite ? mf : -mf, pv: [] };
      }
      const baseEval = evaluate(pos.board);
      if (ctx && ctx.rep && repKey) {
        if (prevRepCount === 0) ctx.rep.counts.delete(repKey);
        else ctx.rep.counts.set(repKey, prevRepCount);
      }
      return { score: sideWhite ? baseEval : -baseEval, pv: [] };
    }
    const ordered = orderMoves(pos, legal);
    let best = { score: -1e9, pv: [], move: null };
    for (const m of ordered) {
      const child = applyMove(pos, m);
      // Skip moves that leave our own king attacked (illegal when in check)
      if (isKingAttacked(child, sideWhite)) {
        continue;
      }
      const res = search(child, depth - 1, -beta, -alpha, nodesObj, ctx);
      const curScore = -res.score; // negamax flip back for this ply
      if (curScore > best.score) {
        best.score = curScore;
        best.pv = [m.uci].concat(res.pv);
        best.move = m;
      }
      alpha = Math.max(alpha, curScore);
      if (alpha >= beta) break; // alpha-beta cutoff
    }
    if (ctx && ctx.rep && repKey) {
      if (prevRepCount === 0) ctx.rep.counts.delete(repKey);
      else ctx.rep.counts.set(repKey, prevRepCount);
    }
    return best;
  }

  const choose = (fen, opts) => {
    const pos = parseFEN(fen);
    if (!pos) return null;
    // Removed artificial cap: allow arbitrary user-specified depth (be cautious of large branching).
    const requestedDepth = Math.max(1, (opts && (opts.searchDepth || opts.depth)) || 1);
    const nodesObj = { count: 0 };
    const baseEval = evaluate(pos.board);
    const repTracker = buildRepetitionTracker(opts);
    const ctx = { rep: repTracker };
    if (ctx.rep) {
      ctx.rep.rootKey = ctx.rep.keyFn(pos);
      ctx.rep.rootBaseCount = ctx.rep.counts.get(ctx.rep.rootKey) || 0;
    }
    const result = search(pos, requestedDepth, -1e9, 1e9, nodesObj, ctx);
    if (!result.move) {
      const fallbackScore = (typeof result.score === 'number') ? result.score : baseEval;
      return {
        uci: null,
        score: fallbackScore,
        nodes: nodesObj.count,
        explain: result.explain || 'No moves available.',
        depth: requestedDepth,
        pv: result.pv || [],
        rootDrawByRepetition: !!(ctx.rep && ctx.rep.drawKeys && ctx.rep.drawKeys.has(ctx.rep.rootKey))
      };
    }
    const afterEvalPos = applyMove(pos, result.move);
    let afterEval;
    const mfChild = mateFactorWhite(afterEvalPos);
    if (mfChild !== null && mfChild !== undefined) afterEval = mfChild; else afterEval = evaluate(afterEvalPos.board);
    const sideWhite = pos.stm === 'w';
    const delta = sideWhite ? (afterEval - baseEval) : (baseEval - afterEval);
    const math = `depth=${requestedDepth} negamax material: base=${baseEval}cp, bestChildAfter=${afterEval}cp, immediateDelta=${delta}cp, nodes=${nodesObj.count}, pv=${result.pv.join(' ')}`;
    // Score reported as absolute (white perspective) like before: evaluate(after position)
    return {
      uci: result.move.uci,
      score: afterEval,
      nodes: nodesObj.count,
      explain: math,
      depth: requestedDepth,
      pv: result.pv,
      rootDrawByRepetition: !!(ctx.rep && ctx.rep.drawKeys && ctx.rep.drawKeys.has(ctx.rep.rootKey))
    };
  };

  // Insufficient material: most obvious case requested — only two kings remain
  function onlyTwoKings(board) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p === '.' || p === 'k' || p === 'K') continue;
      return false;
    }
    return true;
  }

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
        const pos = parseFEN(fen);
        let status = 'ok';
        if (pos) {
          const sideWhite = pos.stm === 'w';
          // Legal moves existence check
          const pseudo = genMoves(pos);
          let legalCount = 0;
          for (const m of pseudo) { const child = applyMove(pos, m); if (!isKingAttacked(child, sideWhite)) { legalCount++; break; } }
          if (legalCount === 0) {
            status = isKingAttacked(pos, sideWhite) ? 'checkmate' : 'stalemate';
          } else if (onlyTwoKings(pos.board)) {
            status = 'draw-insufficient';
          }
        }
        const res = choose(fen, opts) || { uci: null, score: 0, nodes: 0, explain: 'no-result', depth: (opts && opts.searchDepth) || 1 };
        if (res.rootDrawByRepetition) {
          status = 'draw-repetition';
        }

        // Optional candidate move dump for diagnostics (material disadvantage / draw-seeking behavior)
        let candidates = undefined;
        if (opts && opts.debugMoves && pos) {
          try {
            const sideWhite = pos.stm === 'w';
            const baseMf = mateFactorWhite(pos);
            const baseEval = (baseMf !== null && baseMf !== undefined) ? baseMf : evaluate(pos.board);
            const pseudo = genMoves(pos);
            candidates = [];
            for (const m of pseudo) {
              const child = applyMove(pos, m);
              if (isKingAttacked(child, sideWhite)) continue; // skip illegal
              let afterEval;
              const mf = mateFactorWhite(child);
              // Map child terminal to status for diagnostics
              let childStatus = 'ok';
              if (mf !== null && mf !== undefined) {
                childStatus = 'stalemate';
                afterEval = mf; // 0
              } else {
                afterEval = evaluate(child.board);
                if (onlyTwoKings(child.board)) childStatus = 'draw-insufficient';
              }
              const delta = sideWhite ? (afterEval - baseEval) : (baseEval - afterEval);
              candidates.push({ uci: m.uci, afterEval, delta, childStatus });
            }
            // Sort candidates by delta descending (engine perspective)
            candidates.sort((a, b) => b.delta - a.delta);
          } catch (e) {
            candidates = [{ error: String(e) }];
          }
        }
        const out = {
          depth: res.depth || ((opts && opts.searchDepth) || 1),
            nodesTotal: res.nodes || 0,
            best: { uci: res.uci, score: res.score },
            pv: res.pv || [],
            status,
            explain: { math: res.explain }
        };
        if (candidates) out.candidates = candidates;
        return JSON.stringify(out);
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    },

    // Testing/diagnostic helper: is side-to-move in check; if color provided ('w'|'b'), test that color instead
    isInCheck(fen, color) {
      try {
        const pos = parseFEN(fen);
        if (!pos) return false;
        const testWhite = (color ? color : pos.stm) === 'w';
        return isKingAttacked(pos, testWhite);
      } catch {
        return false;
      }
    },

    detectTerminal(fen) {
      try {
        const pos = parseFEN(fen);
        if (!pos) return JSON.stringify({ status: 'error' });
        if (onlyTwoKings(pos.board)) return JSON.stringify({ status: 'draw-insufficient' });
        const sideWhite = pos.stm === 'w';
        const pseudo = genMoves(pos);
        let hasLegal = false;
        for (const m of pseudo) { const child = applyMove(pos, m); if (!isKingAttacked(child, sideWhite)) { hasLegal = true; break; } }
        if (!hasLegal) {
          const inCheck = isKingAttacked(pos, sideWhite);
          if (inCheck) return JSON.stringify({ status: 'checkmate', winner: sideWhite ? 'b' : 'w' });
          return JSON.stringify({ status: 'stalemate' });
        }
        return JSON.stringify({ status: 'ok' });
      } catch (e) {
        return JSON.stringify({ status: 'error', error: String(e) });
      }
    },

    // Diagnostic helper: returns terminal status plus pseudo vs fully legal move counts and check flag.
    debugTerminal(fen) {
      try {
        const pos = parseFEN(fen);
        if (!pos) return { status: 'error' };
        const sideWhite = pos.stm === 'w';
        const pseudo = genMoves(pos);
        let legalCount = 0;
        for (const m of pseudo) { const child = applyMove(pos, m); if (!isKingAttacked(child, sideWhite)) legalCount++; }
        const inCheck = isKingAttacked(pos, sideWhite);
        let status = 'ok';
        if (onlyTwoKings(pos.board)) status = 'draw-insufficient';
        else if (legalCount === 0) status = inCheck ? 'checkmate' : 'stalemate';
        return { status, pseudoCount: pseudo.length, legalCount, inCheck };
      } catch (e) {
        return { status: 'error', error: String(e) };
      }
    },

    // Detailed move legality dump for diagnostics: returns array of { uci, legal }
    debugMovesForFen(fen) {
      try {
        const pos = parseFEN(fen);
        if (!pos) return [];
        const sideWhite = pos.stm === 'w';
        const pseudo = genMoves(pos);
        const out = [];
        for (const m of pseudo) {
          const child = applyMove(pos, m);
          const legal = !isKingAttacked(child, sideWhite);
          out.push({ uci: m.uci, legal });
        }
        return out;
      } catch (e) {
        return [{ error: String(e) }];
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

  // In browser invocation where global is window, assigning global.EngineBridge suffices.
  // In node (no real window at invocation time) we polyfilled global.window inside this IIFE,
  // but the invocation argument was globalThis, so window.EngineBridge would remain undefined.
  // Provide a mirrored assignment so tests that reference window.EngineBridge succeed in node env.
  global.EngineBridge = EngineBridge;
  if (global.window && !global.window.EngineBridge) {
    global.window.EngineBridge = EngineBridge;
  }
  EngineBridge.wasmReady = true;
  try {
    const evt = new Event('engine-bridge-ready');
    window.dispatchEvent(evt);
  } catch (e) {
    const evt = document.createEvent('Event');
    evt.initEvent('engine-bridge-ready', true, true);
    window.dispatchEvent(evt);
  }
})(typeof window !== 'undefined' ? window : globalThis);
