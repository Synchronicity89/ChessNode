// mate_detection.test.js
// Focused tests asserting the engine recognizes imminent mates within small depth.
// These tests spin up the worker-thread engine and query it for specific positions.

const { Worker } = require('worker_threads');
const path = require('path');

// Extend timeout for deeper search on CI/low-power machines
jest.setTimeout(20000);

// Positions near mate or decisive tactics.
// Format: { fen4, expectMove? }
const cases = [
  // Scholar mate pattern: After 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? allowing Qxf7#
  { fen4: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq -', expectMove: 'h5f7' },
  // Back-rank mate: White to play Qe8#
  { fen4: '4r1k1/pp3ppp/8/8/8/8/PP3PPP/4R1K1 w - -', expectMove: 'e1e8' },
];

function spawnWorker() {
  const workerPath = path.join(__dirname, '..', 'engine', 'worker.js');
  return new Worker(workerPath, { workerData: { sharedSAB: new SharedArrayBuffer(2 * 4 * (1<<10)), sharedSLOTS: (1<<10) } });
}

function searchPosition(worker, fen4, depth) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9);
    const handler = (m) => {
      if (m.id === id) {
        worker.off('message', handler);
        resolve(m);
      }
    };
    worker.on('message', handler);
    worker.postMessage({ type: 'search', id, fen4, depth, verbose: false, maxTimeMs: 4000 });
  });
}

describe('Mate/decisive detection', () => {
  let worker;
  beforeAll(() => { worker = spawnWorker(); });
  afterAll(() => { worker.terminate(); });

  test.each(cases)('strong line found for %p', async ({ fen4, expectMove }) => {
    const r = await searchPosition(worker, fen4, 4);
    expect(r.ok).toBe(true);
    expect(r.best).toBeTruthy();
    if (expectMove) {
      expect(r.best).toBe(expectMove);
    }
    // Ensure score magnitude is reasonably large indicating tactical dominance
    expect(Math.abs(r.score)).toBeGreaterThanOrEqual(3000);
  });
});
