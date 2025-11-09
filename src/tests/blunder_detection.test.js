'use strict';
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { pgnToFens } = require('../pgn_utils');

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

describe('Blunder detection from PGN', () => {
  let worker;
  beforeAll(() => { worker = spawnWorker(); });
  afterAll(() => { worker.terminate(); });

  test('After 9.O-O-O, avoid pointless 9...Rg8', async () => {
    const pgnPath = path.join(__dirname, 'fixtures', 'games', 'local_session_2025_11_08_b.pgn');
    const pgn = fs.readFileSync(pgnPath, 'utf8');
    const seq = pgnToFens(pgn);
    // Find the position after 9.O-O-O (before black's 9th move)
    const idxAfter9w = seq.findIndex(x => x.san.replace(/[+#]/g,'') === 'O-O-O');
    expect(idxAfter9w).toBeGreaterThanOrEqual(0);
    const fen4 = seq[idxAfter9w].fen4; // black to move
    // Search and ensure 9...Rg8 is not chosen
    const r = await searchPosition(worker, fen4, 3);
    expect(r.ok).toBe(true);
    expect(r.best).toBeDefined();
    expect(r.best).not.toBe('h8g8');
  });

  test('Prefer capture with pawn over push in tactical spot', async () => {
    const pgnPath = path.join(__dirname, 'fixtures', 'games', 'local_session_2025_11_08_b.pgn');
    const pgn = fs.readFileSync(pgnPath, 'utf8');
    const seq = pgnToFens(pgn);
    // Find the position after 10.d6; ensure engine finds a strong reply (not a passive pawn push)
    const idxAfter10d6 = seq.findIndex(x => x.san.replace(/[+#]/g,'') === 'd6');
    expect(idxAfter10d6).toBeGreaterThanOrEqual(0);
    const fen4 = seq[idxAfter10d6].fen4; // black to move after white played d6
    const r = await searchPosition(worker, fen4, 3);
    expect(r.ok).toBe(true);
    expect(r.best).toBeDefined();
    // Accept several good responses; explicitly reject passive h-pawn push here
    expect(r.best).not.toBe('h7h6');
  });
});
