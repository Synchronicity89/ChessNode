'use strict';
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');

// Profiling flag (timestamp mode): off by default. Enable with env TIMESTAMP_MODE=1 or workerData.timestamp.
// Made mutable to allow runtime toggling via 'profile-toggle' worker messages.
let PROFILING_ENABLED = (function(){
  try { if (workerData && typeof workerData.timestamp !== 'undefined') return !!workerData.timestamp; } catch {}
  return process.env.TIMESTAMP_MODE === '1';
})();

// Current profile object for an active search request (scoped per message)
let CURRENT_PROFILE = null;
// Per-search move generation cache (fen4 -> verbose move list). Reinitialized per search.
let MOVE_CACHE = null;
const MAX_MOVE_CACHE_ENTRIES = parseInt(process.env.MAX_MOVE_CACHE_ENTRIES || '50000', 10);
// Per-search transition cache: fen4 -> array of {uci,san,fen4,isCap,isPromo,isCheck,captured,from,to,promotion}
let TRANS_CACHE = null;

let Chess;
try { Chess = require('chess.js').Chess; } catch (e) { /* will throw on use */ }
// Root selection flip: if FLIP=-1, choose worst root move by flipping scores during selection
const ROOT_FLIP = (function(){
  try {
    if (workerData && typeof workerData.flip !== 'undefined') {
      const v = Number(workerData.flip);
      return v === -1 ? -1 : 1;
    }
  } catch {}
  const v = parseInt(process.env.FLIP || '1', 10);
  return v === -1 ? -1 : 1;
})();

// -----------------------------
// Transposition Table (TT)
// Preference order selected by user places TT integration first before eval enhancements.
// We implement a lightweight Zobrist hashing scheme and a bounded-size Map to cache
// search results across iterative deepening iterations and distinct root searches.
// -----------------------------

// Piece list (12) for Zobrist: White pieces uppercase, black lowercase
const ZPIECES = ['P','N','B','R','Q','K','p','n','b','r','q','k'];
// Pre-generate random 64-bit numbers for piece-square combinations
const Z_TABLE = new Array(64 * ZPIECES.length);
function rand64() {
  // Combine two 32-bit randoms into a 64-bit BigInt (not cryptographically strong, fine for TT)
  const a = (Math.random() * 0xFFFFFFFF) >>> 0;
  const b = (Math.random() * 0xFFFFFFFF) >>> 0;
  return (BigInt(a) << 32n) ^ BigInt(b);
}
for (let i = 0; i < Z_TABLE.length; i++) Z_TABLE[i] = rand64();
// Side to move, castling rights, en-passant file random values
const Z_SIDE = rand64();
const Z_CASTLE = { K: rand64(), Q: rand64(), k: rand64(), q: rand64() };
const Z_EP_FILE = { a: rand64(), b: rand64(), c: rand64(), d: rand64(), e: rand64(), f: rand64(), g: rand64(), h: rand64() };

function squareIndex(fileChar, rankChar) {
  // a1 -> 0, h1 -> 7, a2 -> 8, ... h8 -> 63
  const file = fileChar.charCodeAt(0) - 97; // a=0
  const rank = parseInt(rankChar, 10) - 1;  // '1' -> 0
  return rank * 8 + file;
}

function zobristHashFen4(fen4) {
  // fen4: piece placement + stm + castling + ep square (no half/full move counters)
  // Example: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -
  const parts = fen4.split(/\s+/);
  const board = parts[0];
  const side = parts[1];
  const castle = parts[2];
  const ep = parts[3];
  let h = 0n;
  let rank = 8;
  let file = 0;
  for (const ch of board) {
    if (ch === '/') { rank--; file = 0; continue; }
    if (/[1-8]/.test(ch)) { file += parseInt(ch, 10); continue; }
    const sq = squareIndex(String.fromCharCode(97 + file), String(rank));
    const pieceIdx = ZPIECES.indexOf(ch);
    if (pieceIdx >= 0) h ^= Z_TABLE[pieceIdx * 64 + sq];
    file++;
  }
  if (side === 'w') h ^= Z_SIDE; // differentiate side to move
  if (castle && castle !== '-') {
    for (const c of castle) if (Z_CASTLE[c]) h ^= Z_CASTLE[c];
  }
  if (ep && ep !== '-') {
    // Only file matters for hashing standard practice
    const f = ep[0]; if (Z_EP_FILE[f]) h ^= Z_EP_FILE[f];
  }
  return h;
}

// TT entry flags
const TT_EXACT = 0; // exact score
const TT_LOWER = 1; // score is a lower bound (alpha raised)
const TT_UPPER = 2; // score is an upper bound (beta cut)

// Bounded transposition table. Use Map for insertion order; prune oldest when exceeding limit.
const TT = new Map();
const MAX_TT_ENTRIES = parseInt(process.env.MAX_TT_ENTRIES || '200000', 10);
let TT_GENERATION = 0; // increment per root iteration depth 1 search

function ttGet(hash, depth, alpha, beta) {
  const e = TT.get(hash);
  if (!e) return { hit: false, alpha, beta };
  if (e.depth < depth) return { hit: false, alpha, beta }; // insufficient depth
  if (CURRENT_PROFILE) CURRENT_PROFILE.ttGetCount++;
  // Adjust alpha/beta based on flag
  if (e.flag === TT_EXACT) {
    return { hit: true, exact: true, score: e.score, move: e.move };
  }
  if (e.flag === TT_LOWER) {
    if (e.score > alpha) alpha = e.score;
  } else if (e.flag === TT_UPPER) {
    if (e.score < beta) beta = e.score;
  }
  if (alpha >= beta) {
    return { hit: true, exact: false, score: e.score, move: e.move, cutoff: true };
  }
  return { hit: false, alpha, beta, move: e.move };
}

function ttStore(hash, depth, flag, score, move) {
  if (MAX_TT_ENTRIES <= 0) return;
  TT.set(hash, { depth, flag, score, move, gen: TT_GENERATION });
  if (CURRENT_PROFILE) CURRENT_PROFILE.ttStoreCount++;
  if (TT.size > MAX_TT_ENTRIES) {
    // Prune ~10% oldest generations
    const target = Math.floor(MAX_TT_ENTRIES * 0.9);
    for (const [k, v] of TT) {
      if (TT.size <= target) break;
      // Remove oldest by generation ordering (Map insertion order proxies this)
      TT.delete(k);
    }
  }
}

function ensureSix(f4) {
  const p = f4.trim().split(/\s+/);
  return p.length >= 6 ? f4 : `${p[0]} ${p[1]} ${p[2]} ${p[3]} 0 1`;
}

function movesCached(fen4, bucket /* 'eval' | 'order' | 'other' */) {
  if (!MOVE_CACHE) MOVE_CACHE = new Map();
  const key = fen4; // fen4 already canonical (piece/side/castle/ep)
  const hit = MOVE_CACHE.get(key);
  if (hit) return hit;
  const _t = PROFILING_ENABLED && CURRENT_PROFILE ? process.hrtime.bigint() : null;
  const mv = new Chess(ensureSix(fen4)).moves({ verbose: true });
  if (_t) {
    const dt = process.hrtime.bigint() - _t;
    CURRENT_PROFILE.moveGenTimeNs = (CURRENT_PROFILE.moveGenTimeNs || 0n) + dt;
    CURRENT_PROFILE.moveGenCalls = (CURRENT_PROFILE.moveGenCalls || 0) + 1;
    CURRENT_PROFILE.movesGenerated = (CURRENT_PROFILE.movesGenerated || 0) + mv.length;
    if (bucket === 'eval') {
      CURRENT_PROFILE.evalMoveGenTimeNs = (CURRENT_PROFILE.evalMoveGenTimeNs || 0n) + dt;
      CURRENT_PROFILE.evalMoveGenCalls = (CURRENT_PROFILE.evalMoveGenCalls || 0) + 1;
      CURRENT_PROFILE.evalMovesGenerated = (CURRENT_PROFILE.evalMovesGenerated || 0) + mv.length;
    } else if (bucket === 'order') {
      CURRENT_PROFILE.orderMoveGenTimeNs = (CURRENT_PROFILE.orderMoveGenTimeNs || 0n) + dt;
      CURRENT_PROFILE.orderMoveGenCalls = (CURRENT_PROFILE.orderMoveGenCalls || 0) + 1;
      CURRENT_PROFILE.orderMovesGenerated = (CURRENT_PROFILE.orderMovesGenerated || 0) + mv.length;
    }
  }
  MOVE_CACHE.set(key, mv);
  if (MOVE_CACHE.size > MAX_MOVE_CACHE_ENTRIES) {
    // prune ~10%
    const target = Math.floor(MAX_MOVE_CACHE_ENTRIES * 0.9);
    for (const k of MOVE_CACHE.keys()) {
      if (MOVE_CACHE.size <= target) break;
      MOVE_CACHE.delete(k);
    }
  }
  return mv;
}

