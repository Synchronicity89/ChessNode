// Engine bridge v2 (refactored clean implementation)
// Provides minimal chess engine with unified terminal evaluation.
(function (global) {
  'use strict';

  // Polyfill window/document in node test environment
  if (typeof window === 'undefined') {
    global.window = {};
    const listeners = {};
    window.addEventListener = (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); };
    window.dispatchEvent = (evt) => {
      const arr = listeners[evt.type] || [];
      for (const fn of arr) try { fn(evt); } catch { /* ignore */ }
    };
    if (!global.document) {
      global.document = {
        createEvent: (type) => ({ initEvent: function (t) { this.type = t; }, type })
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

  const rand = () => { // xor shift tie-break
    prngState ^= prngState << 13; prngState >>>= 0;
    prngState ^= prngState >>> 17; prngState >>>= 0;
    prngState ^= prngState << 5; prngState >>>= 0;
    return prngState / 0xffffffff;
  };

  function parseFEN(fen) {
    if (!fen || typeof fen !== 'string') return null;
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const [placement, stm, castling = '-', ep = '-', half = '0', full = '1'] = parts;
    const rows = placement.split('/'); if (rows.length !== 8) return null;
    const board = Array.from({ length: 8 }, () => Array(8).fill('.'));
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        if (/^[1-8]$/.test(ch)) c += parseInt(ch, 10); else board[r][c++] = ch;
      }
      if (c !== 8) return null;
    }
    return { board, stm, castling, ep, half, full };
  }

  // Helpers for Chess960/X-FEN castling rights
  const fileIndex = (ch) => ch.charCodeAt(0) - 97; // 'a' -> 0
  const isFileLetterWhite = (ch) => ch >= 'A' && ch <= 'H';
  const isFileLetterBlack = (ch) => ch >= 'a' && ch <= 'h';
  function computeCastleRights(pos) {
    const rights = { w: { kingSide: null, queenSide: null }, b: { kingSide: null, queenSide: null } };
    const cs = (pos.castling && pos.castling !== '-') ? String(pos.castling) : '';
    const wK = findKingSquare(pos.board, true);
    const bK = findKingSquare(pos.board, false);
    const wKR = 7, wQR = 0, bKR = 7, bQR = 0; // standard rook files as fallback
    // Accept classic KQkq
    if (cs.includes('K')) rights.w.kingSide = { rookFile: wKR };
    if (cs.includes('Q')) rights.w.queenSide = { rookFile: wQR };
    if (cs.includes('k')) rights.b.kingSide = { rookFile: bKR };
    if (cs.includes('q')) rights.b.queenSide = { rookFile: bQR };
    // Accept X-FEN letters for rooks
    for (const ch of cs) {
      if (isFileLetterWhite(ch)) {
        const rf = ch.charCodeAt(0) - 65; // 'A'->0
        if (wK) { if (rf > wK.c) rights.w.kingSide = { rookFile: rf }; else if (rf < wK.c) rights.w.queenSide = { rookFile: rf }; }
      } else if (isFileLetterBlack(ch)) {
        const rf = fileIndex(ch);
        if (bK) { if (rf > bK.c) rights.b.kingSide = { rookFile: rf }; else if (rf < bK.c) rights.b.queenSide = { rookFile: rf }; }
      }
    }
    return rights;
  }

  function removeCastlingForSide(castling, side) {
    if (!castling || castling === '-') return '-';
    const keep = [];
    for (const ch of castling) {
      if (side === 'w') {
        if (ch === 'K' || ch === 'Q' || (ch >= 'A' && ch <= 'H')) continue; // drop all white rights
        keep.push(ch);
      } else {
        if (ch === 'k' || ch === 'q' || (ch >= 'a' && ch <= 'h')) continue; // drop all black rights
        keep.push(ch);
      }
    }
    return keep.length ? keep.join('') : '-';
  }

  function removeCastlingForRook(castling, side, rookFile) {
    if (!castling || castling === '-') return castling || '-';
    const targetUpper = String.fromCharCode(65 + rookFile);
    const targetLower = String.fromCharCode(97 + rookFile);
    const keep = [];
    for (const ch of castling) {
      if (side === 'w') {
        if (ch === 'K' && (rookFile === 7)) continue;
        if (ch === 'Q' && (rookFile === 0)) continue;
        if (ch === targetUpper) continue;
        keep.push(ch);
      } else {
        if (ch === 'k' && (rookFile === 7)) continue;
        if (ch === 'q' && (rookFile === 0)) continue;
        if (ch === targetLower) continue;
        keep.push(ch);
      }
    }
    return keep.length ? keep.join('') : '-';
  }

  function encodeBoard(board) {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let row = ''; let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p === '.') empty++; else { if (empty) { row += String(empty); empty = 0; } row += p; }
      }
      if (empty) row += String(empty);
      rows.push(row);
    }
    return rows.join('/');
  }

  const rcToSq = (r, c) => String.fromCharCode(97 + c) + String.fromCharCode(49 + (7 - r));
  function sqToRC(sq) { if (!sq || sq.length !== 2) return null; const f = sq.charCodeAt(0) - 97; const rk = sq.charCodeAt(1) - 49; if (f < 0 || f > 7 || rk < 0 || rk > 7) return null; return { r: 7 - rk, c: f }; }

  function evaluate(board) {
    let score = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c]; if (p === '.') continue; const val = pieceValue[p.toLowerCase()] || 0;
      score += isWhite(p) ? val : -val;
    }
    return score;
  }

  function onlyTwoKings(board) {
    let pieces = 0; let nonKing = false;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c]; if (p === '.') continue; pieces++; if (p.toLowerCase() !== 'k') nonKing = true;
    }
    return pieces === 2 && !nonKing;
  }

  // Determine if square (r,c) is attacked by side indicated by byWhite.
  // Attacks considered: pawns, knights, bishops, rooks, queens, king.
  // This is a pure read; it does not mutate position state.
  function squareAttacked(pos, r, c, byWhite) {
    // Pawn attacks: a pawn that attacks (r,c) sits one rank "behind" the
    // target square relative to its forward movement direction. White pawns
    // move up (toward decreasing row index), so we look at r+1 when checking
    // if (r,c) is attacked by white; conversely r-1 for black.
    const pawnRow = byWhite ? r + 1 : r - 1;
    for (const dc of [-1, 1]) {
      const pc = c + dc;
      if (!inside(pawnRow, pc)) continue;
      const p = pos.board[pawnRow][pc];
      if (
        p !== '.' && p.toLowerCase() === 'p' &&
        (byWhite ? isWhite(p) : isBlack(p))
      ) return true;
    }

    // Knight attacks: fixed L-shaped offsets around (r,c).
    const knightDeltas = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    for (const [dr, dc] of knightDeltas) {
      const nr = r + dr, nc = c + dc;
      if (!inside(nr, nc)) continue;
      const p = pos.board[nr][nc];
      if (
        p !== '.' && p.toLowerCase() === 'n' &&
        (byWhite ? isWhite(p) : isBlack(p))
      ) return true;
    }

    // Sliding piece attacks: iterate along each ray until blocked.
    // Diagonals can deliver bishop/queen attacks; orthogonals rook/queen.
    const rays = [
      [-1, -1], [-1, 1], [1, -1], [1, 1], // diagonals
      [-1, 0], [1, 0], [0, -1], [0, 1]    // orthogonals
    ];
    for (const [dr, dc] of rays) {
      let nr = r + dr, nc = c + dc;
      while (inside(nr, nc)) {
        const p = pos.board[nr][nc];
        if (p !== '.') {
          const isPWhite = isWhite(p);
          const attackerMatches = byWhite ? isPWhite : !isPWhite;
          if (attackerMatches) {
            const pl = p.toLowerCase();
            const diagonal = dr !== 0 && dc !== 0;
            const orthogonal = dr === 0 || dc === 0;
            if (
              (diagonal && (pl === 'b' || pl === 'q')) ||
              (orthogonal && (pl === 'r' || pl === 'q'))
            ) return true;
          }
          // Blocked by first non-empty square regardless of attacker match
          break;
        }
        nr += dr; nc += dc;
      }
    }

    // King attacks: any adjacent square (Chebyshev distance 1).
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        if (!inside(nr, nc)) continue;
        const p = pos.board[nr][nc];
        if (
          p !== '.' && p.toLowerCase() === 'k' &&
          (byWhite ? isWhite(p) : isBlack(p))
        ) return true;
      }
    }
    return false;
  }

  // --- Bitboard infrastructure (new default attack detector) ---
  // We keep legacy array-based squareAttacked for fallback, but default to bitboards.
  let BITBOARD_INIT = false;
  const BB = {
    PAWN_ATTACKS_W_TO: new Array(64),
    PAWN_ATTACKS_B_TO: new Array(64),
    KNIGHT_ATTACKS: new Array(64),
    KING_ATTACKS: new Array(64)
  };
  const ONE = 1n;
  const sqIndex = (r, c) => r * 8 + c; // r:0 top (8th rank) -> consistent with board[r][c]
  const insideRC = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

  function bbMask(r, c) { return ONE << BigInt(sqIndex(r, c)); }

  function precomputeBitboards() {
    if (BITBOARD_INIT) return;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const idx = sqIndex(r, c);
      // Pawn attacks: squares from which a pawn of given color would attack (r,c)
      let wMask = 0n, bMask = 0n;
      // White pawn would be one rank below target (towards increasing r)
      const wR = r + 1;
      if (wR < 8) {
        if (c > 0) wMask |= bbMask(wR, c - 1);
        if (c < 7) wMask |= bbMask(wR, c + 1);
      }
      // Black pawn one rank above target (towards decreasing r)
      const bR = r - 1;
      if (bR >= 0) {
        if (c > 0) bMask |= bbMask(bR, c - 1);
        if (c < 7) bMask |= bbMask(bR, c + 1);
      }
      BB.PAWN_ATTACKS_W_TO[idx] = wMask;
      BB.PAWN_ATTACKS_B_TO[idx] = bMask;
      // Knight attacks
      let kMask = 0n;
      const kD = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for (const [dr, dc] of kD) { const nr = r + dr, nc = c + dc; if (insideRC(nr, nc)) kMask |= bbMask(nr, nc); }
      BB.KNIGHT_ATTACKS[idx] = kMask;
      // King attacks
      let kingM = 0n;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue; const nr = r + dr, nc = c + dc; if (insideRC(nr, nc)) kingM |= bbMask(nr, nc);
      }
      BB.KING_ATTACKS[idx] = kingM;
    }
    BITBOARD_INIT = true;
  }

  function buildPieceBitboards(pos) {
    // Construct and cache piece bitboards in pos._bb for reuse
    if (pos._bb) return pos._bb;
    precomputeBitboards();
    const bitboards = {
      WP: 0n, WN: 0n, WB: 0n, WR: 0n, WQ: 0n, WK: 0n,
      BP: 0n, BN: 0n, BB: 0n, BR: 0n, BQ: 0n, BK: 0n,
      OCC: 0n, WHITE: 0n, BLACK: 0n
    };
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = pos.board[r][c]; if (p === '.') continue; const m = bbMask(r, c);
      switch (p) {
        case 'P': bitboards.WP |= m; break;
        case 'N': bitboards.WN |= m; break;
        case 'B': bitboards.WB |= m; break;
        case 'R': bitboards.WR |= m; break;
        case 'Q': bitboards.WQ |= m; break;
        case 'K': bitboards.WK |= m; break;
        case 'p': bitboards.BP |= m; break;
        case 'n': bitboards.BN |= m; break;
        case 'b': bitboards.BB |= m; break;
        case 'r': bitboards.BR |= m; break;
        case 'q': bitboards.BQ |= m; break;
        case 'k': bitboards.BK |= m; break;
      }
    }
    bitboards.WHITE = bitboards.WP | bitboards.WN | bitboards.WB | bitboards.WR | bitboards.WQ | bitboards.WK;
    bitboards.BLACK = bitboards.BP | bitboards.BN | bitboards.BB | bitboards.BR | bitboards.BQ | bitboards.BK;
    bitboards.OCC = bitboards.WHITE | bitboards.BLACK;
    pos._bb = bitboards; // cache
    return bitboards;
  }

  function bitboardRayAttackTo(idx, occ, attackersMask, directions) {
    const r0 = Math.floor(idx / 8), c0 = idx % 8;
    for (const [dr, dc] of directions) {
      let r = r0 + dr, c = c0 + dc;
      while (insideRC(r, c)) {
        const sq = sqIndex(r, c); const mask = ONE << BigInt(sq);
        if (occ & mask) { // first occupied stops
          if (attackersMask & mask) return true;
          break;
        }
        r += dr; c += dc;
      }
    }
    return false;
  }

  function squareAttackedBitboard(pos, r, c, byWhite) {
    const bbs = buildPieceBitboards(pos);
    const idx = sqIndex(r, c);
    if (byWhite) {
      // Pawns
      if (BB.PAWN_ATTACKS_W_TO[idx] & bbs.WP) return true;
      // Knights
      if (BB.KNIGHT_ATTACKS[idx] & bbs.WN) return true;
      // King
      if (BB.KING_ATTACKS[idx] & bbs.WK) return true;
      // Diagonals: bishops or queens
      if (bitboardRayAttackTo(idx, bbs.OCC, bbs.WB | bbs.WQ, [[-1,-1],[-1,1],[1,-1],[1,1]])) return true;
      // Orthogonals: rooks or queens
      if (bitboardRayAttackTo(idx, bbs.OCC, bbs.WR | bbs.WQ, [[-1,0],[1,0],[0,-1],[0,1]])) return true;
      return false;
    } else {
      if (BB.PAWN_ATTACKS_B_TO[idx] & bbs.BP) return true;
      if (BB.KNIGHT_ATTACKS[idx] & bbs.BN) return true;
      if (BB.KING_ATTACKS[idx] & bbs.BK) return true;
      if (bitboardRayAttackTo(idx, bbs.OCC, bbs.BB | bbs.BQ, [[-1,-1],[-1,1],[1,-1],[1,1]])) return true;
      if (bitboardRayAttackTo(idx, bbs.OCC, bbs.BR | bbs.BQ, [[-1,0],[1,0],[0,-1],[0,1]])) return true;
      return false;
    }
  }

  // Switch to enable legacy attack logic for comparison
  let useLegacyAttack = false;
  function setLegacyAttackUsage(flag) { useLegacyAttack = !!flag; }

  function findKingSquare(board, white) { const target = white ? 'K' : 'k'; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c] === target) return { r, c }; return null; }
  function isKingAttacked(pos, kingWhite) { const ksq = findKingSquare(pos.board, kingWhite); if (!ksq) return true; return isSquareAttacked(pos, ksq.r, ksq.c, !kingWhite); }

  // Wrapper to choose bitboard or legacy attack function
  function isSquareAttacked(pos, r, c, byWhite) {
    return useLegacyAttack ? squareAttacked(pos, r, c, byWhite) : squareAttackedBitboard(pos, r, c, byWhite);
  }

  function genMoves(pos) {
    const sideWhite = pos.stm === 'w';
    const moves = []; const add = (fr, fc, tr, tc, promo = '') => { if (!inside(tr, tc)) return; const fromP = pos.board[fr][fc]; const toP = pos.board[tr][tc]; if (fromP === '.') return; if (sideWhite && !isWhite(fromP)) return; if (!sideWhite && !isBlack(fromP)) return; if (toP !== '.' && (isWhite(fromP) === isWhite(toP))) return; const uci = rcToSq(fr, fc) + rcToSq(tr, tc) + promo; const m = { from: { r: fr, c: fc }, to: { r: tr, c: tc }, uci }; if (promo) m.promo = promo; moves.push(m); };
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = pos.board[r][c]; if (p === '.') continue; if (sideWhite && !isWhite(p)) continue; if (!sideWhite && !isBlack(p)) continue; const pl = p.toLowerCase();
      if (pl === 'p') {
        const dir = sideWhite ? -1 : 1; const start = sideWhite ? 6 : 1; const promoRank = sideWhite ? 0 : 7;
        if (inside(r + dir, c) && pos.board[r + dir][c] === '.') { const tr = r + dir, tc = c; if (tr === promoRank) { for (const pr of ['q', 'r', 'b', 'n']) add(r, c, tr, tc, pr); } else add(r, c, tr, tc); }
        if (r === start && pos.board[r + dir][c] === '.' && pos.board[r + 2 * dir][c] === '.') add(r, c, r + 2 * dir, c);
        for (const dc of [-1, 1]) { const tr = r + dir, tc = c + dc; if (!inside(tr, tc)) continue; const target = pos.board[tr][tc]; if (target !== '.' && (isWhite(target) !== sideWhite)) { if (tr === promoRank) { for (const pr of ['q', 'r', 'b', 'n']) add(r, c, tr, tc, pr); } else add(r, c, tr, tc); } }
        // En passant capture if ep target present
        if (pos.ep && pos.ep !== '-') {
          const epRC = sqToRC(pos.ep);
          if (epRC) {
            for (const dc of [-1, 1]) {
              const tr = r + dir, tc = c + dc;
              if (!inside(tr, tc)) continue;
              if (tr === epRC.r && tc === epRC.c) {
                const uci = rcToSq(r, c) + rcToSq(tr, tc);
                moves.push({ from: { r, c }, to: { r: tr, c: tc }, uci, ep: true });
              }
            }
          }
        }
      } else if (pl === 'n') {
        const d = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]; for (const [dr, dc] of d) add(r, c, r + dr, c + dc);
      } else if (pl === 'k') {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (dr === 0 && dc === 0) continue; add(r, c, r + dr, c + dc); }
        // Castling (Standard + Chess960 with X-FEN)
        const rights = computeCastleRights(pos);
        const isW = isWhite(p);
        const rank = isW ? 7 : 0;
        const kDestK = 6, kDestQ = 2; // g-file and c-file
        if (r === rank) {
          const rs = isW ? rights.w : rights.b;
          const ksq = { r, c };
          function canCastle(side) {
            const entry = side === 'K' ? rs.kingSide : rs.queenSide; if (!entry) return false;
            const rookFile = entry.rookFile; if (rookFile == null) return false;
            const rookPiece = pos.board[rank][rookFile]; if (rookPiece.toLowerCase() !== 'r' || (isW ? !isWhite(rookPiece) : !isBlack(rookPiece))) return false;
            const kTarget = side === 'K' ? kDestK : kDestQ; const rTarget = side === 'K' ? 5 : 3;
            // 1) Squares between king and rook (exclusive) must be empty
            const minKR = Math.min(c, rookFile) + 1; const maxKR = Math.max(c, rookFile) - 1;
            for (let cc = minKR; cc <= maxKR; cc++) { if (pos.board[rank][cc] !== '.') return false; }
            // 2) King path squares from start to target inclusive must not be attacked; allow rook square to be occupied
            const dir = kTarget > c ? 1 : -1; let cur = c; // include start square check
            const opp = !isW;
            if (isSquareAttacked(pos, rank, cur, opp)) return false;
            while (cur !== kTarget) { cur += dir; if (isSquareAttacked(pos, rank, cur, opp)) return false; }
            // 3) Rook path squares between rook and its target (exclusive) must be empty, allowing the king's start square
            const minRR = Math.min(rookFile, rTarget) + 1; const maxRR = Math.max(rookFile, rTarget) - 1;
            for (let cc = minRR; cc <= maxRR; cc++) {
              if (cc === c) continue; // king vacates start square
              if (pos.board[rank][cc] !== '.') return false;
            }
            // 4) Destination squares must be empty: king target and rook target; never capture on castling
            if (kTarget !== rookFile && pos.board[rank][kTarget] !== '.') return false;
            if (pos.board[rank][rTarget] !== '.') return false;
            return true;
          }
          if (canCastle('K')) { const u = rcToSq(r, c) + rcToSq(rank, kDestK); moves.push({ from: { r, c }, to: { r: rank, c: kDestK }, uci: u, castle: 'K' }); }
          if (canCastle('Q')) { const u = rcToSq(r, c) + rcToSq(rank, kDestQ); moves.push({ from: { r, c }, to: { r: rank, c: kDestQ }, uci: u, castle: 'Q' }); }
        }
      } else if (pl === 'b' || pl === 'r' || pl === 'q') {
        const rays = []; if (pl !== 'r') rays.push([-1, -1], [-1, 1], [1, -1], [1, 1]); if (pl !== 'b') rays.push([-1, 0], [1, 0], [0, -1], [0, 1]); for (const [dr, dc] of rays) { let tr = r + dr, tc = c + dc; while (inside(tr, tc)) { const tp = pos.board[tr][tc]; if (tp === '.') add(r, c, tr, tc); else { if (isWhite(tp) !== isWhite(p)) add(r, c, tr, tc); break; } tr += dr; tc += dc; } }
      }
    }
    moves.sort(() => rand() - 0.5);
    return moves;
  }

  function generateLegalMoves(pos) { const sideWhite = pos.stm === 'w'; const pseudo = genMoves(pos); const legal = []; for (const m of pseudo) { const child = applyMove(pos, m); const kingSq = findKingSquare(child.board, sideWhite); if (!kingSq) continue; if (isSquareAttacked(child, kingSq.r, kingSq.c, !sideWhite)) continue; legal.push(m); } return legal; }

  function applyMove(pos, move) {
    const board = pos.board.map(r => r.slice());
    const piece = board[move.from.r][move.from.c];
    const moverIsWhite = isWhite(piece);
    const isPawn = piece.toLowerCase() === 'p';
    const isKing = piece.toLowerCase() === 'k';
    const rightsBefore = computeCastleRights(pos);
    // En passant capture handling: if pawn moves diagonally to ep target, remove the passed pawn
    const epTarget = pos.ep && pos.ep !== '-' ? sqToRC(pos.ep) : null;
    const isDiag = move.from.c !== move.to.c;
    const targetBefore = board[move.to.r][move.to.c];
    let enPassantCapture = false;
    if (isPawn && epTarget && move.to.r === epTarget.r && move.to.c === epTarget.c && isDiag) {
      const capR = move.to.r + (moverIsWhite ? 1 : -1);
      const capC = move.to.c;
      if (inside(capR, capC) && board[capR][capC].toLowerCase() === 'p' && isWhite(board[capR][capC]) !== moverIsWhite) {
        board[capR][capC] = '.';
        enPassantCapture = true;
      }
    }
    // Move the piece
    board[move.from.r][move.from.c] = '.';
    let placed = piece;
    if (move.promo) { placed = moverIsWhite ? move.promo.toUpperCase() : move.promo.toLowerCase(); }
    else if (move.uci.length > 4) { const promo = move.uci.slice(4, 5); if (promo) { placed = moverIsWhite ? promo.toUpperCase() : promo.toLowerCase(); } }
    board[move.to.r][move.to.c] = placed;

    // Castling rook move handling (Standard + Chess960): only when move explicitly flagged as castle
    let newCastling = pos.castling || '-';
    const backRank = moverIsWhite ? 7 : 0;
    if (isKing && move.from.r === backRank && (move.castle === 'K' || move.castle === 'Q')) {
      const side = move.castle;
      const rs = moverIsWhite ? rightsBefore.w : rightsBefore.b;
      const rookFile = side === 'K' ? (rs && rs.kingSide && rs.kingSide.rookFile) : (rs && rs.queenSide && rs.queenSide.rookFile);
      if (rookFile != null) {
        const rookDest = (side === 'K') ? 5 : 3;
        const rookChar = moverIsWhite ? 'R' : 'r';
        board[backRank][rookFile] = '.';
        board[backRank][rookDest] = rookChar;
      }
      newCastling = removeCastlingForSide(newCastling, moverIsWhite ? 'w' : 'b');
    }

    // Set next side and clocks
    const newStm = pos.stm === 'w' ? 'b' : 'w';
    let full = parseInt(pos.full, 10) || 1; if (pos.stm === 'b') full += 1;

    // Set en passant target if a pawn made a double push; otherwise clear
    let nextEp = '-';
    if (isPawn && !enPassantCapture) {
      const delta = Math.abs(move.to.r - move.from.r);
      if (delta === 2) {
        const midR = (move.to.r + move.from.r) / 2;
        nextEp = rcToSq(midR, move.from.c);
      }
    }
    // Update castling rights on rook/king moves and rook captures
    // If king moved (non-castle or castle), rights already removed above when castling; remove here if not castling as well.
    if (isKing && !(move.from.r === backRank && (move.to.c === 6 || move.to.c === 2))) {
      newCastling = removeCastlingForSide(newCastling, moverIsWhite ? 'w' : 'b');
    }
    // If rook moved from its original castling file, remove that side's corresponding right
    if (piece.toLowerCase() === 'r') {
      const rs = moverIsWhite ? rightsBefore.w : rightsBefore.b;
      if (rs.kingSide && move.from.r === backRank && move.from.c === rs.kingSide.rookFile) { newCastling = removeCastlingForRook(newCastling, moverIsWhite ? 'w' : 'b', rs.kingSide.rookFile); }
      if (rs.queenSide && move.from.r === backRank && move.from.c === rs.queenSide.rookFile) { newCastling = removeCastlingForRook(newCastling, moverIsWhite ? 'w' : 'b', rs.queenSide.rookFile); }
    }
    // If a rook was captured on its original castling file, remove opponent's corresponding right
    if (targetBefore && targetBefore.toLowerCase() === 'r') {
      const opp = moverIsWhite ? 'b' : 'w'; const rsOpp = moverIsWhite ? rightsBefore.b : rightsBefore.w; const oppBack = moverIsWhite ? 0 : 7;
      if (rsOpp.kingSide && move.to.r === oppBack && move.to.c === rsOpp.kingSide.rookFile) { newCastling = removeCastlingForRook(newCastling, opp, rsOpp.kingSide.rookFile); }
      if (rsOpp.queenSide && move.to.r === oppBack && move.to.c === rsOpp.queenSide.rookFile) { newCastling = removeCastlingForRook(newCastling, opp, rsOpp.queenSide.rookFile); }
    }

    return { board, stm: newStm, castling: newCastling, ep: nextEp, half: pos.half, full: String(full) };
  }

  function repetitionKeyFromPos(pos) { if (!pos) return null; const castling = pos.castling && pos.castling !== '' ? pos.castling : '-'; const ep = pos.ep && pos.ep !== '' ? pos.ep : '-'; return `${encodeBoard(pos.board)} ${pos.stm} ${castling} ${ep}`; }

  function buildRepetitionTracker(opts) {
    const repOpts = opts && opts.repetition ? opts.repetition : null; const threshold = Math.max(2, Math.floor(repOpts && repOpts.threshold ? repOpts.threshold : 3) || 3); const tracker = { counts: new Map(), threshold, keyFn: repetitionKeyFromPos, drawKeys: new Set() };
    if (!repOpts) return tracker;
    const addKey = (key, inc = 1) => { if (!key) return; const delta = Number(inc) || 0; if (delta <= 0) return; tracker.counts.set(key, (tracker.counts.get(key) || 0) + delta); };
    const ingestFen = (fenText, weight = 1) => { if (!fenText || typeof fenText !== 'string') return; const parsed = parseFEN(fenText); if (!parsed) return; addKey(repetitionKeyFromPos(parsed), weight); };
    if (Array.isArray(repOpts.history)) for (const entry of repOpts.history) { if (!entry) continue; if (typeof entry === 'string') ingestFen(entry, 1); else if (typeof entry === 'object') { if (entry.fen) ingestFen(entry.fen, entry.count || 1); else if (entry.key) addKey(String(entry.key), entry.count || 1); } }
    if (Array.isArray(repOpts.keys)) for (const key of repOpts.keys) addKey(String(key), 1);
    if (repOpts.keyCounts && typeof repOpts.keyCounts === 'object') for (const [k, c] of Object.entries(repOpts.keyCounts)) addKey(String(k), c);
    return tracker;
  }

  function evaluateTerminal(pos, ctx, depth, legalMoves) {
    const sideWhite = pos.stm === 'w'; const MATE = 1000000; // large value
    // repetition (non-mutating check; search is responsible for push/pop of counts)
    let repKey = null; let repDraw = false; if (ctx && ctx.rep) { repKey = ctx.rep.keyFn(pos); const cur = ctx.rep.counts.get(repKey) || 0; if (cur >= ctx.rep.threshold) { repDraw = true; ctx.rep.drawKeys.add(repKey); } }
    const insufficient = onlyTwoKings(pos.board);
    const legal = legalMoves !== undefined ? legalMoves : generateLegalMoves(pos);
    let status = 'ok'; let whiteScore = null; let isTerminal = false;
    if (insufficient) { status = 'draw-insufficient'; whiteScore = 0; isTerminal = true; }
    else if (repDraw) { status = 'draw-repetition'; whiteScore = 0; isTerminal = true; }
    else if (legal.length === 0) { const inCheck = isKingAttacked(pos, sideWhite); if (inCheck) { status = 'checkmate'; whiteScore = sideWhite ? -(MATE - depth) : +(MATE - depth); isTerminal = true; } else { status = 'stalemate'; whiteScore = 0; isTerminal = true; } }
    if (!isTerminal) { if (whiteScore === null) whiteScore = evaluate(pos.board); }
    return { isTerminal, status, whiteScore, repKey };
  }

  function orderMoves(pos, moves) {
    const scored = [];
    for (const m of moves) {
      const target = pos.board[m.to.r][m.to.c];
      const captureVal = target === '.' ? 0 : (pieceValue[target.toLowerCase()] || 0);
      let bonus = 0;
      // Strongly prioritize promotions
      if (m.promo || (m.uci && m.uci.length > 4)) {
        const pr = (m.promo || m.uci.slice(4, 5)).toLowerCase();
        bonus += (pieceValue[pr] || 0) + 700; // big push for exploring promotions
      }
      scored.push({ m, s: captureVal + bonus + rand() * 0.01 });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.map(x => x.m);
  }

  function search(pos, depth, alpha, beta, ctx, nodes) {
    const sideWhite = pos.stm === 'w';
    // repetition push
    let repKey = null, prevCount = 0; if (ctx && ctx.rep) { repKey = ctx.rep.keyFn(pos); prevCount = ctx.rep.counts.get(repKey) || 0; ctx.rep.counts.set(repKey, prevCount + 1); }
    const legal = generateLegalMoves(pos); const term = evaluateTerminal(pos, ctx, depth, legal); if (term.isTerminal) {
      if (ctx && ctx.rep && repKey) { if (prevCount === 0) ctx.rep.counts.delete(repKey); else ctx.rep.counts.set(repKey, prevCount); }
      return { score: term.whiteScore, pv: [], status: term.status };
    }
    if (depth === 0) { nodes.count++; return { score: evaluate(pos.board), pv: [] }; }
    // Root-level repetition-avoidance: optionally ban some moves at root
    let rootBan = (ctx && typeof ctx.rootDepth === 'number' && depth === ctx.rootDepth && ctx.banRootMoves) ? ctx.banRootMoves : null;
    let candidates = legal;
    if (rootBan && rootBan.size > 0) candidates = legal.filter(m => !rootBan.has(m.uci));
    const ordered = orderMoves(pos, candidates); let bestScore = -1e9; let bestPV = []; let bestMove = null;
    for (const m of ordered) {
      const child = applyMove(pos, m); const childRes = search(child, depth - 1, -beta, -alpha, ctx, nodes); let curScore = -childRes.score;
      // Root-level nudge: prefer promotion moves when comparing at root
      if (ctx && typeof ctx.rootDepth === 'number' && depth === ctx.rootDepth) {
        if (m.promo || (m.uci && m.uci.length > 4)) curScore += 1200;
      }
      if (curScore > bestScore) { bestScore = curScore; bestPV = [m.uci].concat(childRes.pv); bestMove = m; }
      alpha = Math.max(alpha, curScore); if (alpha >= beta) break;
    }
    if (ctx && ctx.rep && repKey) { if (prevCount === 0) ctx.rep.counts.delete(repKey); else ctx.rep.counts.set(repKey, prevCount); }
    return { score: bestScore, pv: bestPV, move: bestMove };
  }

  function choose(fen, opts) {
    const pos = parseFEN(fen); if (!pos) return null; const depth = Math.max(1, (opts && (opts.searchDepth || opts.depth)) || 1); const nodes = { count: 0 }; const repTracker = buildRepetitionTracker(opts); const ctx = { rep: repTracker };
    if (ctx.rep) { ctx.rep.rootKey = ctx.rep.keyFn(pos); ctx.rep.rootBaseCount = ctx.rep.counts.get(ctx.rep.rootKey) || 0; }
    // Root policy around immediate repetition when history indicates it
    const staticEval = evaluate(pos.board);
    // compute immediate-repetition child moves
    let repMoves = new Set();
    if (ctx && ctx.rep) {
      const legals = generateLegalMoves(pos);
      for (const m of legals) {
        const child = applyMove(pos, m);
        const childKey = ctx.rep.keyFn(child);
        const cur = ctx.rep.counts.get(childKey) || 0;
        if (cur + 1 >= ctx.rep.threshold) repMoves.add(m.uci);
      }
    }
    // If losing by static eval and a repetition is available immediately, take the draw now
    if (staticEval < 0 && repMoves.size > 0) {
      // pick a deterministic move from repMoves: prefer lexicographically smallest for stability
      const bestUci = Array.from(repMoves).sort()[0];
      return { uci: bestUci, score: 0, nodes: 0, depth, pv: [], rootDrawByRepetition: true, status: 'draw-repetition' };
    }
    // If winning and repetition is available, avoid it at root by banning those UCIs
    if (staticEval > 0 && repMoves.size > 0) {
      ctx.rootDepth = depth;
      ctx.banRootMoves = repMoves;
    } else {
      ctx.rootDepth = depth;
    }
    const res = search(pos, depth, -1e9, 1e9, ctx, nodes);
    // Fallback: if we avoided repetition but search still returns non-positive, choose best material move (excluding repetition) to ensure progress
    if (staticEval > 0 && repMoves.size > 0 && (!res.move || res.score <= 0)) {
      const legals = generateLegalMoves(pos);
      let best = null; let bestVal = -1e9;
      for (const m of legals) {
        if (repMoves.has(m.uci)) continue;
        const child = applyMove(pos, m);
        const val = evaluate(child.board);
        if (val > bestVal) { bestVal = val; best = m; }
      }
      if (best) {
        return { uci: best.uci, score: bestVal, nodes: nodes.count, depth, pv: [], rootDrawByRepetition: !!(ctx.rep && ctx.rep.drawKeys && ctx.rep.drawKeys.has(ctx.rep.rootKey)), status: 'ok' };
      }
    }
    if (!res.move) { return { uci: null, score: res.score, nodes: nodes.count, depth, pv: res.pv, rootDrawByRepetition: !!(ctx.rep && ctx.rep.drawKeys.has(ctx.rep.rootKey)), status: res.status || 'ok' }; }
    const after = res.score; // white perspective after best move
    return { uci: res.move.uci, score: after, nodes: nodes.count, depth, pv: res.pv, rootDrawByRepetition: !!(ctx.rep && ctx.rep.drawKeys.has(ctx.rep.rootKey)), status: res.status || 'ok' };
  }

  const EngineBridge = {
    wasmModule: null,
    setDebug(f) { debug = !!f; },
    setRandomSeed(seed) { prngState = (seed >>> 0) || 1; },
    setLegacyAttack(enabled) { setLegacyAttackUsage(enabled); },
    getLegacyAttack() { return useLegacyAttack; },
    evaluateFEN(fen) { const pos = parseFEN(fen); return pos ? evaluate(pos.board) : 0; },
    chooseBestMove(fen, optionsJson) {
      try {
        const opts = optionsJson ? JSON.parse(optionsJson) : {}; const pos = parseFEN(fen); let status = 'ok'; if (pos) { const legal = generateLegalMoves(pos); const term = evaluateTerminal(pos, { rep: buildRepetitionTracker(opts) }, 0, legal); status = term.status; }
        const res = choose(fen, opts) || { uci: null, score: 0, nodes: 0, depth: (opts && opts.searchDepth) || 1, pv: [] };
        if (res.rootDrawByRepetition) status = 'draw-repetition';
        let candidates; if (opts && opts.debugMoves && pos) {
          try {
            const sideWhite = pos.stm === 'w'; const baseEval = evaluate(pos.board); const pseudo = genMoves(pos); candidates = []; for (const m of pseudo) { const child = applyMove(pos, m); if (isKingAttacked(child, sideWhite)) continue; const childLegal = generateLegalMoves(child); const termChild = evaluateTerminal(child, { rep: null }, 0, childLegal); const afterEval = termChild.isTerminal ? termChild.whiteScore : evaluate(child.board); const childStatus = termChild.isTerminal ? termChild.status : (onlyTwoKings(child.board) ? 'draw-insufficient' : 'ok'); const delta = sideWhite ? (afterEval - baseEval) : (baseEval - afterEval); candidates.push({ uci: m.uci, afterEval, delta, childStatus }); }
            candidates.sort((a, b) => b.delta - a.delta);
          } catch (e) { candidates = [{ error: String(e) }]; }
        }
        const out = { depth: res.depth, nodesTotal: res.nodes, best: { uci: res.uci, score: res.score }, pv: res.pv || [], status, explain: { base: res.score } };
        if (candidates) out.candidates = candidates; return JSON.stringify(out);
      } catch (e) { return JSON.stringify({ error: String(e) }); }
    },
    isInCheck(fen, color) { try { const pos = parseFEN(fen); if (!pos) return false; const testWhite = (color ? color : pos.stm) === 'w'; return isKingAttacked(pos, testWhite); } catch { return false; } },
    detectTerminal(fen) { try { const pos = parseFEN(fen); if (!pos) return JSON.stringify({ status: 'error' }); const legal = generateLegalMoves(pos); const term = evaluateTerminal(pos, { rep: null }, 0, legal); const out = { status: term.status }; if (term.status === 'checkmate') { out.winner = pos.stm === 'w' ? 'b' : 'w'; } return JSON.stringify(out); } catch (e) { return JSON.stringify({ status: 'error', error: String(e) }); } },
    debugTerminal(fen) { try { const pos = parseFEN(fen); if (!pos) return { status: 'error' }; const sideWhite = pos.stm === 'w'; const pseudo = genMoves(pos); let legalCount = 0; for (const m of pseudo) { const child = applyMove(pos, m); if (!isKingAttacked(child, sideWhite)) legalCount++; } const inCheck = isKingAttacked(pos, sideWhite); let status = 'ok'; if (onlyTwoKings(pos.board)) status = 'draw-insufficient'; else if (legalCount === 0) status = inCheck ? 'checkmate' : 'stalemate'; return { status, pseudoCount: pseudo.length, legalCount, inCheck }; } catch (e) { return { status: 'error', error: String(e) }; } },
    debugMovesForFen(fen) { try { const pos = parseFEN(fen); if (!pos) return []; const sideWhite = pos.stm === 'w'; const pseudo = genMoves(pos); const out = []; for (const m of pseudo) { const child = applyMove(pos, m); const legal = !isKingAttacked(child, sideWhite); out.push({ uci: m.uci, legal }); } return out; } catch (e) { return [{ error: String(e) }]; } },
    listLegalMoves2Ply(fen) { try { const pos = parseFEN(fen); if (!pos) return JSON.stringify({ moves: [], nodesTotal: 0, ply: 2 }); const sideWhite = pos.stm === 'w'; const parent = genMoves(pos); const legal = []; let nodes = 0; for (const m of parent) { const child = applyMove(pos, m); nodes++; if (!isKingAttacked(child, sideWhite)) legal.push(m.uci); } return JSON.stringify({ moves: legal, nodesTotal: nodes, ply: 2 }); } catch (e) { return JSON.stringify({ error: String(e) }); } },
    applyMoveIfLegal(fen, uci) { try {
      if (!fen || !uci || uci.length < 4) return null;
      const pos = parseFEN(fen); if (!pos) return null;
      // Only allow moves that are actually legal from this position
      const legal = generateLegalMoves(pos);
      const match = legal.find(m => m.uci === uci);
      if (!match) return null;
      const np = applyMove(pos, match);
      return `${encodeBoard(np.board)} ${np.stm} ${np.castling || '-'} ${np.ep || '-'} ${np.half || '0'} ${np.full || '1'}`;
    } catch (e) { return JSON.stringify({ error: String(e) }); } }
  };

  global.EngineBridge = EngineBridge;
  if (global.window && !global.window.EngineBridge) global.window.EngineBridge = EngineBridge;
  EngineBridge.wasmReady = true;
  try { const evt = new Event('engine-bridge-ready'); window.dispatchEvent(evt); } catch { try { const evt = document.createEvent('Event'); evt.initEvent('engine-bridge-ready', true, true); window.dispatchEvent(evt); } catch { /* ignore */ } }
})(typeof window !== 'undefined' ? window : globalThis);
