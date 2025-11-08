'use strict';
const path = require('path');
const { Worker } = require('worker_threads');

jest.setTimeout(20000);

function spawnWorker() {
  const workerPath = path.join(__dirname, '..', 'engine', 'worker.js');
  return new Worker(workerPath);
}

function searchPosition(worker, fen4, depth, verbose=false) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9);
    const handler = (m) => { if (m.id === id) { worker.off('message', handler); resolve(m); } };
    worker.on('message', handler);
    worker.postMessage({ type: 'search', id, fen4, depth, verbose, maxTimeMs: 4000 });
  });
}

// Position with easy short-castle available; engine should prefer O-O over a slow pawn move.
// FEN after: 1. e4 e5 2. Nf3 Nc6 3. Be2 Nf6 ; white to move, O-O is legal and safe.
const fenCastle = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/5N2/PPPPBPPP/RNBQK2R w KQkq -';

describe('Castling incentive preference', () => {
  let worker;
  beforeAll(() => { worker = spawnWorker(); });
  afterAll(() => { worker.terminate(); });

  test('considers O-O among top lines in a typical position', async () => {
    const r = await searchPosition(worker, fenCastle, 3, true);
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.bestLines)).toBe(true);
    const hasCastleInTop = r.bestLines.some(x => typeof x.line === 'string' && x.line.startsWith('O-O'));
    expect(hasCastleInTop).toBeTruthy();
  });
});