// -----------------------------
// Shared hint move table (lightweight SAB-based TT for ordering)
// Two Int32 per slot: [key32, enc32], where enc packs move(16) | depth(8) | reserved(8)
let SHARED_I32 = null;
let SHARED_SLOTS = 0;
function initShared() {
  if (workerData && workerData.sharedSAB) {
    try {
      SHARED_I32 = new Int32Array(workerData.sharedSAB);
      SHARED_SLOTS = (SHARED_I32.length / 2) | 0;
    } catch { SHARED_I32 = null; SHARED_SLOTS = 0; }
  }
}
initShared();

function hash32FromBig(h) {
  return Number(h & 0xFFFFFFFFn) | 0;
}
function uciToPack(uci) {
  // e2e4[optional promo]
  if (!uci || uci.length < 4) return 0;
  const f = uci.charCodeAt(0) - 97, r = (uci.charCodeAt(1) - 49);
  const tF = uci.charCodeAt(2) - 97, tR = (uci.charCodeAt(3) - 49);
  const from = (r * 8 + f) & 0x3F, to = (tR * 8 + tF) & 0x3F;
  let promo = 0;
  if (uci.length >= 5) {
    const p = uci[4];
    promo = p === 'q' ? 1 : p === 'r' ? 2 : p === 'b' ? 3 : p === 'n' ? 4 : 0;
  }
  return (from) | (to << 6) | (promo << 12);
}
function packToUci(pack) {
  const from = pack & 0x3F, to = (pack >> 6) & 0x3F, promo = (pack >> 12) & 0x7;
  function sq(i){ return String.fromCharCode(97 + (i % 8)) + String.fromCharCode(49 + ((i/8)|0)); }
  const base = sq(from) + sq(to);
  const pm = promo === 1 ? 'q' : promo === 2 ? 'r' : promo === 3 ? 'b' : promo === 4 ? 'n' : '';
  return base + pm;
}
function sharedHintGet(zHash) {
  if (!SHARED_I32 || SHARED_SLOTS === 0) return 0;
  const key = hash32FromBig(zHash);
  const idx = (key >>> 0) & (SHARED_SLOTS - 1);
  const k = Atomics.load(SHARED_I32, idx * 2);
  if (k !== key) return 0;
  const enc = Atomics.load(SHARED_I32, idx * 2 + 1);
  const move = enc & 0xFFFF;
  return move;
}
function sharedHintSet(zHash, movePack, depth) {
  if (!SHARED_I32 || SHARED_SLOTS === 0 || !movePack) return;
  const key = hash32FromBig(zHash);
  const idx = (key >>> 0) & (SHARED_SLOTS - 1);
  Atomics.store(SHARED_I32, idx * 2, key);
  const enc = (movePack & 0xFFFF) | ((Math.max(0, Math.min(255, depth|0)) & 0xFF) << 16);
  Atomics.store(SHARED_I32, idx * 2 + 1, enc);
}

