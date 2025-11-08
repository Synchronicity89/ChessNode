'use strict';
// generate_format1.js
// Enumerate reachable legal chess positions starting from the initial position
// expanding all legal moves breadth-first (or iterative deepening) until either:
// - 5,000,000,000 unique positions reached (cap)
// - Exhaustion (not realistically reachable)
// Stores each unique canonical 4-field FEN in Format1Store (disk + RAM) with crash safety.
// NOTE: 5B positions is huge; this script is structured to allow early termination and resume.
// WARNING: Full enumeration of all legal chess positions >> 10^44; we only enumerate reachable
// positions along move sequences, but branching will explode rapidly. Use depth limit heuristics.

// Strategy:
// - Use incremental depth search with pruning of repetitions (threefold detection minimal) and
//   ignoring positions after basic end conditions.
// - Because exhaustive expansion to billions is impractical in one run, we implement checkpoint
//   depth boundaries and allow manual abort.
// - For this prototype, we cap depth at 6 plies by default unless user sets MAX_DEPTH env.
// - Unique counting uses Format1Store's sha1 dedup.

const { Format1Store } = require('./format1Store');
const pos64 = require('./position64');
let Chess;
try { Chess = require('chess.js').Chess; } catch (e) { console.error('chess.js required'); process.exit(1); }
const path = require('path');

const TARGET = 5_000_000_000; // 5B cap
// Default depth reduced to 4 to avoid runaway explosion; override with MAX_DEPTH env
const MAX_DEPTH = parseInt(process.env.MAX_DEPTH || '4', 10); // safety
const SAVE_INTERVAL = 100_000; // progress save every N new positions
const LOG_INTERVAL = 10_000; // log counters

const storeDir = path.join(__dirname, '..', 'data', 'format1');
const store = new Format1Store(storeDir);

let totalUnique = store.nextIndex - 1; // existing positions on resume
let started = Date.now();
let lastLog = Date.now();
let aborted = false;

process.on('SIGINT', () => {
  console.log('\nCaught SIGINT, saving progress...');
  store.saveProgress();
  aborted = true;
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  store.saveProgress();
  process.exit(1);
});

function ensureSix(fen4) {
  const p = fen4.trim().split(/\s+/);
  if (p.length === 4) return fen4 + ' 0 1';
  return fen4;
}

function canonical4(fen) { return pos64.canonicalizeFEN(fen); }

function expandFrom(fen4) {
  const game = new Chess(ensureSix(fen4));
  if (game.isGameOver()) return []; // no further expansion
  const moves = game.moves({ verbose: true });
  const out = [];
  for (const m of moves) {
    const g2 = new Chess(ensureSix(fen4));
    const made = g2.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    if (!made) continue;
    const nextFen4 = g2.fen().split(' ').slice(0, 4).join(' ');
    out.push(nextFen4);
  }
  return out;
}

// BFS/Layer expansion with depth cap
function runEnumeration() {
  const startFen4 = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
  // Seed start position
  const seed = store.addFen(startFen4);
  if (seed.isNew) totalUnique++;
  let frontier = [startFen4];
  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    if (aborted) break;
    console.log(`Expanding depth ${depth}, frontier size=${frontier.length}`);
  const nextSet = new Set();
    for (let i = 0; i < frontier.length; i++) {
      if (aborted) break;
      const fen4 = frontier[i];
      const children = expandFrom(fen4);
      for (const child of children) {
        const can = canonical4(child);
        if (!nextSet.has(can)) {
          const added = store.addFen(can);
          if (added.isNew) {
            totalUnique++;
            if (totalUnique % SAVE_INTERVAL === 0) store.saveProgress();
          }
          nextSet.add(can);
        }
        if (totalUnique >= TARGET) { console.log('Reached target cap.'); aborted = true; break; }
      }
      if ((i + 1) % LOG_INTERVAL === 0) {
        const now = Date.now();
        const dt = (now - lastLog) / 1000;
        lastLog = now;
        console.log(`  processed=${i + 1}/${frontier.length} unique=${totalUnique} rate=${(LOG_INTERVAL / dt).toFixed(1)}/s`);
      }
      if (aborted) break;
    }
  frontier = Array.from(nextSet);
    store.saveProgress();
    console.log(`Depth ${depth} complete. Unique so far=${totalUnique}`);
    if (aborted) break;
  }
  store.saveProgress();
  const elapsed = (Date.now() - started) / 1000;
  console.log(`Enumeration finished. unique=${totalUnique} elapsed=${elapsed.toFixed(1)}s`);
}

if (require.main === module) {
  runEnumeration();
}
