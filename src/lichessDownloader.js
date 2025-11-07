// lichessDownloader.js
// Download games from Lichess (requires personal API token), cache PGNs, and index positions.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { encodePosition128 } = require('./position128');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function hashCriteria(obj) {
  const s = JSON.stringify(obj);
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
}

function hashFen(fen) {
  // stable key for dedup across runs
  return crypto.createHash('sha1').update(fen).digest('hex');
}

function toFourFieldFEN(fullFen) {
  const parts = fullFen.trim().split(/\s+/);
  return parts.slice(0, 4).join(' ');
}

function parseHeaders(pgn) {
  // Parse bracketed PGN headers at the start of the game
  // Example: [Variant "Standard"]\n[SetUp "1"]\n[FEN "rnbqkbnr/..."]
  const headers = {};
  const lines = pgn.split(/\r?\n/);
  for (const line of lines) {
    const s = line.trim();
    if (s === '') break; // blank line ends header section
    if (!s.startsWith('[')) continue;
    const m = s.match(/^\[(\w+)\s+"([^"]*)"\]$/);
    if (m) {
      headers[m[1]] = m[2];
    }
  }
  return headers;
}

function stripHeaders(pgn) {
  // Remove lines that look like [Tag "Value"] and return the remaining PGN body (moves, comments, result)
  return pgn
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[/.test(line))
    .join('\n')
    .trim();
}

function manualExtractFensFromMoves(pgnBody) {
  const { Chess } = require('chess.js');
  // Remove comments {...}, line comments starting with ;, NAGs $.., and simple () variations
  let t = pgnBody
    .replace(/\{[^}]*\}/g, ' ') // {...}
    .replace(/;[^\n]*/g, ' ') // ; to EOL
    .replace(/\([^)]*\)/g, ' ') // ( ... ) variations
    .replace(/\$\d+/g, ' ') // $1, $2
    .replace(/\r?\n/g, ' ');
  // Remove move numbers like 1. or 23... and results
  t = t.replace(/\d+\.\.\.|\d+\./g, ' ');
  t = t.replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, ' ');
  const tokens = t.split(/\s+/).filter(Boolean);
  const ref = new Chess();
  const fens = new Set();
  fens.add(toFourFieldFEN(ref.fen()));
  for (const san of tokens) {
    const mv = ref.move(san);
    if (!mv) {
      // Give up on manual if we encounter an illegal SAN
      return [];
    }
    fens.add(toFourFieldFEN(ref.fen()));
  }
  return Array.from(fens);
}

async function fetchPGNFromLichess({ token, username, max = 100, rated = true, perfType, minRating, variant = 'standard' }) {
  if (!token) throw new Error('Missing Lichess API token');
  if (!username) throw new Error('username is required for this initial implementation');
  const url = new URL(`https://lichess.org/api/games/user/${encodeURIComponent(username)}`);
  // Parameters per Lichess API
  url.searchParams.set('max', String(max));
  url.searchParams.set('moves', 'true');
  url.searchParams.set('pgnInJson', 'false');
  url.searchParams.set('clocks', 'false');
  url.searchParams.set('evals', 'false');
  url.searchParams.set('analysed', 'false');
  if (rated !== undefined) url.searchParams.set('rated', rated ? 'true' : 'false');
  if (perfType) url.searchParams.set('perfType', perfType); // blitz, rapid, classical, etc.
  if (minRating) url.searchParams.set('minRating', String(minRating));
  if (variant) url.searchParams.set('variant', variant); // enforce standard by default

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/x-chess-pgn',
    },
  });
  if (!res.ok) throw new Error(`Lichess fetch failed: ${res.status} ${res.statusText}`);
  return await res.text();
}