// Enhanced evaluation: material baseline + mobility + center control + simple king safety
function evaluateMaterial(fen4) {
  const _pStart = PROFILING_ENABLED && CURRENT_PROFILE ? process.hrtime.bigint() : null;
  if (CURRENT_PROFILE) CURRENT_PROFILE.evalCalls = (CURRENT_PROFILE.evalCalls || 0) + 1;
  // Simple per-search evaluation memo (cleared between root iterations elsewhere if desired)
  if (!evaluateMaterial.cache) evaluateMaterial.cache = new Map();
  const cached = evaluateMaterial.cache.get(fen4);
  if (cached !== undefined) return cached;
  const F = ensureSix(fen4);
  const chessW = new Chess(F);
  const board = chessW.board();
  let white = 0, black = 0;
  const pieceVals = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  function pawnValue(sq, color) {
    const rank = parseInt(sq.square[1], 10);
    let adv = 0;
    if (color === 'w') adv = Math.max(0, Math.min(5, rank - 2));
    else adv = Math.max(0, Math.min(5, 7 - rank));
    return 1 + (2 * adv) / 5; // 1..3
  }
  // Material with pawn advancement
  for (const row of board) for (const sq of row) if (sq) {
    const t = sq.type, c = sq.color;
    const v = t === 'p' ? pawnValue(sq, c) : (pieceVals[t] || 0);
    if (c === 'w') white += v; else black += v;
  }
  let score = white - black; // white perspective baseline

  // Helper: flip side-to-move in fen4
  function flipSide(f4) {
    const p = f4.split(/\s+/);
    // Use '-' for en-passant to avoid invalid ep square when flipping side
    return `${p[0]} ${p[1] === 'w' ? 'b' : 'w'} ${p[2]} -`;
  }
  // Mobility & move lists (generate once per side and reuse across heuristics)
  const chessB = new Chess(ensureSix(flipSide(fen4)));
  let whiteMoves = movesCached(fen4, 'eval');
  let blackMoves = movesCached(flipSide(fen4), 'eval');
  const mobility = (whiteMoves.length - blackMoves.length) * 0.06; // light weight
  score += mobility;

  // Center control and occupancy
  const centers = new Set(['d4','e4','d5','e5']);
  function countCenterTargets(mvList) { let c=0; for (const m of mvList) if (centers.has(m.to)) c++; return c; }
  function countOccupancy(targetColor) {
    let cnt = 0;
    for (const row of board) for (const sq of row) if (sq && sq.color === targetColor && centers.has(sq.square)) cnt++;
    return cnt;
  }
  const centerAttackDiff = (countCenterTargets(whiteMoves) - countCenterTargets(blackMoves)) * 0.1;
  const centerOccDiff = (countOccupancy('w') - countOccupancy('b')) * 0.15;
  score += centerAttackDiff + centerOccDiff;

  // King safety: lost castling rights when king still central, and pawn shield (f/g pawns)
  const parts = fen4.split(/\s+/);
  const rights = parts[2] || '-';
  // Locate kings
  let wKing = null, bKing = null;
  for (const row of board) for (const sq of row) if (sq) {
    if (sq.type === 'k' && sq.color === 'w') wKing = sq.square;
    if (sq.type === 'k' && sq.color === 'b') bKing = sq.square;
  }
  // Castling rights penalty if king on e1/e8 and no castling available
  if (wKing === 'e1' && !(rights.includes('K') || rights.includes('Q'))) score -= 0.3;
  if (bKing === 'e8' && !(rights.includes('k') || rights.includes('q'))) score += 0.3;
  // Pawn shield around king: penalize missing f- and g-pawns on home rank
  function hasPiece(square, type, color) {
    for (const row of board) for (const sq of row) if (sq && sq.square === square && sq.type === type && sq.color === color) return true;
    return false;
  }
  if (!hasPiece('f2','p','w')) score -= 0.5;
  if (!hasPiece('g2','p','w')) score -= 0.3;
  if (!hasPiece('f7','p','b')) score += 0.5;
  if (!hasPiece('g7','p','b')) score += 0.3;

  // Additional king safety: attack ring pressure and open file exposure
  function kingRingSquares(ksq) {
    if (!ksq) return [];
    const file = ksq[0];
    const rank = parseInt(ksq[1], 10);
    const files = [String.fromCharCode(file.charCodeAt(0)-1), file, String.fromCharCode(file.charCodeAt(0)+1)];
    const ranks = [rank-1, rank, rank+1];
    const out = [];
    for (const f of files) for (const r of ranks) {
      if (f < 'a' || f > 'h' || r < 1 || r > 8) continue;
      const sq = f + r;
      if (sq !== ksq) out.push(sq);
    }
    return out;
  }
  const wRing = kingRingSquares(wKing);
  const bRing = kingRingSquares(bKing);
  // Count enemy attacks on king ring squares (approx by generating enemy moves)
  function countAttacksOn(squares, enemyMoves) {
    let c = 0;
    const set = new Set(squares);
    for (const m of enemyMoves) if (set.has(m.to)) c++;
    return c;
  }
  const wPressure = countAttacksOn(wRing, blackMoves);
  const bPressure = countAttacksOn(bRing, whiteMoves);
  // Pressure scaling: each attack ~0.08 pawns
  score += (bPressure - wPressure) * 0.08;
  // Open file exposure: penalize if king file has no friendly pawns at any rank
  function fileHasPawn(color, fileChar) {
    for (const row of board) for (const sq of row) if (sq && sq.color === color && sq.type === 'p' && sq.square[0] === fileChar) return true;
    return false;
  }
  if (wKing && !fileHasPawn('w', wKing[0])) score -= 0.35;
  if (bKing && !fileHasPawn('b', bKing[0])) score += 0.35;
  // Bonus if enemy king file open (attack prospects)
  if (bKing && !fileHasPawn('b', bKing[0])) score += 0.15;
  if (wKing && !fileHasPawn('w', wKing[0])) score -= 0.15;

  // Castling rights progressive penalty system (approximation without full move history)
  // Rules (requested):

  // -----------------------------
  // Positional heuristics (lightweight)
  // -----------------------------
  // Helpers
  function fileIdx(ch) { return ch.charCodeAt(0) - 97; }
  function rankIdx(ch) { return parseInt(ch, 10) - 1; }
  function get(square) {
    for (const row of board) for (const sq of row) if (sq && sq.square === square) return sq;
    return null;
  }
  function isEmpty(square) { return !get(square); }
  function betweenEmptyRank(rank, fromFile, toFile, color) {
    // check emptiness between two files on a given rank (inclusive bounds skipped)
    const start = Math.min(fromFile, toFile) + 1;
    const end = Math.max(fromFile, toFile) - 1;
    for (let f = start; f <= end; f++) {
      const sq = String.fromCharCode(97 + f) + (rank + 1);
      if (!isEmpty(sq)) return false;
    }
    return true;
  }

  // Knight centralization and rim penalties
  const center4 = new Set(['d4','e4','d5','e5']);
  const nearCenter = new Set(['c3','f3','c6','f6','c4','f4','c5','f5','d3','e3','d6','e6']);
  function knightPositional() {
    let s = 0;
    for (const row of board) for (const sq of row) if (sq && sq.type==='n') {
      const me = (sq.color==='w');
      const sign = me ? 1 : -1;
      const square = sq.square;
      const f = square[0], r = square[1];
      if (center4.has(square)) s += 0.2 * sign;
      else if (nearCenter.has(square)) s += 0.1 * sign;
      // Rim files a/h
      if (f === 'a' || f === 'h') s += -0.15 * sign;
      // Back/front ranks
      if ((me && r==='1') || (!me && r==='8')) s += -0.1 * sign;
    }
    return s;
  }
  score += knightPositional();

  // Minor piece development (very light): penalize undeveloped back-rank minors
  function minorDevelopment() {
    let s = 0;
    const starts = [
      { sq: 'b1', t: 'n', c: 'w' }, { sq: 'g1', t: 'n', c: 'w' }, { sq: 'c1', t: 'b', c: 'w' }, { sq: 'f1', t: 'b', c: 'w' },
      { sq: 'b8', t: 'n', c: 'b' }, { sq: 'g8', t: 'n', c: 'b' }, { sq: 'c8', t: 'b', c: 'b' }, { sq: 'f8', t: 'b', c: 'b' },
    ];
    for (const st of starts) {
      const piece = get(st.sq);
      if (piece && piece.type === st.t && piece.color === st.c) {
        // Slightly stronger penalty for undeveloped minors on their start squares (+50%)
        s += (st.c==='w' ? -0.075 : 0.075);
      }
    }
    return s;
  }
  score += minorDevelopment();

  // Rook connection on back rank: no pieces between rooks
  function rookConnection() {
    function side(color) {
      const rank = color==='w' ? 0 : 7;
      const rooks = [];
      for (let f=0; f<8; f++) {
        const sq = String.fromCharCode(97+f) + (rank+1);
        const p = get(sq);
        if (p && p.type==='r' && p.color===color) rooks.push(f);
      }
      if (rooks.length < 2) return 0;
      rooks.sort((a,b)=>a-b);
      const connected = betweenEmptyRank(rank, rooks[0], rooks[rooks.length-1]);
      return connected ? 0.2 : 0;
    }
    return side('w') - side('b');
  }
  score += rookConnection();

  // Rook centralization and alignment with enemy K/Q (lightweight, not checking X-ray attackers)
  function rookPositional() {
      let s = 0;
      function side(color) {
        const add = (sq) => { s += (color==='w' ? 1 : -1) * sq; };
        const enemyKing = color==='w' ? bKing : wKing;
        const enemyQueen = (function(){ for(const row of board) for(const x of row) if(x && x.type==='q' && x.color!==(color)) return x.square; return null; })();
        for (const row of board) for (const sq of row) if (sq && sq.type==='r' && sq.color===color) {
          const f = sq.square[0];
          const r = parseInt(sq.square[1],10);
          if (f==='d' || f==='e') add(0.1);
          if (r>=3 && r<=6) add(0.05);
          // Alignment with enemy K/Q on same file or rank with few blockers (<=2)
          function blockersBetween(a, b) {
            if (!a || !b) return 99;
            const af = fileIdx(a[0]), ar = rankIdx(a[1]);
            const bf = fileIdx(b[0]), br = rankIdx(b[1]);
            let count = 0;
            if (af === bf) {
              const step = ar < br ? 1 : -1;
              for (let rr = ar + step; rr !== br; rr += step) {
                const sq2 = String.fromCharCode(97+af) + (rr+1);
                if (!isEmpty(sq2)) count++;
              }
            } else if (ar === br) {
              const step = af < bf ? 1 : -1;
              for (let ff = af + step; ff !== bf; ff += step) {
                const sq2 = String.fromCharCode(97+ff) + (ar+1);
                if (!isEmpty(sq2)) count++;
              }
            } else {
              return 99;
            }
            return count;
          }
          const rookSq = sq.square;
          if (blockersBetween(rookSq, enemyKing) <= 2) add(0.05);
          if (blockersBetween(rookSq, enemyQueen) <= 2) add(0.05);
        }
      }
      side('w'); side('b');
      return s;
  }
  score += rookPositional();

  // Simple knight outposts: knight supported by pawn and not attackable by enemy pawns on adjacent files
  function knightOutposts() {
    let s = 0;
    function side(color) {
      const forward = color==='w' ? 1 : -1;
      const enemy = color==='w' ? 'b' : 'w';
      for (const row of board) for (const sq of row) if (sq && sq.type==='n' && sq.color===color) {
        const f = fileIdx(sq.square[0]);
        const r = rankIdx(sq.square[1]);
        // require support by own pawn one rank behind on same file
        const supportSq = String.fromCharCode(97+f) + (r + 1 - forward);
        const support = get(supportSq);
        if (!support || support.type!=='p' || support.color!==color) continue;
        // check enemy pawns on adjacent files in front that could attack
        let threatened = false;
        for (const df of [-1, 1]) {
          const ef = f + df;
          if (ef < 0 || ef > 7) continue;
          for (let rr = r + 1; rr >=0 && rr <=7; rr += forward) {
            const ahead = String.fromCharCode(97+ef) + (rr+1);
            const p = get(ahead);
            if (p && p.type==='p' && p.color===enemy) { threatened = true; break; }
          }
          if (threatened) break;
        }
        if (!threatened) s += (color==='w' ? 0.2 : -0.2);
      }
    }
    side('w'); side('b');
    return s;
  }
  score += knightOutposts();

  // Bishop controlling enemy knight squares (lightweight): count if own pseudo-moves touch enemy knight squares
  function bishopControlsKnightSquares() {
    let s = 0;
    const enemyKnightSquaresW = [];
    const enemyKnightSquaresB = [];
    for (const row of board) for (const sq of row) if (sq && sq.type==='n') {
      if (sq.color==='w') enemyKnightSquaresB.push(sq.square);
      else enemyKnightSquaresW.push(sq.square);
    }
    // Use whiteMoves/blackMoves generated earlier
    const whiteTargets = new Set(whiteMoves.filter(m => m.piece==='b').map(m => m.to));
    const blackTargets = new Set(blackMoves.filter(m => m.piece==='b').map(m => m.to));
    for (const t of enemyKnightSquaresB) if (whiteTargets.has(t)) s += 0.05;
    for (const t of enemyKnightSquaresW) if (blackTargets.has(t)) s -= 0.05;
    return s;
  }
  score += bishopControlsKnightSquares();
  // - First rook movement removing a castling side: 1 pawn
  // - Second rook movement (other side lost) OR king movement (after one rook moved): 2 pawns
  // - King movement before any rooks moved (losing both sides at once): 3 pawns
  // - Total maximum penalty for losing all rights: 3 pawns
  // - If opponent has lost their queen, penalty is quartered (x0.25)
  // We approximate using FEN rights (presence of K/Q for white, k/q for black) and piece start squares.
  function sidePenalty(color) {
    const kingStart = color === 'w' ? 'e1' : 'e8';
    const rookStarts = color === 'w' ? ['a1','h1'] : ['a8','h8'];
    const hasKingside = rights.includes(color === 'w' ? 'K' : 'k');
    const hasQueenside = rights.includes(color === 'w' ? 'Q' : 'q');
    const lostSides = (hasKingside ? 0 : 1) + (hasQueenside ? 0 : 1);
    if (lostSides === 0) return 0;
    // Determine if king moved (not on start square)
    const kingMoved = (color === 'w' ? wKing !== kingStart : bKing !== kingStart);
    if (lostSides === 2) {
      // Full rights lost
      if (kingMoved) return 3; // king moved before/after rooks results in full penalty
      // Both rooks moved away (king still at start) => still full penalty
      return 3;
    }
    // lostSides === 1
    // One side lost: treat as first rook moved => 1 pawn
    return 1;
  }
  // Opponent queen presence check
  function hasQueen(color) {
    for (const row of board) for (const sq of row) if (sq && sq.type==='q' && sq.color===color) return true;
    return false;
  }
  const oppQueenMissingForWhite = !hasQueen('b');
  const oppQueenMissingForBlack = !hasQueen('w');
  const whitePenaltyRaw = sidePenalty('w');
  const blackPenaltyRaw = sidePenalty('b');
  const whitePenalty = whitePenaltyRaw * (oppQueenMissingForWhite ? 0.25 : 1);
  const blackPenalty = blackPenaltyRaw * (oppQueenMissingForBlack ? 0.25 : 1);
  // Apply to score (white perspective): subtract white penalty, add black penalty
  score -= whitePenalty;
  score += blackPenalty;

  // King wander penalty: penalize uncastled king leaving start square regardless of rights status.
  function kingWanderPenalty(color) {
    const kingStart = color === 'w' ? 'e1' : 'e8';
    const ksq = color === 'w' ? wKing : bKing;
    if (!ksq) return 0;
    const castled = (color === 'w') ? (ksq === 'g1' || ksq === 'c1') : (ksq === 'g8' || ksq === 'c8');
    if (castled) return 0;
    if (ksq !== kingStart) {
      const oppQueenPresent = hasQueen(color === 'w' ? 'b' : 'w');
      const base = 2.2; // baseline penalty in pawns
      return oppQueenPresent ? base : base * 0.6;
    }
    return 0;
  }
  const wWander = kingWanderPenalty('w');
  const bWander = kingWanderPenalty('b');
  score -= wWander; // white king wandering hurts white
  score += bWander; // black king wandering helps white

  // Castling readiness (forward-looking incentive): reward retaining rights AND clear path pieces
  // to encourage timely castling before threats escalate. Scaled smaller than actual castling bonus.
  function isCastled(color) {
    const ksq = color === 'w' ? wKing : bKing;
    if (!ksq) return false;
    if (color === 'w') return ksq === 'g1' || ksq === 'c1';
    return ksq === 'g8' || ksq === 'c8';
  }
  function squaresEmpty(list) {
    for (const sq of list) if (get(sq)) return false; return true;
  }
  function castlingReadiness(color) {
    if (isCastled(color)) return 0; // already castled handled elsewhere
    const hasKingSide = rights.includes(color === 'w' ? 'K' : 'k');
    const hasQueenSide = rights.includes(color === 'w' ? 'Q' : 'q');
    if (!hasKingSide && !hasQueenSide) return 0;
    const kingStart = color === 'w' ? 'e1' : 'e8';
    const ksq = color === 'w' ? wKing : bKing;
    if (ksq !== kingStart) return 0; // king moved, readiness moot
    let bonus = 0;
    // Kingside path squares must be empty (f1,g1) / (f8,g8)
    if (hasKingSide) {
      const path = color === 'w' ? ['f1','g1'] : ['f8','g8'];
      if (squaresEmpty(path)) bonus += 0.6; // readiness bonus
    }
    // Queenside path squares must be empty (b1,c1,d1)/(b8,c8,d8)
    if (hasQueenSide) {
      const path = color === 'w' ? ['b1','c1','d1'] : ['b8','c8','d8'];
      if (squaresEmpty(path)) bonus += 0.5;
    }
    return bonus;
  }
  const readinessWhite = castlingReadiness('w') * (oppQueenMissingForWhite ? 0.4 : 1) * 1.2;
  const readinessBlack = castlingReadiness('b') * (oppQueenMissingForBlack ? 0.4 : 1) * 1.2;
  score += readinessWhite; // white perspective
  score -= readinessBlack; // subtract black's readiness (good for black)

  // Castling incentive bonuses (requested):
  // +4.0 for castling king side, +3.4 for queen side; reduced x0.25 if opponent queen is gone.
  function hasPieceAt(square, type, color) {
    for (const row of board) for (const sq of row) if (sq && sq.square === square && sq.type === type && sq.color === color) return true;
    return false;
  }
  function castledSide(color) {
    const ksq = color === 'w' ? wKing : bKing;
    if (!ksq) return null;
    // Detect by king destination and rook relocated square
    if (color === 'w') {
      if (ksq === 'g1' && hasPieceAt('f1','r','w')) return 'K';
      if (ksq === 'c1' && hasPieceAt('d1','r','w')) return 'Q';
    } else {
      if (ksq === 'g8' && hasPieceAt('f8','r','b')) return 'k';
      if (ksq === 'c8' && hasPieceAt('d8','r','b')) return 'q';
    }
    return null;
  }
  const whiteCastled = castledSide('w');
  const blackCastled = castledSide('b');
  if (whiteCastled) {
    const mult = oppQueenMissingForWhite ? 0.25 : 1.0;
    score += (whiteCastled === 'K' ? 4.0 : 3.4) * mult;
  }
  if (blackCastled) {
    const mult = oppQueenMissingForBlack ? 0.25 : 1.0;
    score -= (blackCastled === 'k' ? 4.0 : 3.4) * mult;
  }

  // Queen immediate capture (hanging) heuristic: if a queen can be captured right away, penalize heavily.
  function findSquare(type, color) {
    for (const row of board) for (const sq of row) if (sq && sq.type === type && sq.color === color) return sq.square;
    return null;
  }
  const wQueenSq = findSquare('q','w');
  const bQueenSq = findSquare('q','b');
  // We already generated blackMoves and whiteMoves above (as attacks for king ring), reuse them.
  if (wQueenSq) {
    const canBeCaptured = blackMoves.some(m => m.to === wQueenSq && m.flags && m.flags.includes('c'));
    if (canBeCaptured) score -= 6.0; // strong deterrent; full exchange resolution handled by search
  }
  if (bQueenSq) {
    const canBeCaptured = whiteMoves.some(m => m.to === bQueenSq && m.flags && m.flags.includes('c'));
    if (canBeCaptured) score += 6.0;
  }

  // Early flank pawn pushes (a/h files) before castling: discourage slow wing loosening
  function pieceAt(square) { const p = get(square); return p ? { t:p.type, c:p.color } : null; }
  const whiteUncastled = !isCastled('w');
  if (whiteUncastled) {
    const flankSquares = ['a3','a4','h3','h4'];
    let flankPushes = 0;
    for (const sq of flankSquares) {
      const p = pieceAt(sq);
      if (p && p.c==='w' && p.t==='p') flankPushes++;
    }
    if (flankPushes) score -= Math.min(1.0, flankPushes * 0.45);
  }

  // Checks: tiny bonus if opponent is in check
  if (chessW.isCheck()) score -= 0.2; // white to move in fen4 being in check is bad for white
  if (chessB.isCheck()) score += 0.2; // black to move (after flip) in check is good for white

  // Round to two decimals to stabilize scores
  const finalScore = Math.round(score * 100) / 100;
  // Cap cache size to avoid excessive memory
  if (evaluateMaterial.cache.size > 5000) {
    evaluateMaterial.cache.clear();
  }
  evaluateMaterial.cache.set(fen4, finalScore);
  if (_pStart) CURRENT_PROFILE.evalTimeNs += process.hrtime.bigint() - _pStart;
  return finalScore;
}

