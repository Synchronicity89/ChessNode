'use strict';
const path = require('path');
const { Worker } = require('worker_threads');

function runWorkerSearch(fen4, depth, verbose=false) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '..', 'engine', 'worker.js'));
    const id = 1;
    const maxTimeMs = 2000;
    worker.on('message', (m) => { resolve(m); worker.terminate(); });
    worker.on('error', reject);
    worker.postMessage({ type: 'search', id, fen4, depth, verbose, maxTimeMs });
    setTimeout(() => { reject(new Error('timeout')); worker.terminate(); }, maxTimeMs + 2000);
  });
}

// Startpos simple sanity with depth 2 and verbose: should return bestmove and PV arrays

describe('engine worker multi-PV', () => {
  test('returns best and PV arrays at depth 2', async () => {
    const fen4 = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
    const res = await runWorkerSearch(fen4, 2, true);
    expect(res.ok).toBe(true);
    expect(typeof res.best).toBe('string');
    expect(typeof res.score).toBe('number');
    expect(Array.isArray(res.bestLines)).toBe(true);
    expect(Array.isArray(res.worstLines)).toBe(true);
    expect(res.bestLines.length).toBeGreaterThan(0);
    expect(res.bestLines.length).toBeLessThanOrEqual(3);
  });
});
