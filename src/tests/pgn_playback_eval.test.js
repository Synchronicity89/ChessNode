'use strict';
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { pgnToFens, findSan } = require('../pgn_utils');

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

describe('PGN playback and king-move punishment', () => {
  let worker;
  beforeAll(() => { worker = spawnWorker(); });
  afterAll(() => { worker.terminate(); });

  test('Extract FENs from PGN and punish early Ke7', async () => {
    const pgn = fs.readFileSync(path.join(__dirname, 'fixtures', 'games', 'local_session_2025_11_08.pgn'), 'utf8');
    const entry = findSan(pgn, 'Ke7');
    expect(entry).toBeDefined();
    // After black plays Ke7, white to move; evaluation should be clearly good for white.
    const r = await searchPosition(worker, entry.fen4, 2);
    expect(r.ok).toBe(true);
    // Expect at least +2.0 pawns from white perspective (early king move penalty is 3.0, allowing some offsets)
    expect(r.score).toBeGreaterThanOrEqual(2.0);
  });

  test('pgnToFens returns a sensible sequence', () => {
    const pgn = fs.readFileSync(path.join(__dirname, 'fixtures', 'games', 'local_session_2025_11_08.pgn'), 'utf8');
    const list = pgnToFens(pgn);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(10);
    expect(list[0]).toHaveProperty('fen4');
    expect(list[0]).toHaveProperty('san');
  });
});
