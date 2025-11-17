import { describe, it, expect, beforeAll } from 'vitest';
import '../engine-bridge2.js';

function waitBridgeReady() {
  return new Promise((resolve) => {
    if (window.EngineBridge && window.EngineBridge.wasmReady) return resolve();
    window.addEventListener('engine-bridge-ready', () => resolve(), { once: true });
    setTimeout(() => resolve(), 50);
  });
}

// Target position
const FEN_TARGET = '8/8/P7/5P2/1P1k1P2/P6R/3N3P/3KR3 w - - 6 44';

function choose(depth) {
  const opts = { searchDepth: depth };
  const json = window.EngineBridge.chooseBestMove(FEN_TARGET, JSON.stringify(opts));
  let obj = null;
  try { obj = JSON.parse(json); } catch { obj = null; }
  return obj;
}

describe('Engine best move selection for target FEN', () => {
  beforeAll(async () => { await waitBridgeReady(); if (window.EngineBridge && window.EngineBridge.setRandomSeed) window.EngineBridge.setRandomSeed(12345); });

  function expectNonStalemateBest(depth) {
    const res = choose(depth);
    expect(res).toBeTruthy();
    const bestUci = res && res.best && res.best.uci;
    expect(bestUci).toBeTruthy();
    // Regression requirement: engine must not pick the stalemate-in-one move e1e5
    expect(bestUci).not.toBe('e1e5');

    const nextFen = window.EngineBridge.applyMoveIfLegal(FEN_TARGET, bestUci);
    expect(nextFen).toBeTruthy();
    const term = JSON.parse(window.EngineBridge.detectTerminal(nextFen) || '{}');
    expect(term && term.status).not.toBe('stalemate');
    expect(res.depth).toBe(depth);
  }

  it('returns a non-stalemate move at depth 2', () => {
    expectNonStalemateBest(2);
  });

  it('returns a non-stalemate move at depth 3', () => {
    expectNonStalemateBest(3);
  });

  it('returns a non-stalemate move at depth 4', () => {
    expectNonStalemateBest(4);
  });
});
