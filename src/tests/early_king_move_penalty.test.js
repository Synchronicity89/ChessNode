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

// Problematic FEN where engine previously moved king early.
const fenProblem = 'r1bqkbnr/pppp1ppp/2n5/8/3PpP2/2P5/PP2P1PP/RNBQKBNR w KQkq -';

describe('Early king move penalty discourages Kd2', () => {
  let worker;
  beforeAll(() => { worker = spawnWorker(); });
  afterAll(() => { worker.terminate(); });

  test('king move e1d2 or e1c2 is not selected at depth 3', async () => {
    const r = await searchPosition(worker, fenProblem, 3);
    expect(r.ok).toBe(true);
    expect(r.best).toBeDefined();
    expect(['e1d2','e1c2','e1f2'].includes(r.best)).toBeFalsy();
  });
});
