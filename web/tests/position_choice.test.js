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
const FEN_TARGET = 'rrbb4/q1n5/Pn6/5P2/1P1k1P2/P6R/3N3P/3KR3 w - - 6 44';

function choose(depth) {
  const opts = { searchDepth: depth };
  const json = window.EngineBridge.chooseBestMove(FEN_TARGET, JSON.stringify(opts));
  let obj = null;
  try { obj = JSON.parse(json); } catch { obj = null; }
  return obj;
}

describe('Engine best move selection for target FEN', () => {
  beforeAll(async () => { await waitBridgeReady(); if (window.EngineBridge && window.EngineBridge.setRandomSeed) window.EngineBridge.setRandomSeed(12345); });

  it('reports expected best move at depth 2 (e1e4)', () => {
    const res = choose(2);
    expect(res).toBeTruthy();
    expect(res.best && res.best.uci).toBe('e1e4');
    expect(res.depth).toBe(2);
  });

  it('reports expected best move at depth 3 (h3h8)', () => {
    const res = choose(3);
    expect(res).toBeTruthy();
    expect(res.best && res.best.uci).toBe('h3h8');
    expect(res.depth).toBe(3);
  });

  it('reports expected best move at depth 4 (e1e4)', () => {
    const res = choose(4);
    expect(res).toBeTruthy();
    expect(res.best && res.best.uci).toBe('e1e4');
    expect(res.depth).toBe(4);
  });
});
