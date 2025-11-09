'use strict';
const path = require('path');
const { Worker } = require('worker_threads');
const { Chess } = require('chess.js');

jest.setTimeout(25000);

function spawnWorker(extraEnv={}) {
  const workerPath = path.join(__dirname, '..', 'engine', 'worker.js');
  return new Worker(workerPath, { workerData: { timestamp: 0, flip: 1, ...extraEnv } });
}

function search(worker, fen4, depth=3, verbose=false, maxTimeMs=1500) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random()*1e9);
    const handler = (m) => { if (m.id === id) { worker.off('message', handler); resolve(m); } };
    worker.on('message', handler);
    worker.postMessage({ type:'search', id, fen4, depth, verbose, maxTimeMs });
  });
}

function fenAfterMoves(movesSAN) {
  const c = new Chess();
  for (const m of movesSAN) {
    const ok = c.move(m);
    if (!ok) throw new Error('Bad SAN in test sequence: '+m);
  }
  return c.fen().split(' ').slice(0,4).join(' ');
}

// PGN:
// 1. e4 c5 2. d4 e5 3. d5 g5 4. Nf3 g4 5. Nxe5 h5 6. h3 gxh3 7. Qf3 hxg2 8. Qxf7#
// We'll create two critical positions:
// A) Before 7...hxg2 (after 7.Qf3) so Black to move; if hxg2 allows immediate Qxf7# next, it must evaluate as extreme losing for Black.
// B) After 7...hxg2, White to move; engine should show Qxf7# as the top line and extreme winning score for White.

const movesToQf3 = ['e4','c5','d4','e5','d5','g5','Nf3','g4','Nxe5','h5','h3','gxh3','Qf3'];
const fenBeforeHxg2 = fenAfterMoves(movesToQf3); // Black to move
const fenAfterHxg2 = fenAfterMoves([...movesToQf3, 'hxg2']); // White to move

function hasSANLine(result, sanPrefix) {
  if (!result.bestLines) return false;
  return result.bestLines.some(l => typeof l.line === 'string' && l.line.startsWith(sanPrefix));
}

describe('Mate threat regression for hxg2 allowing immediate Qxf7#', () => {
  let worker;
  beforeAll(() => {
    process.env.ENABLE_MOVE_RANDOMNESS = '0';
    process.env.ROOT_RANDOM_MARGIN = '0.2';
    worker = spawnWorker();
  });
  afterAll(() => { worker.terminate(); });

  test('hxg2 should not have only small negative score when it allows immediate mate', async () => {
    const r = await search(worker, fenBeforeHxg2, 3, true, 1500);
    expect(r.ok).toBe(true);
    const entry = r.scored && r.scored.find(m => m.san === 'hxg2');
    expect(entry).toBeTruthy();
    const s = entry.score; // white-centric
    const large = s >= 50 || Math.abs(s) > 50000;
    // Expect FAIL if engine undervalues the mate threat
    expect(large).toBe(true);
  });

  test('After hxg2 the best line should start with Qxf7# and score be extreme for White', async () => {
    const r = await search(worker, fenAfterHxg2, 3, true, 1500);
    expect(r.ok).toBe(true);
    const hasMate = hasSANLine(r, 'Qxf7#');
    expect(hasMate).toBe(true);
    const extreme = r.score >= 50 || Math.abs(r.score) > 50000;
    expect(extreme).toBe(true);
  });
});