// removed older orderChildren(fen4) in favor of TT-aware version below

// Alpha-beta with PV extraction
function timeUp(deadline, nodes) {
  if (!deadline) return false;
  if (nodes.count % 64 !== 0) return false; // check more frequently to respect budgets
  return Date.now() > deadline;
}

function alphabetaPV(fen4, depth, alpha, beta, captureParity = 0, nodesObj, deadline, ctx, ply, hintMove, horizonExtended=false) {
  const _pStart = PROFILING_ENABLED && CURRENT_PROFILE ? process.hrtime.bigint() : null;
  nodesObj.count++;
  if (timeUp(deadline, nodesObj)) return { score: 0, pv: [], aborted: true };
  // Hard ply safeguard to prevent runaway recursion if extension logic malfunctions
  const MAX_PLY = parseInt(process.env.MAX_PLY || '256', 10);
  if ((ply|0) > MAX_PLY) {
    const stm = fen4.split(/\s+/)[1];
    const wEval = evaluateMaterial(fen4);
    return { score: (stm === 'w') ? wEval : -wEval, pv: [], aborted: false };
  }
  const chess = new Chess(ensureSix(fen4));
  const hash = zobristHashFen4(fen4);
  const alphaOrig = alpha;
  // TT probe (skip at root capture extensions only when depth>0)
  const ttProbe = ttGet(hash, depth, alpha, beta);
  if (ttProbe.hit) {
    if (ctx && ctx.stats) ctx.stats.ttHits = (ctx.stats.ttHits || 0) + 1;
    if (ttProbe.exact) return { score: ttProbe.score, pv: [], aborted: false, tt: true };
    if (ttProbe.cutoff) return { score: ttProbe.score, pv: [], aborted: false, tt: true };
    // update alpha/beta from probe result for continued search
    alpha = ttProbe.alpha !== undefined ? ttProbe.alpha : alpha;
    beta = ttProbe.beta !== undefined ? ttProbe.beta : beta;
  }
  if (depth <= 0) {
    // Single-use horizon extension if in check; prevent infinite recursion by horizonExtended flag
    if (chess.isCheck() && !horizonExtended) {
      return alphabetaPV(fen4, 1, alpha, beta, captureParity, nodesObj, deadline, ctx, ply, hintMove, true);
    }
    const q = quiesce(fen4, alpha, beta, nodesObj, deadline);
    return q;
  }
  // Selective tactical extensions
  // 1. If previous move was a capture and position offers a direct recapture (SEE >= 0), extend +1
  // 2. If side to move has a checking move among top ordered children at shallow depth, extend +1 for that move only.
  // 3. Passed pawn push near promotion (rank 6/7 for side to move) extend +1.
  let tacticalExtension = 0;
  // Recapture/capture-sequence extension (approximate via captureParity >0)
  if (captureParity > 0 && depth > 0 && !chess.isCheck()) {
    tacticalExtension = Math.max(tacticalExtension, 1);
  }
  if (depth > 0) {
    // Simple passed pawn detection: look for a friendly pawn on 6th/7th rank with no opposing pawn ahead on same file
    const board = chess.board();
    const stm = chess.turn();
    const forward = stm === 'w' ? 1 : -1;
    for (const row of board) for (const sq of row) if (sq && sq.type === 'p' && sq.color === stm) {
      const rank = parseInt(sq.square[1],10);
      if ((stm==='w' && rank>=6) || (stm==='b' && rank<=3)) {
        const file = sq.square[0];
        // scan ahead for enemy pawn
        let blocked = false;
        let r2 = rank + forward;
        while (r2 >=1 && r2 <=8) {
          const ahead = file + r2;
          if (chess.get(ahead) && chess.get(ahead).type==='p' && chess.get(ahead).color!==stm) { blocked=true; break; }
          r2 += forward;
        }
        if (!blocked) { tacticalExtension = Math.max(tacticalExtension,1); }
      }
    }
  }
  // IMPORTANT: do not mutate the original depth in-place for extensions; doing so can
  // create non-decreasing depth propagation (infinite recursion) when every node extends.
  // Instead compute an effective depth used for the remainder of this node only.
  const effectiveDepth = depth + tacticalExtension;
  // Mate scoring: prefer faster mates and avoid horizon oddities.
  // Use a large magnitude and incorporate ply to favor shorter mates.
  if (chess.isCheckmate()) {
    const MATE_BASE = 100000;
    // Negative score because side to move is checkmated.
    // Incorporate ply to prefer faster mates from the root's perspective.
    const dist = Math.max(0, ply | 0);
    return { score: -(MATE_BASE - dist), pv: [], aborted: false, mate: true };
  }
  if (chess.isDraw()) return { score: 0, pv: [], aborted: false };
  // Null-move pruning: if not in check and enough depth, try a null move
  if (effectiveDepth >= 3 && !chess.isCheck()) {
    if (ctx && ctx.stats) ctx.stats.nullTry = (ctx.stats.nullTry || 0) + 1;
    // Quick non-pawn material presence check for the side to move
    let hasNonPawn = false;
    for (const row of chess.board()) for (const sq of row) if (sq && sq.color === chess.turn() && sq.type !== 'p') { hasNonPawn = true; break; }
    if (hasNonPawn) {
      const parts = fen4.split(/\s+/);
      const nullFen = `${parts[0]} ${parts[1] === 'w' ? 'b' : 'w'} ${parts[2]} -`;
  const R = effectiveDepth > 5 ? 3 : 2;
  const r = alphabetaPV(nullFen, effectiveDepth - 1 - R, -beta, -beta + 1, 0, nodesObj, deadline, ctx, (ply|0)+1, null, false);
      if (!r.aborted) {
        const score = -r.score;
        if (score >= beta) {
          if (ctx && ctx.stats) ctx.stats.nullCut = (ctx.stats.nullCut || 0) + 1;
          ttStore(hash, depth, TT_LOWER, score, null);
          if (CURRENT_PROFILE) CURRENT_PROFILE.nullMoveCount++;
          return { score: beta, pv: [], aborted: false };
        }
      }
    }
  }
  let prefer = ttProbe.move || hintMove || null;
  if (!prefer) {
    const sh = sharedHintGet(hash);
    if (sh) prefer = packToUci(sh);
  }
  const children = orderChildren(fen4, prefer, ctx, ply, effectiveDepth, deadline); // pass preferred move (if any)
  if (children.length === 0) {
    // No legal moves list (should be handled earlier as mate/draw), but return static eval in STM perspective.
    const parts = fen4.split(/\s+/);
    const stm = parts[1];
    const w = evaluateMaterial(fen4);
    const res = { score: (stm === 'w') ? w : -w, pv: [], aborted: false };
    if (_pStart) CURRENT_PROFILE.alphabetaTimeNs += process.hrtime.bigint() - _pStart;
    return res;
  }
  // modest branching control deeper
  const maxB = effectiveDepth > 7 ? 8 : effectiveDepth > 5 ? 12 : effectiveDepth > 3 ? 16 : 32;
  let bestScore = -Infinity;
  let bestPV = [];
  let bestMove = null;
  // Allow up to a couple extra checking moves beyond cap, but not unlimited
  let consumed = 0, extraChecks = 1, usedExtra = 0;
  for (let i = 0; i < children.length && (consumed < maxB || (children[i].isCheck && usedExtra < extraChecks)); i++) {
    const ch = children[i];
    if (consumed >= maxB && ch.isCheck) usedExtra++; else consumed++;
    // Late Move Reductions for quiet moves late in list
    let r;
  const isQuiet = !ch.isCap && !ch.isPromo && !ch.isCheck; // never reduce checking moves
  const late = i >= 3 && effectiveDepth >= 3 && isQuiet;
    if (late) {
      if (ctx && ctx.stats) ctx.stats.lmrReductions = (ctx.stats.lmrReductions || 0) + 1;
      const red = 1;
  r = alphabetaPV(ch.fen4, effectiveDepth - 1 - red, -alpha - 1, -alpha, ch.isCap ? captureParity + 1 : 0, nodesObj, deadline, ctx, (ply|0)+1, null, false);
      if (!r.aborted) {
        const sc = -r.score;
        if (sc > alpha) {
          // re-search at full depth (effectiveDepth - 1)
          r = alphabetaPV(ch.fen4, effectiveDepth - 1, -beta, -alpha, ch.isCap ? captureParity + 1 : 0, nodesObj, deadline, ctx, (ply|0)+1, null, false);
        }
      }
    } else {
  r = alphabetaPV(ch.fen4, effectiveDepth - 1, -beta, -alpha, ch.isCap ? captureParity + 1 : 0, nodesObj, deadline, ctx, (ply|0)+1, null, false);
    }
  if (r.aborted) return { score: 0, pv: [], aborted: true };
    const score = -r.score;
    const pv = [ch.san, ...r.pv];
    if (score >= beta) {
      // store lower-bound (fail-high)
  ttStore(hash, effectiveDepth, TT_LOWER, score, ch.uci);
      sharedHintSet(hash, uciToPack(ch.uci), depth);
      // Killer and history updates for non-captures
      if (!ch.isCap) {
        const k = ctx.killers[ply] || (ctx.killers[ply] = []);
        if (k[0] !== ch.uci) { k[1] = k[0]; k[0] = ch.uci; }
        const old = ctx.history.get(ch.uci) || 0;
        ctx.history.set(ch.uci, old + depth * depth);
      }
      ctx.stats.fh++;
      const ret = { score, pv, aborted: false };
      if (_pStart) CURRENT_PROFILE.alphabetaTimeNs += process.hrtime.bigint() - _pStart;
      return ret;
    }
    if (score > alpha) alpha = score;
    if (score > bestScore) { bestScore = score; bestPV = pv; bestMove = ch.uci; }
  }
  // Determine flag
  let flag = TT_EXACT;
  if (bestScore <= alphaOrig) flag = TT_UPPER; // failed low (didn't raise alpha)
  else if (bestScore >= beta) flag = TT_LOWER; // fail-high (already handled earlier, but just in case)
  ttStore(hash, effectiveDepth, flag, bestScore, bestMove);
  if (bestMove) sharedHintSet(hash, uciToPack(bestMove), effectiveDepth);
  if (bestScore <= alphaOrig) ctx.stats.fl++;
  // Return the real bestScore, not the current alpha (alpha may have overshot on fail-high pruning logic)
  const finalRes = { score: bestScore, pv: bestPV, aborted: false };
  if (_pStart) CURRENT_PROFILE.alphabetaTimeNs += process.hrtime.bigint() - _pStart;
  return finalRes;
}

