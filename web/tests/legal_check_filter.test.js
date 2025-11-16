import { describe, it, expect, beforeAll } from 'vitest';

// Load the engine bridge script so it attaches to window.EngineBridge
import '../engine-bridge2.js';

const FEN_IN_CHECK = '8/8/P2r1p2/5P2/1P2k2p/P6N/R2KBP1P/1N5R w - - 5 29';

function waitBridgeReady() {
  return new Promise((resolve) => {
    if (window.EngineBridge && window.EngineBridge.wasmReady) return resolve();
    window.addEventListener('engine-bridge-ready', () => resolve(), { once: true });
    // Fallback small timeout
    setTimeout(() => resolve(), 50);
  });
}

function applyMove(fen, uci) {
  return window.EngineBridge.applyMoveIfLegal(fen, uci);
}

describe('Legal move filtering while in check', () => {
  beforeAll(async () => {
    await waitBridgeReady();
  });

  it('detects that side-to-move is in check for the provided FEN', () => {
    const inCheck = window.EngineBridge.isInCheck(FEN_IN_CHECK, 'w');
    expect(inCheck).toBe(true);
  });

  it('returns only moves that resolve check (no king attacked after move)', () => {
    const resJson = window.EngineBridge.listLegalMoves2Ply(FEN_IN_CHECK);
    const res = JSON.parse(resJson);
    expect(res).toBeTruthy();
    expect(Array.isArray(res.moves)).toBe(true);
    // Can be zero (checkmate), but the property should exist
    for (const uci of res.moves) {
      const nextFen = applyMove(FEN_IN_CHECK, uci);
      expect(nextFen).toBeTruthy();
      // After white moves, ensure white king is not in check
      const stillInCheck = window.EngineBridge.isInCheck(nextFen, 'w');
      expect(stillInCheck).toBe(false);
    }
  });

  it('chooseBestMove honors legality (best move is among legal set)', () => {
    const resJson = window.EngineBridge.listLegalMoves2Ply(FEN_IN_CHECK);
    const legals = JSON.parse(resJson).moves || [];
    const bestJson = window.EngineBridge.chooseBestMove(FEN_IN_CHECK, JSON.stringify({ searchDepth: 2 }));
    const best = JSON.parse(bestJson);
    if (legals.length === 0) {
      // If no legal moves (checkmate), engine should have no move
      expect(best && best.best && best.best.uci).toBeFalsy();
    } else {
      expect(legals).toContain(best.best.uci);
    }
  });
});
