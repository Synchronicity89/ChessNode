'use strict';
const { parentPort, workerData } = require('worker_threads');

let Chess;
try { Chess = require('chess.js').Chess; } catch (e) { /* will throw on use */ }

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
  // Mobility (legal moves count difference)
  const movesW = chessW.moves({ verbose: true }).length;
  const chessB = new Chess(ensureSix(flipSide(fen4)));
  const movesB = chessB.moves({ verbose: true }).length;
  const mobility = (movesW - movesB) * 0.06; // light weight
  score += mobility;

  // Center control and occupancy
  const centers = new Set(['d4','e4','d5','e5']);
  function countAttacks(chess) {
    let cnt = 0;
    const mv = chess.moves({ verbose: true });
    for (const m of mv) if (centers.has(m.to)) cnt++;
    return cnt;
  }
  function countOccupancy(targetColor) {
    let cnt = 0;
    for (const row of board) for (const sq of row) if (sq && sq.color === targetColor && centers.has(sq.square)) cnt++;
    return cnt;
  }
  const centerAttackDiff = (countAttacks(chessW) - countAttacks(chessB)) * 0.1;
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

  // Checks: tiny bonus if opponent is in check
  if (chessW.isCheck()) score -= 0.2; // white to move in fen4 being in check is bad for white
  if (chessB.isCheck()) score += 0.2; // black to move (after flip) in check is good for white

  // Round to two decimals to stabilize scores
  return Math.round(score * 100) / 100;
}

// removed older orderChildren(fen4) in favor of TT-aware version below

// Alpha-beta with PV extraction
function timeUp(deadline, nodes) {
  if (!deadline) return false;
  if (nodes.count % 64 !== 0) return false; // check more frequently to respect budgets
  return Date.now() > deadline;
}