// Quiescence search over captures with SEE filter
function quiesce(fen4, alpha, beta, nodesObj, deadline) {
  const _pStart = PROFILING_ENABLED && CURRENT_PROFILE ? process.hrtime.bigint() : null;
  nodesObj.count++;
  if (timeUp(deadline, nodesObj)) return { score: alpha, pv: [], aborted: true };
  // Compute evaluation from side-to-move perspective for consistent negamax
  const p = fen4.split(/\s+/);
  const stm = p[1];
  const standW = evaluateMaterial(fen4);
  const stand = (stm === 'w') ? standW : -standW;
  if (stand >= beta) return { score: stand, pv: [], aborted: false };
  if (stand > alpha) alpha = stand;
  const caps = listCapturesOrdered(fen4);
  for (const c of caps) {
    // Only explore captures with not-too-bad SEE
    if (c.see < -0.5) continue;
    const r = quiesce(c.fen4, -beta, -alpha, nodesObj, deadline);
    if (r.aborted) return { score: alpha, pv: [], aborted: true };
    const score = -r.score;
    if (score >= beta) return { score, pv: [], aborted: false };
    if (score > alpha) alpha = score;
  }
  const res = { score: alpha, pv: [], aborted: false };
  if (_pStart) CURRENT_PROFILE.quiesceTimeNs += process.hrtime.bigint() - _pStart;
  return res;
}

