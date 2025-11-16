import { describe, it, beforeAll, expect } from 'vitest';
import '../engine-bridge2.js';

function waitBridgeReady() {
  return new Promise((resolve) => {
    if (window.EngineBridge && window.EngineBridge.wasmReady) return resolve();
    window.addEventListener('engine-bridge-ready', () => resolve(), { once: true });
    setTimeout(() => resolve(), 50);
  });
}

const FEN = 'rrbb4/q1n5/Pn6/5P2/1P1k1P2/P6R/3N3P/3KR3 w - - 6 44';

describe('Check e1e5 stalemate claim', () => {
  beforeAll(async () => { await waitBridgeReady(); if (window.EngineBridge.setRandomSeed) window.EngineBridge.setRandomSeed(1); });

  it('applies e1e5 and checks terminal status', () => {
    const next = window.EngineBridge.applyMoveIfLegal(FEN, 'e1e5');
    expect(next).toBeTruthy();
    const res = JSON.parse(window.EngineBridge.detectTerminal(next));
    // Log for manual inspection
    console.log('After e1e5:', next);
    console.log('Terminal detection:', res);
    expect(['stalemate','ok','checkmate']).toContain(res.status);
  });
});
