import { describe, it, beforeAll, expect } from 'vitest';
import '../engine-bridge2.js';

function waitBridgeReady() {
  return new Promise((resolve) => {
    if (window.EngineBridge && window.EngineBridge.wasmReady) return resolve();
    window.addEventListener('engine-bridge-ready', () => resolve(), { once: true });
    setTimeout(() => resolve(), 50);
  });
}

// Material disadvantage FEN from earlier discussion
const FEN_TARGET = 'rrbb4/q1n5/Pn6/5P2/1P1k1P2/P6R/3N3P/3KR3 w - - 6 44';

describe('Candidate move score dump (debugMoves) for target FEN', () => {
  beforeAll(async () => { await waitBridgeReady(); if (window.EngineBridge.setRandomSeed) window.EngineBridge.setRandomSeed(12345); });

  it('dumps candidate moves with evaluations and potential draw/stalemate statuses', () => {
    const json = window.EngineBridge.chooseBestMove(FEN_TARGET, JSON.stringify({ searchDepth: 3, debugMoves: true }));
    const obj = JSON.parse(json);
    expect(obj).toBeTruthy();
    expect(Array.isArray(obj.candidates)).toBe(true);
    // Log a formatted dump for manual inspection
    const lines = [];
    lines.push('Base depth=' + obj.depth + ' best=' + (obj.best && obj.best.uci));
    for (const c of obj.candidates) {
      lines.push(c.uci + ' | afterEval=' + c.afterEval + ' | delta=' + c.delta + ' | childStatus=' + c.childStatus);
    }
    // Expose in test output
    console.log('\n[move score dump]\n' + lines.join('\n'));
    // Ensure at least one non-negative delta candidate (engine seeks improvement or neutralization)
    expect(obj.candidates.some(c => c.delta >= 0)).toBe(true);
  });
});