function listCapturesOrdered(fen4) {
  const cachedT = TRANS_CACHE && TRANS_CACHE.get(fen4);
  const legal = cachedT || movesCached(fen4, 'other');
  const out = [];
  for (const m of legal) {
    const isCap = m.captured || (m.flags && m.flags.includes && m.flags.includes('c'));
    if (!isCap) continue;
    const cf = m.fen4 || (function(){ const tmp=new Chess(ensureSix(fen4)); const md=tmp.move({from:m.from,to:m.to,promotion:m.promotion||'q'}); return md ? tmp.fen().split(' ').slice(0,4).join(' ') : null; })();
    if (!cf) continue;
    const val = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
    const victim = val[m.captured || (m.made && m.made.captured) || 0] || 0;
    const attacker = val[m.piece || (m.made && m.made.piece) || 'p'] || 0;
    const attackerEff = m.promotion ? Math.max(attacker, val['q']) : attacker;
    const see = victim - attackerEff;
    out.push({ fen4: cf, see });
  }
  out.sort((a, b) => b.see - a.see);
  return out;
}

// Mate-in-1 detector (side to move). Returns first found {uci,san} or null.
function detectMateInOne(fen4) {
  const legal = (TRANS_CACHE && TRANS_CACHE.get(fen4)) || movesCached(fen4, 'other');
  for (const m of legal) {
    const cf = m.fen4 || (function(){ const tmp=new Chess(ensureSix(fen4)); const md=tmp.move({from:m.from,to:m.to,promotion:m.promotion||'q'}); return md ? tmp.fen().split(' ').slice(0,4).join(' ') : null; })();
    if (!cf) continue;
    const tmp = new Chess(ensureSix(cf));
    if (tmp.isCheckmate()) return { uci: m.from + m.to + (m.promotion || ''), san: m.san || '' };
  }
  return null;
}

function searchRootOnce(fen4, depth, verbose = false, deadline, alphaInit = -Infinity, betaInit = Infinity, hintMove = null) {
  // New root iteration increments generation to allow aging.
  TT_GENERATION++;
  const nodesObj = { count: 0 };
  const ctx = { killers: [], history: new Map(), stats: { fh: 0, fl: 0, ttHits: 0, lmrReductions: 0, nullTry: 0, nullCut: 0 } };
  const moves = orderChildren(fen4, hintMove, ctx, 0, depth, deadline);
  const rootTurn = fen4.split(/\s+/)[1];
  let best = null;
  let bestScoreWhite = -Infinity; // white-centric score of chosen move
  let bestScoreRoot = -Infinity;  // root-side perspective score used for alpha/beta logic
  let bestCmpScore = -Infinity; // comparison score (possibly flipped by ROOT_FLIP)
  let alpha = alphaInit, beta = betaInit;
  const alphaOrig = alpha;
  const maxB = depth > 7 ? 8 : depth > 5 ? 12 : depth > 3 ? 24 : 64;
  const scored = [];
  let consumed = 0, extraChecks = 1, usedExtra = 0;
  // If a child search hits deadline, switch to quick static-eval mode for remaining children to avoid total timeouts
  let quickMode = false;
  const deadlinePassed = () => deadline && Date.now() > deadline;
  for (let i = 0; i < moves.length && (consumed < maxB || (moves[i].isCheck && usedExtra < extraChecks)); i++) {
    const m = moves[i];
    if (consumed >= maxB && m.isCheck) usedExtra++; else consumed++;
    // Fast check: does this move allow opponent (child side) to mate immediately next ply?
    let sRootSide; let pv;
    const oppMateNext = !quickMode ? detectMateInOne(m.fen4) : null;
    if (oppMateNext) {
      const MATE_BASE = 100000;
      sRootSide = -(MATE_BASE - 1); // catastrophic for root side
      pv = [m.san, oppMateNext.san];
    } else if ((quickMode || deadlinePassed()) && !(m.san === 'O-O' || m.san === 'O-O-O')) {
      // Static-eval fast path to complete remaining root moves under time pressure
      if (!quickMode) quickMode = true;
      const wEval = evaluateMaterial(m.fen4);
      const stmChild = m.fen4.split(/\s+/)[1];
      const childStmScore = (stmChild === 'w') ? wEval : -wEval;
      sRootSide = -childStmScore;
      pv = [m.san];
    } else {
      const r = alphabetaPV(m.fen4, depth - 1, -beta, -alpha, m.isCap ? 1 : 0, nodesObj, deadline, ctx, 1, null);
      if (r.aborted || deadlinePassed()) {
        // Fallback static eval if child aborted: continue root iteration instead of aborting all
        const wEval = evaluateMaterial(m.fen4);
        const stmChild = m.fen4.split(/\s+/)[1];
        const childStmScore = (stmChild === 'w') ? wEval : -wEval;
        sRootSide = -childStmScore;
        pv = [m.san];
        quickMode = true;
      } else {
        sRootSide = -r.score;
        pv = [m.san, ...r.pv];
      }
    }
    const sWhite = (rootTurn === 'w') ? sRootSide : -sRootSide; // convert to always white-centric
    scored.push({ uci: m.uci, san: m.san, score: sWhite, pv });
  // Root move selection: maximize white-centric score for white to move, minimize it for black.
  // ROOT_FLIP allows choosing worst instead for testing (FLIP=-1).
  const sideFactor = (rootTurn === 'w') ? 1 : -1; // black wants lower white-centric values
  const cmp = (sWhite * sideFactor) * ROOT_FLIP;
    if (cmp > bestCmpScore) { bestCmpScore = cmp; bestScoreWhite = sWhite; bestScoreRoot = sRootSide; best = m.uci; }
    if (sRootSide > alpha) alpha = sRootSide; // alpha/beta remain in root-side perspective for pruning
  }
  // Assemble best/worst only if requested by caller
  const base = { best, score: bestScoreWhite, nodes: nodesObj.count, scored, failLow: bestScoreRoot <= alphaOrig, failHigh: bestScoreRoot >= beta, fhCount: ctx.stats.fh, flCount: ctx.stats.fl, ttHits: ctx.stats.ttHits, lmrReductions: ctx.stats.lmrReductions, nullTries: ctx.stats.nullTry, nullCutoffs: ctx.stats.nullCut, aborted: deadlinePassed() };
  // Optional root move randomness among near-equal candidates
  const enableRand = process.env.ENABLE_MOVE_RANDOMNESS === '1';
  if (enableRand && scored.length > 1) {
    const margin = parseFloat(process.env.ROOT_RANDOM_MARGIN || '0.15'); // pawns
    // Collect moves within margin of bestScore
    const near = scored.filter(m => (bestScoreWhite - m.score) <= margin && (bestScoreWhite - m.score) >= 0);
    if (near.length > 1) {
      // Simple xorshift64 PRNG
      if (!global.__rootRandState) {
        let seed = BigInt(process.env.RANDOM_SEED || Date.now());
        if (seed === 0n) seed = 1n;
        global.__rootRandState = seed;
      }
      function rand64() {
        let x = global.__rootRandState;
        // xorshift64* variant
        x ^= x << 13n;
        x ^= x >> 7n;
        x ^= x << 17n;
        global.__rootRandState = x & ((1n<<63n)-1n);
        return Number(global.__rootRandState & 0xFFFFFFFFn);
      }
      const idx = rand64() % near.length;
      const choice = near[idx];
      base.best = choice.uci;
      base.score = choice.score; // keep associated white-centric score
    }
  }
  if (!best && moves.length > 0) {
    // Guarantee a move for callers expecting a principal variation even if alpha/beta logic didn't set best (rare edge case)
    best = moves[0].uci;
    base.best = best;
  }
  if (!verbose) return base;
  // Sort PV candidates according to root side: White wants higher white-centric scores,
  // Black wants lower white-centric scores.
  let sorted;
  if (rootTurn === 'w') {
    sorted = [...scored].sort((a, b) => b.score - a.score);
  } else {
    sorted = [...scored].sort((a, b) => a.score - b.score);
  }
  const top = sorted.slice(0, 3).map(x => ({ score: +x.score.toFixed(2), line: x.pv.join(' ') }));
  // For worst, invert the sense: for White worst are the lowest scores; for Black worst are the highest
  let worstSorted;
  if (rootTurn === 'w') {
    worstSorted = [...scored].sort((a, b) => a.score - b.score);
  } else {
    worstSorted = [...scored].sort((a, b) => b.score - a.score);
  }
  const bot = worstSorted.slice(0, 3).map(x => ({ score: +x.score.toFixed(2), line: x.pv.join(' ') }));
  return { ...base, bestLines: top, worstLines: bot };
}

