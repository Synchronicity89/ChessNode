'use strict';
const path = require('path');
const { Worker } = require('worker_threads');

jest.setTimeout(20000);

function spawnWorker() {
  const workerPath = path.join(__dirname, '..', 'engine', 'worker.js');
  return new Worker(workerPath);
}

function searchPosition(worker, fen4, depth) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9);
    const handler = (m) => { if (m.id === id) { worker.off('message', handler); resolve(m); } };
    worker.on('message', handler);
    worker.postMessage({ type: 'search', id, fen4, depth, verbose: false, maxTimeMs: 4000 });
  });
}

// Provided position where white previously moved the king for no reason; ensure we don't choose a king move.
const fenNoKingMove = 'r1bqkbnr/pppp1ppp/2n5/8/3PpP2/2P5/PP2P1PP/RNBQKBNR w KQkq -';

describe('Avoid pointless king moves', () => {
  let worker;
  beforeAll(() => { worker = spawnWorker(); });
  afterAll(() => { worker.terminate(); });

  test('does not move the king in the given FEN', async () => {
    const r = await searchPosition(worker, fenNoKingMove, 3);
    expect(r.ok).toBe(true);
    expect(r.best).toBeDefined();
    // best UCI should not start with e1 (white king from e1)
    expect(r.best.startsWith('e1')).toBeFalsy();
  });
});
