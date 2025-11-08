// server.js
// Express server to serve a browser UI and proxy to the local UCI engine
'use strict';

const express = require('express');
const path = require('path');
const { UciClient } = require('./uciClient');
const { getLichessToken } = require('./secrets');
const { downloadAndIndex } = require('./lichessDownloader');
const { OpeningBook } = require('./openingBook');

const PORT = process.env.PORT || 3000;

async function main() {
  const app = express();
  app.use(express.json());

  // Static files
  const publicDir = path.resolve(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  // Serve vendor assets locally to avoid CDN issues
  const vendorMap = [
    { route: '/vendor/jquery.js', file: require.resolve('jquery/dist/jquery.min.js') },
    // ESM build for browser usage
    { route: '/vendor/chess-esm.js', file: require.resolve('chess.js/dist/esm/chess.js') },
    { route: '/vendor/chessboard.js', file: require.resolve('@chrisoakman/chessboardjs/dist/chessboard-1.0.0.min.js') },
    { route: '/vendor/chessboard.css', file: require.resolve('@chrisoakman/chessboardjs/dist/chessboard-1.0.0.min.css') },
  ];
  for (const v of vendorMap) {
    app.get(v.route, (req, res) => res.sendFile(v.file));
  }

  // Create a single engine instance for now
  console.log('[startup] Initializing UCI client...');
  const engine = new UciClient();
  try {
    await engine.init();
    console.log('[startup] UCI client ready.');
  } catch (e) {
    console.error('[startup] UCI client failed to init:', e && e.message ? e.message : e);
    // Continue without UCI fallback; primary engine is our worker-based search
  }
  const book = new OpeningBook();

  // ---------------- In-memory search cache and pondering ----------------
  // Cache key: fen4 (4-field FEN). Value: { bestmove, score, nodes, depth, bestLines, worstLines, ts }
  const searchCache = new Map();
  const CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS || 2 * 60 * 1000); // 2 minutes
  function now() { return Date.now(); }
  function toFen4(fen) { const p = fen.trim().split(/\s+/); return p.slice(0,4).join(' '); }
  function cacheGet(fen4) {
    const v = searchCache.get(fen4);
    if (!v) return null;
    if ((now() - v.ts) > CACHE_TTL_MS) { searchCache.delete(fen4); return null; }
    return v;
  }
  function cacheSet(fen4, payload) { searchCache.set(fen4, { ...payload, ts: now() }); }
  async function searchAndCache(fen4, depth, verbose) {
    const workerBudget = (process.env.SEARCH_WORKER_BUDGET_MS ? Number(process.env.SEARCH_WORKER_BUDGET_MS) : 0) || (8000 + depth * 700);
    const r = await searchParallel(fen4, depth, verbose, workerBudget);
    if (r && r.ok && r.best) {
      cacheSet(fen4, { bestmove: r.best, score: r.score, nodes: r.nodes, depth: r.depthReached || depth, bestLines: r.bestLines, worstLines: r.worstLines });
    }
    return r;
  }
  function listChildrenFen4(fen4) {
    const { Chess } = require('chess.js');
    const base = new Chess(ensureSix(fen4));
    const legal = base.moves({ verbose: true });
    const out = [];
    for (const m of legal) {
      const tmp = new Chess(ensureSix(fen4));
      const made = tmp.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
      if (!made) continue;
      const child = tmp.fen().split(' ').slice(0,4).join(' ');
      out.push({ uci: m.from + m.to + (m.promotion || ''), fen4: child });
    }
    return out;
  }

  app.post('/api/engine/new', async (req, res) => {
    try {
      if (engine && engine.newGame) await engine.newGame();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Health endpoint for quick liveness/readiness checks
  app.get('/health', (req, res) => {
    try {
      const ready = true;
      res.json({ ok: true, ready });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  function ensureSix(f4) {
    const parts = f4.trim().split(/\s+/);
    return parts.length >= 6 ? f4 : `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]} 0 1`;
  }

  // Enhanced evaluation: material + mobility + center + king safety (mirror of worker)
  function evaluateMaterial(fen4) {
    const { Chess } = require('chess.js');
    const F = ensureSix(fen4);
    const chessW = new Chess(F);
    const board = chessW.board();
    let white = 0, black = 0;
    const pieceVals = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
    function pawnValue(square, color) {
      const rank = parseInt(square.square[1], 10);
      let adv = 0;
      if (color === 'w') adv = Math.max(0, Math.min(5, rank - 2));
      else adv = Math.max(0, Math.min(5, 7 - rank));
      return 1 + (2 * adv) / 5; // 1..3
    }
    for (const row of board) for (const sq of row) if (sq) {
      const t = sq.type, c = sq.color;
      const v = t === 'p' ? pawnValue(sq, c) : (pieceVals[t] || 0);
      if (c === 'w') white += v; else black += v;
    }
    let score = white - black;

    function flipSide(f4) {
      const p = f4.split(/\s+/);
      return `${p[0]} ${p[1] === 'w' ? 'b' : 'w'} ${p[2]} -`;
    }
    const movesW = chessW.moves({ verbose: true }).length;
    const chessB = new Chess(ensureSix(flipSide(fen4)));
    const movesB = chessB.moves({ verbose: true }).length;
    score += (movesW - movesB) * 0.06;

    const centers = new Set(['d4','e4','d5','e5']);
    function countAttacks(chess) {
      let cnt = 0; const mv = chess.moves({ verbose: true });
      for (const m of mv) if (centers.has(m.to)) cnt++;
      return cnt;
    }
    function countOccupancy(color) {
      let cnt = 0; for (const row of board) for (const sq of row) if (sq && sq.color === color && centers.has(sq.square)) cnt++;
      return cnt;
    }
    score += (countAttacks(chessW) - countAttacks(chessB)) * 0.1;
    score += (countOccupancy('w') - countOccupancy('b')) * 0.15;

    const parts = fen4.split(/\s+/);
    const rights = parts[2] || '-';
    let wKing = null, bKing = null;
    for (const row of board) for (const sq of row) if (sq) {
      if (sq.type === 'k' && sq.color === 'w') wKing = sq.square;
      if (sq.type === 'k' && sq.color === 'b') bKing = sq.square;
    }
    if (wKing === 'e1' && !(rights.includes('K') || rights.includes('Q'))) score -= 0.3;
    if (bKing === 'e8' && !(rights.includes('k') || rights.includes('q'))) score += 0.3;
    function hasPiece(square, type, color) {
      for (const row of board) for (const sq of row) if (sq && sq.square === square && sq.type === type && sq.color === color) return true;
      return false;
    }
    if (!hasPiece('f2','p','w')) score -= 0.5;
    if (!hasPiece('g2','p','w')) score -= 0.3;
    if (!hasPiece('f7','p','b')) score += 0.5;
    if (!hasPiece('g7','p','b')) score += 0.3;

    if (chessW.isCheck()) score -= 0.2;
    if (chessB.isCheck()) score += 0.2;

    return Math.round(score * 100) / 100;
  }

  function listLegalChildren(fen4) {
    const { Chess } = require('chess.js');
    const base = new Chess(ensureSix(fen4));
    const legal = base.moves({ verbose: true });
    const children = [];
    for (const m of legal) {
      const tmp = new Chess(ensureSix(fen4));
      const made = tmp.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
      if (!made) continue;
      const childFen4 = tmp.fen().split(' ').slice(0, 4).join(' ');
      const uci = m.from + m.to + (m.promotion || '');
      // Pre-score to help ordering (material eval)
      const pre = evaluateMaterial(childFen4);
      const isCapture = !!(made.captured) || (made.flags && made.flags.includes('c'));
      children.push({ uci, fen4: childFen4, pre, isCapture });
    }
    // Order best-first to improve pruning behavior when we add alpha-beta (future)
    children.sort((a, b) => b.pre - a.pre);
    return children;
  }

  function negamax(fen4, depth, captureParity = 0) {
    const { Chess } = require('chess.js');
    const chess = new Chess(ensureSix(fen4));
    if (depth <= 0) {
      // Quiescence-like extension: if odd-length capture sequence, extend one more ply
      if (captureParity % 2 === 1) {
        depth = 1;
      } else {
        return { score: evaluateMaterial(fen4), best: null, explored: 1 };
      }
    }
    if (chess.isCheckmate()) return { score: -100000, best: null, explored: 1 };
    if (chess.isDraw()) return { score: 0, best: null, explored: 1 };

    const children = listLegalChildren(fen4);
    if (children.length === 0) return { score: evaluateMaterial(fen4), best: null, explored: 1 };
    let bestScore = -Infinity;
    let bestMove = null;
    let explored = 1;
    // Limit branching modestly for depth>2
    const maxBranch = depth > 2 ? 12 : 20;
    const slice = children.slice(0, maxBranch);
    for (const child of slice) {
      const r = negamax(child.fen4, depth - 1, child.isCapture ? (captureParity + 1) : 0);
      const s = -r.score;
      explored += r.explored;
      if (s > bestScore) {
        bestScore = s;
        bestMove = child.uci;
      }
    }
    return { score: bestScore, best: bestMove, explored };
  }

  // Worker-based parallel search (alpha-beta). Spins a pool sized to ~1.5x logical CPUs.
  const { Worker } = require('worker_threads');
  const os = require('os');
  const cpuCount = os.cpus().length;
  const workerCount = Math.max(2, Math.min(cpuCount * 3 >> 1, cpuCount * 2)); // ~1.5x, capped
  const workerPath = path.join(__dirname, 'engine', 'worker.js');
  const workers = [];
  let roundRobin = 0;
  // Shared hint table SAB (size power of two)
  const sharedSlots = 1 << 17; // 131072
  const sharedSAB = new SharedArrayBuffer(sharedSlots * 2 * 4); // 2 int32 per slot
  for (let i = 0; i < workerCount; i++) {
    workers.push(new Worker(workerPath, { workerData: { sharedSAB, sharedSLOTS: sharedSlots } }));
  }
  const pending = new Map();
  for (const w of workers) {
    w.on('message', (m) => {
      const cb = pending.get(m.id);
      if (cb) { pending.delete(m.id); cb(m); }
    });
  }
  // Session-wide stats accumulator
  const sessionStats = {
    searches: 0,
    totalNodes: 0,
    totalMs: 0,
    totalFh: 0,
    totalFl: 0,
    totalTtHits: 0,
    totalLmrReductions: 0,
    totalNullTries: 0,
    totalNullCutoffs: 0,
    recent: [] // last few searches
  };
  function recordSearchStats(r) {
    // r: payload from worker { nodes, ms, fhCount, flCount, ttHits, depthReached, score }
    sessionStats.searches += 1;
    sessionStats.totalNodes += (r.nodes || 0);
    sessionStats.totalMs += (r.ms || 0);
    sessionStats.totalFh += (r.fhCount || 0);
    sessionStats.totalFl += (r.flCount || 0);
    sessionStats.totalTtHits += (r.ttHits || 0);
    sessionStats.totalLmrReductions += (r.lmrReductions || 0);
    sessionStats.totalNullTries += (r.nullTries || 0);
    sessionStats.totalNullCutoffs += (r.nullCutoffs || 0);
    const ms = r.ms || 0;
    const nps = ms > 0 ? Math.round((r.nodes / ms) * 1000) : 0;
    const ttHitRate = (r.nodes > 0 && r.ttHits >= 0) ? +(r.ttHits / r.nodes * 100).toFixed(1) : null;
    const nullCutRate = (r.nullTries > 0) ? +(r.nullCutoffs / r.nullTries * 100).toFixed(1) : null;
    sessionStats.recent.unshift({
      depth: r.depthReached || null,
      nodes: r.nodes || 0,
      ms,
      nps,
      score: r.score,
      fh: r.fhCount || 0,
      fl: r.flCount || 0,
      ttHits: r.ttHits || 0,
      ttHitRate,
      lmrReductions: r.lmrReductions || 0,
      nullTries: r.nullTries || 0,
      nullCutoffs: r.nullCutoffs || 0,
      nullCutRate
    });
    if (sessionStats.recent.length > 3) sessionStats.recent.length = 3;
  }
  function makeSessionTotals() {
    const avgNps = sessionStats.totalMs > 0 ? Math.round((sessionStats.totalNodes / sessionStats.totalMs) * 1000) : 0;
    const ttHitRate = sessionStats.totalNodes > 0 ? +(sessionStats.totalTtHits / sessionStats.totalNodes * 100).toFixed(1) : null;
    return {
      searches: sessionStats.searches,
      nodes: sessionStats.totalNodes,
      ms: sessionStats.totalMs,
      avgNps,
      fh: sessionStats.totalFh,
      fl: sessionStats.totalFl,
      ttHits: sessionStats.totalTtHits,
      ttHitRate,
      lmrReductions: sessionStats.totalLmrReductions,
      nullTries: sessionStats.totalNullTries,
      nullCutoffs: sessionStats.totalNullCutoffs,
      nullCutRate: sessionStats.totalNullTries > 0 ? +(sessionStats.totalNullCutoffs / sessionStats.totalNullTries * 100).toFixed(1) : null
    };
  }
  let nextReqId = 1;
  function searchParallel(fen4, depth, verbose, maxTimeMs) {
    return new Promise((resolve) => {
      const id = nextReqId++;
      // Provide hintMove from cache bestmove if available
      const cached = searchCache.get(fen4);
      const hintMove = cached && cached.bestmove ? cached.bestmove : undefined;
      const payload = { type: 'search', id, fen4, depth, verbose: !!verbose, maxTimeMs, hintMove };
      const w = workers[roundRobin++ % workers.length];
      pending.set(id, resolve);
      w.postMessage(payload);
      // timeout safeguard
      const base = Number(process.env.SEARCH_TIMEOUT_BASE_MS || 10000);
      const per = Number(process.env.SEARCH_TIMEOUT_PER_DEPTH_MS || 3000);
      const timeoutMs = base + per * depth;
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve({ ok: false, error: 'timeout', timeoutMs });
        }
      }, timeoutMs);
    });
  }

  app.post('/api/engine/move', async (req, res) => {
    try {
      const { fen, mode, plies, verbose } = req.body || {};
      if (!fen) return res.status(400).json({ ok: false, error: 'missing fen' });
      const modeEff = typeof mode === 'string' ? mode : 'prefer-db';
      const depth = Math.max(1, Math.min(10, parseInt(plies || '2', 10)));
      const fen4 = toFen4(fen);
      // Serve from cache if available
      const cached = cacheGet(fen4);
      if (cached && cached.bestmove) {
        // If requested depth exceeds cached, refresh in background but return cached now
        if ((cached.depth || 0) < depth) searchAndCache(fen4, depth, !!verbose).catch(() => {});
        const payload = { ok: true, bestmove: cached.bestmove, source: 'cache', depth: cached.depth, score: cached.score, nodes: cached.nodes };
        if (verbose) payload.explanation = 'Answered from in-memory cache';
        if (cached.bestLines) payload.bestLines = cached.bestLines;
        if (cached.worstLines) payload.worstLines = cached.worstLines;
        return res.json(payload);
      }
      let bookCandidates = null;
      let dbHits = null;

      // prefer-db or db-only: try DB first; material search used only if no DB and no book (or engine-only)
      if (modeEff !== 'engine-only' && modeEff !== 'prefer-book' && modeEff !== 'book-only') {
        const { Chess } = require('chess.js');
        const base = new Chess(ensureSix(fen));
        const legal = base.moves({ verbose: true });
        const pool = [];
        for (const m of legal) {
          const tmp = new Chess(ensureSix(fen));
          const made = tmp.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
          if (!made) continue;
          const toFen4 = tmp.fen().split(' ').slice(0, 4).join(' ');
          if (book.existsFen(toFen4)) pool.push(m.from + m.to + (m.promotion || ''));
        }
        dbHits = pool.length;
        // Only pick a random DB move if depth == 1 (fast mode). For deeper search, fall through.
        if (pool.length > 0 && depth === 1) {
          const dbPick = pool[Math.floor(Math.random() * pool.length)];
          return res.json({ ok: true, bestmove: dbPick, source: 'db', dbHits, depth: 1, explanation: verbose ? 'Random DB move chosen at depth=1 (fast path), no search lines.' : undefined });
        }
        // if db-only, fall through to try book then engine for better UX
      }

      if (modeEff !== 'engine-only') {
        // Try opening book next
        const cands = book.getCandidatesForFen(fen) || [];
        bookCandidates = cands.length;
        const pickMode = process.env.BOOK_MODE === 'popular' ? 'popular' : 'weighted';
        if (cands.length > 0) {
          const uci = book.pickMoveForFen(fen, pickMode);
          if (uci) return res.json({ ok: true, bestmove: uci, source: 'book', bookCandidates, explanation: verbose ? 'Book move selected; engine search skipped.' : undefined });
        }
      }

      // No DB and no Book or engine-only: run parallel alpha-beta search for deeper plies, fallback to local negamax
      if (depth > 0) {
        if (depth > 3) {
          // Provide worker its own time budget slightly below external timeout
          const workerBudget = (process.env.SEARCH_WORKER_BUDGET_MS ? Number(process.env.SEARCH_WORKER_BUDGET_MS) : 0) || (8000 + depth * 700);
          const r = await searchParallel(fen, depth, verbose, workerBudget);
          if (r.ok && r.best) {
            if (verbose) console.log(`Search iter depthReached=${r.depthReached||'?'} target=${depth} nodes=${r.nodes} score=${r.score}`);
            // store in cache
            cacheSet(fen4, { bestmove: r.best, score: r.score, nodes: r.nodes, depth: r.depthReached || depth, bestLines: r.bestLines, worstLines: r.worstLines });
            // record session-wide stats
            recordSearchStats(r);
            const ms = r.ms || 0;
            const nps = ms > 0 ? Math.round((r.nodes / ms) * 1000) : undefined;
            const ttHitRate = (r.nodes > 0 && r.ttHits >= 0) ? +(r.ttHits / r.nodes * 100).toFixed(1) : null;
            const payload = {
              ok: true,
              bestmove: r.best,
              source: 'engine-parallel',
              depth: r.depthReached || depth,
              requestedDepth: depth,
              score: r.score,
              nodes: r.nodes,
              workers: workerCount,
              ms,
              nps,
              fhCount: r.fhCount,
              flCount: r.flCount,
              ttHits: r.ttHits,
              ttHitRate,
              lmrReductions: r.lmrReductions,
              nullTries: r.nullTries,
              nullCutoffs: r.nullCutoffs,
              nullCutRate: (r.nullTries > 0) ? +(r.nullCutoffs / r.nullTries * 100).toFixed(1) : null,
              sessionTotals: makeSessionTotals(),
              recentSearches: sessionStats.recent
            };
            if (r.bestLines) payload.bestLines = r.bestLines;
            if (r.worstLines) payload.worstLines = r.worstLines;
            if (r.depthReached && r.depthReached < depth) payload.explanation = verbose ? `Iterative deepening stopped early at depth ${r.depthReached}` : undefined;
            return res.json(payload);
          }
          if (verbose && r && r.error === 'timeout') {
            console.log(`Search timeout after ${r.timeoutMs}ms at depth=${depth}; falling back to shallow search.`);
          }
        }
        const r = negamax(fen, Math.min(depth, 3));
        if (r.best) {
          cacheSet(fen4, { bestmove: r.best, score: r.score, nodes: r.explored, depth: Math.min(depth, 3) });
          return res.json({ ok: true, bestmove: r.best, source: 'engine-search', depth: Math.min(depth, 3), requestedDepth: depth, score: r.score, nodes: r.explored, explanation: verbose ? 'Depth limited fallback search (<=3) used; multi-PV not generated.' : undefined, ms: null, nps: null, fhCount: null, flCount: null, ttHits: null, ttHitRate: null, sessionTotals: makeSessionTotals(), recentSearches: sessionStats.recent });
        }
      }
      // Fallback to engine
      await engine.setPositionFen(fen);
      const bestmove = await engine.go();
      res.json({ ok: true, bestmove, source: 'engine', bookCandidates, dbHits, ms: null, nps: null, fhCount: null, flCount: null, ttHits: null, ttHitRate: null, sessionTotals: makeSessionTotals(), recentSearches: sessionStats.recent });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Reset accumulated session search statistics
  app.post('/api/stats/reset', (req, res) => {
    try {
      sessionStats.searches = 0;
      sessionStats.totalNodes = 0;
      sessionStats.totalMs = 0;
      sessionStats.totalFh = 0;
      sessionStats.totalFl = 0;
      sessionStats.totalTtHits = 0;
      sessionStats.totalLmrReductions = 0;
      sessionStats.totalNullTries = 0;
      sessionStats.totalNullCutoffs = 0;
      sessionStats.recent = [];
      // Clear in-memory search cache as well
      searchCache.clear();
      res.json({ ok: true, reset: true, sessionTotals: makeSessionTotals() });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Ponder endpoint: when it's the human's turn at fen, pre-search all child positions (after human moves)
  app.post('/api/engine/ponder', async (req, res) => {
    try {
      const { fen, plies, verbose } = req.body || {};
      if (!fen) return res.status(400).json({ ok: false, error: 'missing fen' });
      const depth = Math.max(1, Math.min(10, parseInt(plies || '2', 10)));
      const f4 = toFen4(fen);
      const children = listChildrenFen4(f4);
      // Fire-and-forget searches in parallel (bounded by worker pool naturally)
      for (const ch of children) {
        // skip if cached fresh and depth sufficient
        const c = cacheGet(ch.fen4);
        if (c && (c.depth || 0) >= depth) continue;
        searchAndCache(ch.fen4, depth, !!verbose).catch(() => {});
      }
      res.json({ ok: true, queued: children.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Lichess downloader UI
  app.get('/lichess', (req, res) => {
    res.sendFile(path.resolve(publicDir, 'lichess.html'));
  });

  app.post('/api/lichess/download', async (req, res) => {
    try {
      const { token, username, max, rated, perfType, minRating } = req.body || {};
      const tok = token && token.trim() ? token.trim() : getLichessToken();
      if (!tok) return res.status(400).json({ ok: false, error: 'Missing token: provide in body or API_KEYS/Lichess/API_token.json' });
      if (!username) return res.status(400).json({ ok: false, error: 'username is required' });
      const result = await downloadAndIndex({ token: tok, username, max, rated, perfType, minRating });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  const server = app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });

  // Book/DB helper endpoints
  app.get('/api/book/position', (req, res) => {
    try {
      const fen = (req.query.fen || '').toString();
      if (!fen) return res.status(400).json({ ok: false, error: 'missing fen' });
      const exists = book.existsFen(fen);
      res.json({ ok: true, exists });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  app.post('/api/book/positions/exist', (req, res) => {
    try {
      const { fens } = req.body || {};
      if (!Array.isArray(fens)) return res.status(400).json({ ok: false, error: 'fens[] required' });
      const exists = {};
      for (const f of fens) {
        if (!f || typeof f !== 'string') continue;
        exists[f] = book.existsFen(f);
      }
      res.json({ ok: true, exists });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  app.get('/api/book/countermoves', (req, res) => {
    try {
      const fen = (req.query.fen || '').toString();
      if (!fen) return res.status(400).json({ ok: false, error: 'missing fen' });
      const candidates = book.getCandidatesForFen(fen);
      // Sort by count desc for readability
      candidates.sort((a, b) => (b.count || 0) - (a.count || 0));
      res.json({ ok: true, candidates });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await engine.quit();
    for (const w of workers) w.terminate();
    server.close(() => process.exit(0));
  });
}

main().catch((e) => {
  console.error('Failed to start server:', e);
  process.exit(1);
});
