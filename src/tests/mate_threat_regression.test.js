'use strict';
const path = require('path');
const { Worker } = require('worker_threads');

jest.setTimeout(25000);

function spawnWorker(extraEnv={}) {
  const workerPath = path.join(__dirname, '..', 'engine', 'worker.js');
  return new Worker(workerPath, { workerData: { timestamp: 0, flip: 1, ...extraEnv } });
}

function search(worker, fen4, depth=3, verbose=false, maxTimeMs=1200) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random()*1e9);
    const handler = (m) => { if (m.id === id) { worker.off('message', handler); resolve(m); } };
    worker.on('message', handler);
  worker.postMessage({ type:'search', id, fen4, depth, verbose, maxTimeMs });
  });
}

// Game sequence provided by user:
// 1. e4 g5 2. d4 h6 3. Nc3 b6 4. Nf3 c6 5. Bc4 g4 6. Ne5 Ba6 7. Bxf7#
// We test the position BEFORE Black's 6th move (Ba6) and expect any move
// that allows immediate Bxf7# to have a severe negative (losing for Black) white-centric score
// much worse than a small -1.xx. After playing Ba6 the move Bxf7# is mate.
// FEN after 6.Ne5 (before black replies): pieces/side/castling/ep
// Construct with chess.js to ensure correctness rather than manual string.
const Chess = require('chess.js').Chess;
function buildFen(sequence) {
  const c = new Chess();
  for (const mv of sequence) c.move(mv);
  const parts = c.fen().split(' ').slice(0,4); // piece side castle ep
  return parts.join(' ');
}
// Moves up to 6.Ne5 (white's move) so black to move now:
const movesBeforeBa6 = ['e4','g5','d4','h6','Nc3','b6','Nf3','c6','Bc4','g4','Ne5'];
const fenBeforeBa6 = buildFen(movesBeforeBa6);
// After Ba6 and Bxf7# white mates:
const movesWithBa6 = [...movesBeforeBa6, 'Ba6'];
const fenAfterBa6 = buildFen(movesWithBa6); // black has just played Ba6; white to move with Bxf7# available

// Acceptance criteria / expectations:
// 1. Searching fenBeforeBa6 at modest depth should NOT pick Ba6 with only ~-1.6 evaluation;
//    if Ba6 leads to forced mate next ply, score should reflect imminent mate (large magnitude).
// 2. Searching fenAfterBa6 should produce a root score indicating winning for White (positive large)
//    and Bxf7# should appear as top line.
// These tests intentionally fail now if scores are not extreme.

// Helper to find SAN in best lines array
function hasSANLine(result, sanPrefix) {
  if (!result.bestLines) return false;
  return result.bestLines.some(l => typeof l.line === 'string' && l.line.startsWith(sanPrefix));
}

describe('Mate threat regression for Ba6 allowing immediate Bxf7#', () => {
  let worker;
  beforeAll(() => {
    // emulate GUI randomness/timing constraints seen by user
    process.env.ENABLE_MOVE_RANDOMNESS = '0';
    process.env.ROOT_RANDOM_MARGIN = '0.2';
    worker = spawnWorker();
  });
  afterAll(() => { worker.terminate(); });

  test('Ba6 should not have only small negative score when it allows immediate mate', async () => {
  const r = await search(worker, fenBeforeBa6, 3, true, 1200);
    expect(r.ok).toBe(true);
    // Find Ba6 line score if present in scored list
    const ba6Entry = r.scored && r.scored.find(m => m.san === 'Ba6');
    // Must be present (engine considered it at root)
    expect(ba6Entry).toBeTruthy();
    // If Bxf7# is immediate mate after Ba6, evaluation from white perspective should be large positive (bad for black) => Ba6 should have large positive white-centric score.
    // We demand at least +50 (arbitrary high threshold) or mate distance encoding (>= 100000 - something) which would appear as huge number.
    const s = ba6Entry.score;
    const largeMateThreshold = 50; // pawns
    const isLarge = s >= largeMateThreshold || Math.abs(s) > 50000;
    expect(isLarge).toBe(true); // Expected to FAIL currently
  });

  test('After Ba6 the best line should start with Bxf7# and score be extreme for White', async () => {
  const r = await search(worker, fenAfterBa6, 3, true, 1200);
    expect(r.ok).toBe(true);
    // Require Bxf7# to be top PV line
    const hasMate = hasSANLine(r, 'Bxf7#');
    expect(hasMate).toBe(true); // may fail if mate not detected
    // Score should be extreme positive (mate for White). Accept > +50 or encoded mate.
    const extreme = r.score >= 50 || Math.abs(r.score) > 50000;
    expect(extreme).toBe(true); // Expected to FAIL currently
  });
});