// Enhanced move ordering: allow TT best move to be considered first when ordering children.
function orderChildren(fen4, ttBest, ctx, ply, depth = 0, deadline) {
  const _pStart = PROFILING_ENABLED && CURRENT_PROFILE ? process.hrtime.bigint() : null;
  const base = new Chess(ensureSix(fen4));
  // Use transition cache if available; else compute and populate
  let legal = TRANS_CACHE && TRANS_CACHE.get(fen4);
  const fromCache = !!legal;
  if (!legal) {
    legal = movesCached(fen4, 'order');
  }
  const out = [];
  const inCheckRoot = base.isCheck();
  let unsafeBudget = 6;
  for (const m of legal) {
    let skipMove = false;
    let cf, givesCheck, uci, isCap, isPromo, made, from, to, promo, san;
    if (fromCache && m.fen4) {
      // Use cached transition
      cf = m.fen4; givesCheck = !!m.isCheck; uci = m.uci || (m.from + m.to + (m.promotion || '')); isCap = !!m.isCap; isPromo = !!m.isPromo; from = m.from; to = m.to; promo = m.promotion; san = m.san; made = { captured: m.captured, to: m.to };
    } else {
      const tmp = new Chess(ensureSix(fen4));
      made = tmp.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
      if (!made) continue;
      cf = tmp.fen().split(' ').slice(0, 4).join(' ');
      givesCheck = !!tmp.isCheck();
      uci = m.from + m.to + (m.promotion || '');
      isCap = !!(made.captured) || (made.flags && made.flags.includes && made.flags.includes('c'));
      isPromo = !!m.promotion;
      from = m.from; to = m.to; promo = m.promotion; san = m.san;
      // Populate transition cache only once
      if (TRANS_CACHE) {
        let arr = TRANS_CACHE.get(fen4);
        if (!arr) { arr = []; TRANS_CACHE.set(fen4, arr); }
        if (!arr.length) {
          // If this is the first time we see this fen4 in this search, seed with full list
          // Create entries for all legal moves based on current loop context
          // Note: We can't reconstruct all made results here cheaply; push one by one as computed
        }
        arr.push({ uci, san, fen4: cf, isCap, isPromo, isCheck: givesCheck, captured: made.captured, from, to, promotion: promo });
      }
    }
  // Keep ordering lightweight: avoid full eval here; rely on cap/SEE/killer/history/check bonuses
  const pre = 0;
    let castleExtra = 0;
    // MVV-LVA-like: heavier bonus if capture high-value victim with low-value attacker
    let capBonus = 0;
    if (isCap && made.captured) {
      const val = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
      const victim = val[made.captured] || 0;
      const attacker = val[m.piece || 'p'] || 0;
      capBonus = 50 + Math.max(0, (victim - attacker) * 10);
    }
    const killers = (ctx && ctx.killers && ctx.killers[ply]) || [];
    const killerBonus = killers && (uci === killers[0] ? 400 : (uci === killers[1] ? 200 : 0));
    const hist = (ctx && ctx.history && ctx.history.get(uci)) || 0;
    const histBonus = Math.min(300, hist);
    // Simple SEE approximation
    let see = 0;
    if (isCap && made.captured) {
      const val = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
      const victim = val[made.captured] || 0;
      const attacker = val[m.piece || 'p'] || 0;
      // crude: promotion attacker value if promotion
      const attackerEff = isPromo ? Math.max(attacker, val['q']) : attacker;
      see = victim - attackerEff;
    }
    // At deeper depths, discourage obviously losing captures unless they give check
    if (depth >= 4 && isCap && see < -1 && !givesCheck) {
      // Skip badly losing captures to reduce branching, but preserve checking sacs
      continue;
    }
    const seeBonus = isCap ? Math.max(-30, Math.min(60, see * 10)) : 0;
  const CHECK_BONUS = parseInt(process.env.CHECK_BONUS || '900', 10);
    let checkBonus = 0;
    if (givesCheck) {
      checkBonus = CHECK_BONUS;
      // Scale down overly speculative checking moves that lose material per SEE
      if (isCap && see < 0) {
        checkBonus = Math.max(150, CHECK_BONUS + see * 120); // negative see reduces bonus
      } else if (!isCap && see < -1) {
        checkBonus = Math.max(150, Math.floor(CHECK_BONUS * 0.4));
      }
    }
    // Extra bonuses when we're in check: prioritize king safety evasions (captures, blocks, king moves)
    let evasionBonus = 0;
    if (inCheckRoot) {
      if (isCap) evasionBonus += 1500; // capturing checking piece or interposing with capture
      if (m.piece === 'k') evasionBonus += 1800; // king moves to escape check
      if (!isCap && givesCheck) evasionBonus += 500; // counter-check (rare but can be strong)
    }
    // If we give check via a non-capture but the checking piece is immediately recapturable cheaply, downweight (unsafe check)
    let unsafePenalty = 0;
    if (givesCheck && !isCap && unsafeBudget > 0) {
      unsafeBudget--;
      let enemyMoves = movesCached(cf, 'order');
      const toSq = made.to;
      const val = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
      const movedVal = val[m.piece || 'p'] || 0;
      for (const em of enemyMoves) {
        if (em.to === toSq && em.flags && em.flags.includes('c')) {
          const attackerVal = val[em.piece || 'p'] || 0;
          if (attackerVal <= movedVal) { unsafePenalty = 900; break; }
        }
      }
    }
    // Penalize quiet king moves that relinquish castling rights early (unless in check or capturing)
    if (m.piece === 'k' && !isCap && !inCheckRoot) {
      const isCastle = m.flags && (m.flags.includes('k') || m.flags.includes('q'));
      if (isCastle) {
        // Strong bonus to surface castling moves early; configurable.
        const CASTLE_BONUS = parseInt(process.env.CASTLE_BONUS || '1600', 10);
        unsafePenalty -= CASTLE_BONUS; // subtract from penalty bucket (acts as bonus)
        castleExtra += 2000; // additional explicit bonus to guarantee early ordering surfacing
      } else {
        // If king moves off starting square while rights remain, push it far down.
        const kingStart = base.turn() === 'w' ? 'e1' : 'e8';
        if (made.from === kingStart) {
          unsafePenalty += 2500; // large penalty for early manual king walk
        } else {
          unsafePenalty += 800; // other slow king drifts
        }
      }
    }
    // Avoid hanging the queen: penalize queen moves to squares immediately capturable by a cheaper piece
    if (m.piece === 'q' && !isCap) {
      let enemyMoves = movesCached(cf, 'order');
      const toSq = to;
      const val = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
      for (const em of enemyMoves) {
        if (em.to === toSq && em.flags && em.flags.includes('c')) {
          const attackerVal = val[em.piece || 'p'] || 0;
          if (attackerVal <= 5) { // pawn/knight/bishop/rook
            // At deeper depths, skip entirely to reduce obvious blunders
            if (depth >= 4) { skipMove = true; }
            else { unsafePenalty += 1800; } // push far down the move list
            break;
          }
        }
      }
    }
    // General blunder filter: quiet moves that place a piece en prise by a cheaper attacker
    if (!isCap && m.piece !== 'k') {
      let enemyMoves = movesCached(cf, 'order');
      const toSq = to;
      const val = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
      const movedVal = val[m.piece || 'p'] || 0;
      for (const em of enemyMoves) {
        if (em.to === toSq && em.flags && em.flags.includes('c')) {
          const attackerVal = val[em.piece || 'p'] || 0;
          if (attackerVal < movedVal) {
            if (depth >= 4) { skipMove = true; }
            else { unsafePenalty += 1200; }
            break;
          }
        }
      }
    }
    if (skipMove) continue; // drop obviously losing quiet moves at deeper depths
    const weight = (uci === ttBest ? 5000 : 0) + checkBonus + evasionBonus - unsafePenalty + castleExtra + (isCap ? capBonus : 0) + seeBonus + (isPromo ? 80 : 0) + killerBonus + histBonus + pre;
    out.push({ uci, san: san || m.san, fen4: cf, pre, isCap, isPromo, isCheck: givesCheck, weight });
  }
  // Fallback: ensure at least one move if heuristics skipped all (e.g., all losing captures filtered)
  if (out.length === 0 && legal.length > 0) {
    const m = legal[0];
    const tmp = new Chess(ensureSix(fen4));
    const made = tmp.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    if (made) {
      const cf = tmp.fen().split(' ').slice(0,4).join(' ');
      const uci = m.from + m.to + (m.promotion || '');
      out.push({ uci, san: m.san, fen4: cf, pre: 0, isCap: false, isPromo: !!m.promotion, isCheck: !!tmp.isCheck(), weight: 0 });
    }
  }
  out.sort((a, b) => b.weight - a.weight);
  if (_pStart) CURRENT_PROFILE.orderChildrenTimeNs += process.hrtime.bigint() - _pStart;
  return out;
}

