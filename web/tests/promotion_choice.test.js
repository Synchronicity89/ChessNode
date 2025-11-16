import { describe, it, expect, beforeAll } from 'vitest';
import '../engine-bridge2.js';

function waitBridgeReady() {
  return new Promise((resolve) => {
    if (window.EngineBridge && window.EngineBridge.wasmReady) return resolve();
    window.addEventListener('engine-bridge-ready', () => resolve(), { once: true });
    setTimeout(() => resolve(), 50);
  });
}

// Position with a white promotion available; engine should prefer promoting
const FEN_PROMO_CHOICE = 'rnk5/4P3/3p2pr/p6p/4K3/2p5/2P2PPP/3R4 w k - 0 29';

describe('Engine prefers promotion when available (white to move)', () => {
  beforeAll(async () => { await waitBridgeReady(); if (window.EngineBridge.setRandomSeed) window.EngineBridge.setRandomSeed(12345); });

  function choose(depth) {
    const json = window.EngineBridge.chooseBestMove(FEN_PROMO_CHOICE, JSON.stringify({ searchDepth: depth }));
    try { return JSON.parse(json); } catch { return null; }
  }

  it('picks a promotion move at depth 2', () => {
    const res = choose(2);
    expect(res && res.best && res.best.uci).toBeTruthy();
    // Expect a promotion from e7 to e8 with some piece (q/r/b/n)
    expect(/^e7e8[qrbn]$/.test(res.best.uci)).toBe(true);
  });

  it('picks a promotion move at depth 3 as well', () => {
    const res = choose(3);
    expect(res && res.best && res.best.uci).toBeTruthy();
    expect(/^e7e8[qrbn]$/.test(res.best.uci)).toBe(true);
  });
});