function splitPGNGames(pgnAll) {
  // Split by lines that start a new game header block
  const parts = pgnAll.split(/\n\s*\n(?=\[Event\s)/g);
  return parts.map(s => s.trim()).filter(Boolean);
}

function* iteratePositionsFromPGN(pgn, stats) {
  // Unused by the pipeline at the moment; keep a defensive iterator if needed later
  const { Chess } = require('chess.js');
  const hdr = parseHeaders(pgn);
  // Strict filter: only Variant "Standard"
  if (hdr && hdr.Variant && String(hdr.Variant).toLowerCase() !== 'standard') {
    if (stats) stats.variantSkip++;
    return;
  }
  // If FEN header provided, it must equal initial position
  if (hdr && hdr.FEN) {
    const initial = new Chess();
    const initialFour = toFourFieldFEN(initial.fen());
    const fenFour = toFourFieldFEN(String(hdr.FEN));
    if (fenFour !== initialFour) {
      if (stats) stats.nonInitialFENSkip++;
      return;
    }
  }
  const game = new Chess();
  try {
    let ok = game.loadPgn(pgn, { sloppy: true });
    if (!ok) {
      // Fallback: try parsing only the moves section without headers
      const body = stripHeaders(pgn);
      ok = game.loadPgn(body, { sloppy: true });
      if (!ok) {
        // Last resort: manual SAN extraction
        const fens = manualExtractFensFromMoves(body);
        if (fens.length === 0) {
          if (stats) stats.parseFail++;
          return;
        }
        // Yield from manual path
        for (const fen of fens) yield fen;
        return;
      }
    }
  } catch (_e) {
    // Some PGNs (variants/buggy) can throw from chess.js parser; try manual path
    const body = stripHeaders(pgn);
    const fens = manualExtractFensFromMoves(body);
    if (fens.length === 0) {
      if (stats) stats.parseFail++;
      return;
    }
    for (const fen of fens) yield fen;
    return;
  }
  const startFen = hdr && hdr.SetUp === '1' && hdr.FEN ? hdr.FEN : undefined;
  const replay = new Chess(startFen);

  // Start position
  yield toFourFieldFEN(replay.fen());
  // Replay and yield each position
  const moves = game.history({ verbose: true });
  if (!moves || moves.length === 0) {
    if (stats) stats.emptyMoves++;
  }
  for (const m of moves) {
    const mv = replay.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    if (!mv) {
      if (stats) stats.illegalReplay++;
      break; // stop if something doesn't apply cleanly under start FEN
    }
    yield toFourFieldFEN(replay.fen());
  }
}

function collectPositionsFromPGN(pgn, stats) {
  const { Chess } = require('chess.js');
  const hdr = parseHeaders(pgn);
  // Strict filter: only Variant "Standard"
  if (hdr && hdr.Variant && String(hdr.Variant).toLowerCase() !== 'standard') {
    if (stats) stats.variantSkip++;
    return [];
  }
  // If FEN header provided, it must equal initial position
  if (hdr && hdr.FEN) {
    const initial = new Chess();
    const initialFour = toFourFieldFEN(initial.fen());
    const fenFour = toFourFieldFEN(String(hdr.FEN));
    if (fenFour !== initialFour) {
      if (stats) stats.nonInitialFENSkip++;
      return [];
    }
  }
  const game = new Chess();
  try {
    let ok = game.loadPgn(pgn, { sloppy: true });
    if (!ok) {
      const body = stripHeaders(pgn);
      ok = game.loadPgn(body, { sloppy: true });
      if (!ok) {
        const fensManual = manualExtractFensFromMoves(body);
        if (fensManual.length === 0) {
          if (stats) stats.parseFail++;
          return [];
        }
        return fensManual;
      }
    }
  } catch (_e) {
    const body = stripHeaders(pgn);
    const fensManual = manualExtractFensFromMoves(body);
    if (fensManual.length === 0) {
      if (stats) stats.parseFail++;
      return [];
    }
    return fensManual;
  }
  // Determine start position: FEN header is used when SetUp==1; otherwise standard start
  const startFen = hdr && hdr.SetUp === '1' && hdr.FEN ? hdr.FEN : undefined;
  const replay = new Chess(startFen);

  const fens = new Set();
  // Start from initial
  fens.add(toFourFieldFEN(replay.fen()));
  // Replay moves capturing positions after each ply
  const moves = game.history({ verbose: true });
  if (!moves || moves.length === 0) {
    if (stats) stats.emptyMoves++;
  }
  for (const m of moves) {
    const mv = replay.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    if (!mv) {
      // If a move can't be applied under this start position, bail on this game
      if (stats) stats.illegalReplay++;
      break;
    }
    fens.add(toFourFieldFEN(replay.fen()));
  }
  return Array.from(fens);
}

async function downloadAndIndex({ token, username, max, rated, perfType, minRating, variant = 'standard' }) {
  const criteria = { username, max, rated, perfType, minRating };
  const id = hashCriteria(criteria);
  const cacheDir = path.resolve(__dirname, '..', 'cache', 'lichess', id);
  const dataDir = path.resolve(__dirname, '..', 'data', 'game_positions');
  ensureDir(cacheDir);
  ensureDir(dataDir);
  const pgnPath = path.join(cacheDir, 'games.pgn');

  // Fetch PGN
  const pgn = await fetchPGNFromLichess({ token, username, max, rated, perfType, minRating, variant });
  fs.writeFileSync(pgnPath, pgn, 'utf8');

  // Parse and index
  const games = splitPGNGames(pgn);
  const seen = new Set(); // per-run de-dup by FEN
  const outPath = path.join(dataDir, `${id}.jsonl`);
  const out = fs.createWriteStream(outPath, { flags: 'w' });
  let posCount = 0;

  // Global incremental DB and index
  const globalDBPath = path.join(dataDir, 'global.jsonl');
  const globalIndexPath = path.join(dataDir, 'global.index'); // one sha1 per line
  ensureDir(dataDir);
  let globalKeys = new Set();
  if (fs.existsSync(globalIndexPath)) {
    const lines = fs.readFileSync(globalIndexPath, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const l of lines) globalKeys.add(l.trim());
  }
  const globalOut = fs.createWriteStream(globalDBPath, { flags: 'a' });
  const globalIndexOut = fs.createWriteStream(globalIndexPath, { flags: 'a' });
  let globalAdded = 0;
  const stats = { variantSkip: 0, parseFail: 0, emptyMoves: 0, illegalReplay: 0, nonInitialFENSkip: 0 };
  for (const g of games) {
    const fens = collectPositionsFromPGN(g, stats);
    for (const fen of fens) {
      if (seen.has(fen)) continue;
      seen.add(fen);
      const enc = encodePosition128(fen);
      // Store BigInts as hex strings to avoid JSON BigInt issues
      const rec = {
        hi: '0x' + enc.hi.toString(16),
        lo: '0x' + enc.lo.toString(16),
        fen: enc.fen,
        method: enc.method,
      };
      out.write(JSON.stringify(rec) + '\n');
      posCount++;

      // Incremental global append if new
      const key = hashFen(enc.fen);
      if (!globalKeys.has(key)) {
        globalKeys.add(key);
        globalOut.write(JSON.stringify(rec) + '\n');
        globalIndexOut.write(key + '\n');
        globalAdded++;
      }
    }
  }
  out.end();
  globalOut.end();
  globalIndexOut.end();

  return {
    ok: true,
    cacheId: id,
    pgnPath,
    outPath,
    games: games.length,
    positions: posCount,
    globalAdded,
    stats,
  };
}

function extractPositionsFromPGN(pgn) {
  const stats = { variantSkip: 0, parseFail: 0, emptyMoves: 0, illegalReplay: 0, nonInitialFENSkip: 0 };
  const fens = collectPositionsFromPGN(pgn, stats);
  return { fens, stats };
}

module.exports = { downloadAndIndex, extractPositionsFromPGN };