parentPort.on('message', (msg) => {
  if (!msg || (msg.type !== 'search' && msg.type !== 'profile-toggle')) return;
  if (msg.type === 'profile-toggle') {
    PROFILING_ENABLED = !!msg.enabled;
    // Acknowledge toggle
    try { parentPort.postMessage({ id: msg.id || null, ok: true, profilingEnabled: PROFILING_ENABLED, type: 'profile-toggle-ack' }); } catch {}
    return;
  }
  const { id, fen4, depth, verbose, maxTimeMs, hintMove } = msg;
  try {
    const t0 = Date.now();
  // Reset per-search caches
  MOVE_CACHE = new Map();
  TRANS_CACHE = new Map();
  if (PROFILING_ENABLED) {
        CURRENT_PROFILE = {
        startNs: process.hrtime.bigint(),
        evalTimeNs: 0n,
        orderChildrenTimeNs: 0n,
        quiesceTimeNs: 0n,
        alphabetaTimeNs: 0n,
        depthTimesNs: [],
        ttGetCount: 0,
        ttStoreCount: 0,
        nullMoveCount: 0,
        nodesAtEnd: 0,
        evalCalls: 0,
        moveGenTimeNs: 0n,
        moveGenCalls: 0,
        movesGenerated: 0,
        evalMoveGenTimeNs: 0n,
        evalMoveGenCalls: 0,
        evalMovesGenerated: 0,
        orderMoveGenTimeNs: 0n,
        orderMoveGenCalls: 0,
        orderMovesGenerated: 0
      };
      // per-search caches initialized above
    }
    const target = Math.max(1, depth|0);
    const deadline = maxTimeMs ? (Date.now() + Math.max(100, maxTimeMs|0)) : 0;
    let lastComplete = null;
    let depthReached = 0;
    let prevScore = null;
    for (let d = 1; d <= target; d++) {
      const _depthStart = PROFILING_ENABLED && CURRENT_PROFILE ? process.hrtime.bigint() : null;
      // Aspiration windows around previous score
      let alpha = -Infinity, beta = Infinity;
      if (prevScore != null) {
        const window = 0.75; // +/- 0.75 pawn
        alpha = prevScore - window;
        beta = prevScore + window;
      }
      let one = searchRootOnce(fen4, d, !!verbose, deadline, alpha, beta, d === 1 ? hintMove : null);
      // On fail low/high, re-search with widened windows
      let widen = 1.5;
      while (one && !one.aborted && (one.failLow || one.failHigh)) {
        alpha = one.failLow ? -Infinity : (alpha - widen);
        beta = one.failHigh ? Infinity : (beta + widen);
        one = searchRootOnce(fen4, d, !!verbose, deadline, alpha, beta);
        widen *= 2;
        if (widen > 100) break; // safety
      }
      if (one && one.aborted) break;
      lastComplete = one;
      depthReached = d;
      prevScore = one ? one.score : prevScore;
      if (_depthStart) CURRENT_PROFILE.depthTimesNs.push({ depth: d, ns: process.hrtime.bigint() - _depthStart });
    }
    if (!lastComplete) {
      // Return minimal info rather than failing hard, but flag early abort to help server retry logic
      parentPort.postMessage({ id, ok: true, best: null, score: 0, nodes: 0, depthReached: 0, abortedEarly: true, ms: Date.now() - t0 });
      if (PROFILING_ENABLED && CURRENT_PROFILE) CURRENT_PROFILE = null;
      return;
    }
  const { best, score, nodes, bestLines, worstLines, fhCount, flCount, ttHits, lmrReductions, nullTries, nullCutoffs } = lastComplete;
  // Mate distance derivation: score magnitude near MATE_BASE indicates mate; distance = MATE_BASE - |score|
  let mateDistance = null;
  const MATE_BASE = 100000;
  if (Math.abs(score) >= MATE_BASE - 1000) {
    mateDistance = MATE_BASE - Math.abs(score);
  }
    if (PROFILING_ENABLED && CURRENT_PROFILE) CURRENT_PROFILE.nodesAtEnd = nodes;
  const payload = { id, ok: true, best, score, nodes, depthReached, fhCount, flCount, ttHits, lmrReductions, nullTries, nullCutoffs, mateDistance, ms: Date.now() - t0 };
  if (bestLines) payload.bestLines = bestLines;
  if (worstLines) payload.worstLines = worstLines;
  if (verbose && lastComplete && Array.isArray(lastComplete.scored)) payload.scored = lastComplete.scored;
    parentPort.postMessage(payload);
    if (PROFILING_ENABLED && CURRENT_PROFILE) {
      try {
        const endNs = process.hrtime.bigint();
        const prof = CURRENT_PROFILE;
        const toMs = (ns)=> Number(ns) / 1e6;
        const summary = {
          totalMs: toMs(endNs - prof.startNs).toFixed(2),
          evalMs: toMs(prof.evalTimeNs).toFixed(2),
          orderChildrenMs: toMs(prof.orderChildrenTimeNs).toFixed(2),
          quiesceMs: toMs(prof.quiesceTimeNs).toFixed(2),
          alphabetaMs: toMs(prof.alphabetaTimeNs).toFixed(2),
          evalCalls: prof.evalCalls || 0,
          moveGenMs: toMs(prof.moveGenTimeNs || 0n).toFixed(2),
          moveGenCalls: prof.moveGenCalls || 0,
          movesGenerated: prof.movesGenerated || 0,
          evalMoveGenMs: toMs(prof.evalMoveGenTimeNs || 0n).toFixed(2),
          evalMoveGenCalls: prof.evalMoveGenCalls || 0,
          evalMovesGenerated: prof.evalMovesGenerated || 0,
          orderMoveGenMs: toMs(prof.orderMoveGenTimeNs || 0n).toFixed(2),
          orderMoveGenCalls: prof.orderMoveGenCalls || 0,
          orderMovesGenerated: prof.orderMovesGenerated || 0,
          ttGetCount: prof.ttGetCount,
          ttStoreCount: prof.ttStoreCount,
          nullMoveCount: prof.nullMoveCount,
          nodes: prof.nodesAtEnd,
          depthBreakdown: prof.depthTimesNs.map(d => ({ depth: d.depth, ms: toMs(d.ns).toFixed(2) }))
        };
        const lines = [];
        lines.push('# Search Profiling Log');
        lines.push(`totalMs=${summary.totalMs}`);
        lines.push(`nodes=${summary.nodes}`);
        lines.push(`evalMs=${summary.evalMs}`);
        lines.push(`orderChildrenMs=${summary.orderChildrenMs}`);
        lines.push(`alphabetaMs=${summary.alphabetaMs}`);
        lines.push(`quiesceMs=${summary.quiesceMs}`);
  lines.push(`evalCalls=${summary.evalCalls}`);
  lines.push(`moveGenMs=${summary.moveGenMs}`);
  lines.push(`moveGenCalls=${summary.moveGenCalls}`);
  lines.push(`movesGenerated=${summary.movesGenerated}`);
  lines.push(`evalMoveGenMs=${summary.evalMoveGenMs}`);
  lines.push(`evalMoveGenCalls=${summary.evalMoveGenCalls}`);
  lines.push(`evalMovesGenerated=${summary.evalMovesGenerated}`);
  lines.push(`orderMoveGenMs=${summary.orderMoveGenMs}`);
  lines.push(`orderMoveGenCalls=${summary.orderMoveGenCalls}`);
  lines.push(`orderMovesGenerated=${summary.orderMovesGenerated}`);
  lines.push(`ttGetCount=${summary.ttGetCount}`);
        lines.push(`ttStoreCount=${summary.ttStoreCount}`);
        lines.push(`nullMoveCount=${summary.nullMoveCount}`);
        lines.push('depthBreakdown:');
        for (const d of summary.depthBreakdown) lines.push(`  depth=${d.depth} ms=${d.ms}`);
        lines.push('JSON:');
        lines.push(JSON.stringify(summary, null, 2));
        const logName = `search_profile_${Date.now()}_${id}.log`;
        const logPath = pathJoinSafe(process.cwd(), 'logs', logName);
        fs.writeFileSync(logPath, lines.join('\n'), 'utf8');
      } catch (e) {
        try { console.error('profiling log error', e); } catch {}
      } finally {
        CURRENT_PROFILE = null;
      }
    }
  } catch (e) {
    // Log for test visibility
    try { console.error('worker search error:', e && e.stack ? e.stack : e); } catch {}
    parentPort.postMessage({ id, ok: false, error: String(e) });
  }
});

function pathJoinSafe(base, sub, file) {
  try { return require('path').join(base, sub, file); } catch { return base + '/' + sub + '/' + file; }
}
