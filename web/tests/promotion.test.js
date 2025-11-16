import { describe, it, expect, beforeAll } from 'vitest';
import '../engine-bridge2.js';

function waitBridgeReady() {
  return new Promise((resolve) => {
    if (window.EngineBridge && window.EngineBridge.wasmReady) return resolve();
    window.addEventListener('engine-bridge-ready', () => resolve(), { once: true });
    setTimeout(() => resolve(), 50);
  });
}

const FEN_PROMO = '4r3/ppp2p2/5P2/3k4/P6P/RP2P3/3p4/5KNR b K - 0 29';

function listLegals(fen) {
  const json = window.EngineBridge.listLegalMoves2Ply(fen);
  const obj = JSON.parse(json);
  return obj.moves || [];
}

function applyMove(fen, uci) {
  return window.EngineBridge.applyMoveIfLegal(fen, uci);
}

function getPieceAtFen(fen, sq) {
  const board = (fen.split(' ')[0] || '').split('/');
  const f = sq.charCodeAt(0) - 97; const r = sq.charCodeAt(1) - 49; const rr = 7 - r;
  let c = 0; for (const ch of board[rr]) { if (/^[1-8]$/.test(ch)) { c += parseInt(ch, 10); } else { if (c === f) return ch; c++; } }
  return '.';
}

describe('Pawn promotion generation and application', () => {
  beforeAll(async () => { await waitBridgeReady(); if (window.EngineBridge.setRandomSeed) window.EngineBridge.setRandomSeed(123); });

  it('includes black promotion moves (d2d1q) in legal list and applies promotion', () => {
    const moves = listLegals(FEN_PROMO);
    expect(moves.some(m => m === 'd2d1q')).toBe(true);
    const next = applyMove(FEN_PROMO, 'd2d1q');
    expect(next).toBeTruthy();
    const piece = getPieceAtFen(next, 'd1');
    expect(piece).toBe('q');
  });

  it('includes all promotion types for black (q,r,b,n) on d2d1', () => {
    const moves = listLegals(FEN_PROMO);
    for (const p of ['q','r','b','n']) {
      expect(moves).toContain('d2d1' + p);
    }
  });
});