function alphabetaPV(fen4, depth, alpha, beta, captureParity = 0, nodesObj, deadline, ctx, ply, hintMove) {
  nodesObj.count++;
  if (timeUp(deadline, nodesObj)) return { score: 0, pv: [], aborted: true };
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
    // Horizon check extension: if side to move is in check at the horizon,
    // extend by one ply instead of dropping directly into quiescence.
    if (chess.isCheck()) {
      depth = 1;
    } else {
      const q = quiesce(fen4, alpha, beta, nodesObj, deadline);
      return q;
    }
  }
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
  if (depth >= 3 && !chess.isCheck()) {
    if (ctx && ctx.stats) ctx.stats.nullTry = (ctx.stats.nullTry || 0) + 1;
    // Quick non-pawn material presence check for the side to move
    let hasNonPawn = false;
    for (const row of chess.board()) for (const sq of row) if (sq && sq.color === chess.turn() && sq.type !== 'p') { hasNonPawn = true; break; }
    if (hasNonPawn) {
      const parts = fen4.split(/\s+/);
      const nullFen = `${parts[0]} ${parts[1] === 'w' ? 'b' : 'w'} ${parts[2]} -`;
  const R = depth > 5 ? 3 : 2;
      const r = alphabetaPV(nullFen, depth - 1 - R, -beta, -beta + 1, 0, nodesObj, deadline, ctx, (ply|0)+1, null);
      if (!r.aborted) {
        const score = -r.score;
        if (score >= beta) {
          if (ctx && ctx.stats) ctx.stats.nullCut = (ctx.stats.nullCut || 0) + 1;
          ttStore(hash, depth, TT_LOWER, score, null);
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
  const children = orderChildren(fen4, prefer, ctx, ply, depth); // pass preferred move (if any)
  if (children.length === 0) return { score: evaluateMaterial(fen4), pv: [], aborted: false };
  // modest branching control deeper
  const maxB = depth > 7 ? 8 : depth > 5 ? 12 : depth > 3 ? 16 : 32;
  let bestScore = -Infinity;
  let bestPV = [];
  let bestMove = null;
  let taken = 0;
  for (let i = 0; i < children.length && (taken < maxB || children[i].isCheck); i++) {
    const ch = children[i];
    if (!ch.isCheck) taken++;
    // Late Move Reductions for quiet moves late in list
    let r;
    const isQuiet = !ch.isCap && !ch.isPromo && !ch.isCheck; // never reduce checking moves
    const late = i >= 3 && depth >= 3 && isQuiet;
    if (late) {
      if (ctx && ctx.stats) ctx.stats.lmrReductions = (ctx.stats.lmrReductions || 0) + 1;
      const red = 1;
      r = alphabetaPV(ch.fen4, depth - 1 - red, -alpha - 1, -alpha, ch.isCap ? captureParity + 1 : 0, nodesObj, deadline, ctx, (ply|0)+1, null);
      if (!r.aborted) {
        const sc = -r.score;
        if (sc > alpha) {
          // re-search at full depth
          r = alphabetaPV(ch.fen4, depth - 1, -beta, -alpha, ch.isCap ? captureParity + 1 : 0, nodesObj, deadline, ctx, (ply|0)+1, null);
        }
      }
    } else {
      r = alphabetaPV(ch.fen4, depth - 1, -beta, -alpha, ch.isCap ? captureParity + 1 : 0, nodesObj, deadline, ctx, (ply|0)+1, null);
    }
  if (r.aborted) return { score: 0, pv: [], aborted: true };
    const score = -r.score;
    const pv = [ch.san, ...r.pv];
    if (score >= beta) {
      // store lower-bound (fail-high)
      ttStore(hash, depth, TT_LOWER, score, ch.uci);
      sharedHintSet(hash, uciToPack(ch.uci), depth);
      // Killer and history updates for non-captures
      if (!ch.isCap) {
        const k = ctx.killers[ply] || (ctx.killers[ply] = []);
        if (k[0] !== ch.uci) { k[1] = k[0]; k[0] = ch.uci; }
        const old = ctx.history.get(ch.uci) || 0;
        ctx.history.set(ch.uci, old + depth * depth);
      }
      ctx.stats.fh++;
      return { score, pv, aborted: false };
    }
    if (score > alpha) alpha = score;
    if (score > bestScore) { bestScore = score; bestPV = pv; bestMove = ch.uci; }
  }
  // Determine flag
  let flag = TT_EXACT;
  if (bestScore <= alphaOrig) flag = TT_UPPER; // failed low (didn't raise alpha)
  else if (bestScore >= beta) flag = TT_LOWER; // fail-high (already handled earlier, but just in case)
  ttStore(hash, depth, flag, bestScore, bestMove);
  if (bestMove) sharedHintSet(hash, uciToPack(bestMove), depth);
  if (bestScore <= alphaOrig) ctx.stats.fl++;
  return { score: alpha, pv: bestPV, aborted: false };
}

// Quiescence search over captures with SEE filter
function quiesce(fen4, alpha, beta, nodesObj, deadline) {
  nodesObj.count++;
  if (timeUp(deadline, nodesObj)) return { score: alpha, pv: [], aborted: true };
  const stand = evaluateMaterial(fen4);
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
  return { score: alpha, pv: [], aborted: false };
}

function listCapturesOrdered(fen4) {
  const base = new Chess(ensureSix(fen4));
  const legal = base.moves({ verbose: true });
  const out = [];
  for (const m of legal) {
    if (!m.flags || !m.flags.includes('c')) continue;
    const tmp = new Chess(ensureSix(fen4));
    const made = tmp.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    if (!made) continue;
    const cf = tmp.fen().split(' ').slice(0,4).join(' ');
    const val = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
    const victim = val[made.captured] || 0;
    const attacker = val[m.piece || 'p'] || 0;
    const attackerEff = m.promotion ? Math.max(attacker, val['q']) : attacker;
    const see = victim - attackerEff;
    out.push({ fen4: cf, see });
  }
  out.sort((a, b) => b.see - a.see);
  return out;
}

function searchRootOnce(fen4, depth, verbose = false, deadline, alphaInit = -Infinity, betaInit = Infinity, hintMove = null) {
  // New root iteration increments generation to allow aging.
  TT_GENERATION++;
  const nodesObj = { count: 0 };
  const ctx = { killers: [], history: new Map(), stats: { fh: 0, fl: 0, ttHits: 0, lmrReductions: 0, nullTry: 0, nullCut: 0 } };
  const moves = orderChildren(fen4, hintMove, ctx, 0, depth);
  let best = null;
  let bestScore = -Infinity;
  let alpha = alphaInit, beta = betaInit;
  const alphaOrig = alpha;
  const maxB = depth > 7 ? 8 : depth > 5 ? 12 : depth > 3 ? 24 : 64;
  const scored = [];
  for (let i = 0; i < moves.length && i < maxB; i++) {
    const m = moves[i];
    const r = alphabetaPV(m.fen4, depth - 1, -beta, -alpha, m.isCap ? 1 : 0, nodesObj, deadline, ctx, 1, null);
    if (r.aborted) return { aborted: true, nodes: nodesObj.count };
    const s = -r.score;
    const pv = [m.san, ...r.pv];
    scored.push({ uci: m.uci, san: m.san, score: s, pv });
    if (s > bestScore) { bestScore = s; best = m.uci; }
    if (s > alpha) alpha = s;
  }
  // Assemble best/worst only if requested by caller
  const base = { best, score: bestScore, nodes: nodesObj.count, scored, failLow: bestScore <= alphaOrig, failHigh: bestScore >= beta, fhCount: ctx.stats.fh, flCount: ctx.stats.fl, ttHits: ctx.stats.ttHits, lmrReductions: ctx.stats.lmrReductions, nullTries: ctx.stats.nullTry, nullCutoffs: ctx.stats.nullCut };
  if (!verbose) return base;
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 3).map(x => ({ score: +x.score.toFixed(2), line: x.pv.join(' ') }));
  const bot = sorted.slice(-3).map(x => ({ score: +x.score.toFixed(2), line: x.pv.join(' ') }));
  return { ...base, bestLines: top, worstLines: bot };
}

// Enhanced move ordering: allow TT best move to be considered first when ordering children.
function orderChildren(fen4, ttBest, ctx, ply, depth = 0) {
  const base = new Chess(ensureSix(fen4));
  const legal = base.moves({ verbose: true });
  const out = [];
  const inCheckRoot = base.isCheck();
  for (const m of legal) {
    const tmp = new Chess(ensureSix(fen4));
    const made = tmp.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    if (!made) continue;
    const cf = tmp.fen().split(' ').slice(0, 4).join(' ');
    const givesCheck = !!tmp.isCheck();
    const uci = m.from + m.to + (m.promotion || '');
    const isCap = !!(made.captured) || (made.flags && made.flags.includes('c'));
    const isPromo = !!m.promotion;
    const pre = evaluateMaterial(cf);
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
  const CHECK_BONUS = parseInt(process.env.CHECK_BONUS || '3000', 10);
  const checkBonus = givesCheck ? CHECK_BONUS : 0;
    // Extra bonuses when we're in check: prioritize king safety evasions (captures, blocks, king moves)
    let evasionBonus = 0;
    if (inCheckRoot) {
      if (isCap) evasionBonus += 1500; // capturing checking piece or interposing with capture
      if (m.piece === 'k') evasionBonus += 1800; // king moves to escape check
      if (!isCap && givesCheck) evasionBonus += 500; // counter-check (rare but can be strong)
    }
    const weight = (uci === ttBest ? 5000 : 0) + checkBonus + evasionBonus + (isCap ? capBonus : 0) + seeBonus + (isPromo ? 80 : 0) + killerBonus + histBonus + pre;
    out.push({ uci, san: m.san, fen4: cf, pre, isCap, isPromo, isCheck: givesCheck, weight });
  }
  out.sort((a, b) => b.weight - a.weight);
  return out;
}

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'search') return;
  const { id, fen4, depth, verbose, maxTimeMs, hintMove } = msg;
  try {
    const t0 = Date.now();
    const target = Math.max(1, depth|0);
    const deadline = maxTimeMs ? (Date.now() + Math.max(100, maxTimeMs|0)) : 0;
    let lastComplete = null;
    let depthReached = 0;
    let prevScore = null;
    for (let d = 1; d <= target; d++) {
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
    }
    if (!lastComplete) {
      // Return minimal info rather than failing hard
      parentPort.postMessage({ id, ok: true, best: null, score: 0, nodes: 0, depthReached: 0, ms: Date.now() - t0 });
      return;
    }
  const { best, score, nodes, bestLines, worstLines, fhCount, flCount, ttHits, lmrReductions, nullTries, nullCutoffs } = lastComplete;
  const payload = { id, ok: true, best, score, nodes, depthReached, fhCount, flCount, ttHits, lmrReductions, nullTries, nullCutoffs, ms: Date.now() - t0 };
    if (bestLines) payload.bestLines = bestLines;
    if (worstLines) payload.worstLines = worstLines;
    parentPort.postMessage(payload);
  } catch (e) {
    // Log for test visibility
    try { console.error('worker search error:', e && e.stack ? e.stack : e); } catch {}
    parentPort.postMessage({ id, ok: false, error: String(e) });
  }
});
