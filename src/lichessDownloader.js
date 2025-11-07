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

async function fetchPGNFromLichess({ token, username, max = 100, rated = true, perfType, minRating }) {
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

function* iteratePositionsFromPGN(pgn) {
  // Unused by the pipeline at the moment; keep a defensive iterator if needed later
  const { Chess } = require('chess.js');
  const game = new Chess();
  try {
    const ok = game.loadPgn(pgn, { sloppy: true });
    if (!ok) return; // skip malformed
  } catch (_e) {
    // Some PGNs (variants/buggy) can throw from chess.js parser; skip
    return;
  }
  const headers = typeof game.header === 'function' ? game.header() : {};
  if (headers && headers.Variant && headers.Variant.toLowerCase() !== 'standard') return; // skip non-standard variants
  const startFen = headers && headers.SetUp === '1' && headers.FEN ? headers.FEN : undefined;
  const replay = new Chess(startFen);

  // Start position
  yield toFourFieldFEN(replay.fen());
  // Replay and yield each position
  const moves = game.history({ verbose: true });
  for (const m of moves) {
    const mv = replay.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    if (!mv) break; // stop if something doesn't apply cleanly under start FEN
    yield toFourFieldFEN(replay.fen());
  }
}

function collectPositionsFromPGN(pgn) {
  const { Chess } = require('chess.js');
  const game = new Chess();
  try {
    const ok = game.loadPgn(pgn, { sloppy: true });
    if (!ok) return [];
  } catch (_e) {
    // Parser rejected this PGN (often due to variant or malformed SAN); skip this game
    return [];
  }
  const headers = typeof game.header === 'function' ? game.header() : {};
  // Skip non-standard variants (e.g., Chess960, Crazyhouse) — chess.js standard parser can't always handle them
  if (headers && headers.Variant && headers.Variant.toLowerCase() !== 'standard') return [];

  // Determine start position: FEN header is used when SetUp==1; otherwise standard start
  const startFen = headers && headers.SetUp === '1' && headers.FEN ? headers.FEN : undefined;
  const replay = new Chess(startFen);

  const fens = new Set();
  // Start from initial
  fens.add(toFourFieldFEN(replay.fen()));
  // Replay moves capturing positions after each ply
  const moves = game.history({ verbose: true });
  for (const m of moves) {
    const mv = replay.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    if (!mv) {
      // If a move can't be applied under this start position, bail on this game
      break;
    }
    fens.add(toFourFieldFEN(replay.fen()));
  }
  return Array.from(fens);
}

async function downloadAndIndex({ token, username, max, rated, perfType, minRating }) {
  const criteria = { username, max, rated, perfType, minRating };
  const id = hashCriteria(criteria);
  const cacheDir = path.resolve(__dirname, '..', 'cache', 'lichess', id);
  const dataDir = path.resolve(__dirname, '..', 'data', 'game_positions');
  ensureDir(cacheDir);
  ensureDir(dataDir);
  const pgnPath = path.join(cacheDir, 'games.pgn');

  // Fetch PGN
  const pgn = await fetchPGNFromLichess({ token, username, max, rated, perfType, minRating });
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
  for (const g of games) {
    const fens = collectPositionsFromPGN(g);
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
  };
}

module.exports = { downloadAndIndex };
