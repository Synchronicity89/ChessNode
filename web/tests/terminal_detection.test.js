import { describe, it, expect, beforeAll } from 'vitest';
import '../engine-bridge2.js';

function waitBridgeReady() {
  return new Promise((resolve) => {
    if (window.EngineBridge && window.EngineBridge.wasmReady) return resolve();
    window.addEventListener('engine-bridge-ready', () => resolve(), { once: true });
    setTimeout(() => resolve(), 50);
  });
}

const FEN_STALEMATE = '8/8/P7/4RP2/1P1k1P2/P6R/3N3P/3K2N1 b - - 6 44';
const FEN_TWO_KINGS  = '8/8/8/8/8/8/8/3kK3 w - - 0 1';
const FEN_MATE_IN_ONE = '8/8/P3R3/3k1P2/1P3P2/P6R/3N3P/3K2N1 w - - 7 45';

function listLegals(fen) {
  const json = window.EngineBridge.listLegalMoves2Ply(fen);
  const obj = JSON.parse(json);
  return obj.moves || [];
}

function applyMove(fen, uci) {
  return window.EngineBridge.applyMoveIfLegal(fen, uci);
}

describe('Terminal detection (checkmate, stalemate, two-kings draw)', () => {
  beforeAll(async () => { await waitBridgeReady(); });

  it('detects stalemate at the stalemate FEN', () => {
    const res = JSON.parse(window.EngineBridge.detectTerminal(FEN_STALEMATE));
    expect(res.status).toBe('stalemate');
  });

  it('detects two-kings insufficient material draw', () => {
    const res = JSON.parse(window.EngineBridge.detectTerminal(FEN_TWO_KINGS));
    expect(res.status).toBe('draw-insufficient');
  });

  it('detects checkmate after applying a mating move from mate-in-one position', () => {
    const moves = listLegals(FEN_MATE_IN_ONE);
    let nextMate = null;
    for (const uci of moves) {
      const next = applyMove(FEN_MATE_IN_ONE, uci);
      const oppMoves = listLegals(next);
      const inCheck = window.EngineBridge.isInCheck(next, 'b');
      if (oppMoves.length === 0 && inCheck) { nextMate = next; break; }
    }
    expect(nextMate).toBeTruthy();
    const res = JSON.parse(window.EngineBridge.detectTerminal(nextMate));
    expect(res.status).toBe('checkmate');
    expect(res.winner).toBe('w');
  });
});
