import { describe, it, expect, beforeAll } from 'vitest';

function polyfillWindowDocument() {
  if (!global.window) global.window = {};
  if (!global.window.addEventListener) {
    const listeners = {};
    global.window.addEventListener = (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); };
    global.window.dispatchEvent = (evt) => {
      const arr = listeners[evt.type] || [];
      for (const fn of arr) fn(evt);
    };
  }
  if (!global.document) {
    global.document = {
      createEvent: () => ({ initEvent: function(type){ this.type = type; }, type: '' })
    };
  }
  // Declare global variable window so engine script IIFE can access it
  // eslint-disable-next-line no-global-assign
  window = global.window; // create lexical binding
}

async function loadEngineBridge() {
  polyfillWindowDocument();
  await import('../engine-bridge2.js');
}

function waitBridgeReady() {
  return new Promise((resolve) => {
    if (window.EngineBridge && window.EngineBridge.wasmReady) return resolve();
    window.addEventListener('engine-bridge-ready', () => resolve(), { once: true });
    setTimeout(() => resolve(), 50);
  });
}

// This test constructs a position where a black knight on e7 is pinned along the e-file
// by a white queen on e2 aiming at the black king on e8 (no intervening pieces except the knight).
// FEN: r3k2r/4n3/8/8/8/8/4Q3/4R3 b - - 0 1
// Expected: legal moves for black should NOT include any move of the e7 knight that exposes the king.
// We also verify that the knight cannot legally move and that at least one rook move exists to ensure
// move generation isn't completely broken.

describe('Pinned knight legality filtering', () => {
  beforeAll(async () => {
    await loadEngineBridge();
    await waitBridgeReady();
  });

  it('filters illegal pinned black knight moves', () => {
    const fen = 'r3k2r/4n3/8/8/8/8/4Q3/4R3 b - - 0 1';
    const raw = window.EngineBridge.listLegalMoves2Ply(fen, JSON.stringify({ ply: 2 }));
    const obj = JSON.parse(raw);
    expect(obj.error).toBeUndefined();
    const moves = obj.moves || [];
    // Any move starting with e7 (e7*) would be a knight move from e7. None should appear.
    const knightMoves = moves.filter(m => m.startsWith('e7'));
    expect(knightMoves.length).toBe(0);
    // Sanity: black rook a8 can usually move somewhere (e.g., a8a7) unless blocked.
    const hasRookAdvance = moves.some(m => m.startsWith('a8') && m !== 'a8a8');
    expect(hasRookAdvance).toBe(true);
  });
});
