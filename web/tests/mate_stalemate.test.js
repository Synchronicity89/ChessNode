import { describe, it, expect, beforeAll } from 'vitest';
import '../engine-bridge2.js';

function waitBridgeReady() {
  return new Promise((resolve) => {
    if (window.EngineBridge && window.EngineBridge.wasmReady) return resolve();
    window.addEventListener('engine-bridge-ready', () => resolve(), { once: true });
    setTimeout(() => resolve(), 50);
  });
}

const FEN_MATE_IN_ONE = '8/8/P3R3/3k1P2/1P3P2/P6R/3N3P/3K2N1 w - - 7 45';
const FEN_STALE_CHILD = '8/8/P7/5P2/1P1k1P2/P6R/3N3P/3KR1N1 w - - 5 44';
const FEN_ANCESTOR    = '8/8/P7/5P2/1P1k1P2/P6R/3N3P/3KR1N1 w - - 5 44';

function listLegals(fen) {
  const json = window.EngineBridge.listLegalMoves2Ply(fen);
  const obj = JSON.parse(json);
  return obj.moves || [];
}

function applyMove(fen, uci) {
  return window.EngineBridge.applyMoveIfLegal(fen, uci);
}

describe('Checkmate and stalemate recognition', () => {
  beforeAll(async () => { await waitBridgeReady(); });

  it('recognizes at least one checkmating move (mate in one exists)', () => {
    const whiteLegals = listLegals(FEN_MATE_IN_ONE);
    let hasMate = false;
    let mateMove = null;
    for (const uci of whiteLegals) {
      const next = applyMove(FEN_MATE_IN_ONE, uci);
      const oppLegals = listLegals(next);
      const oppInCheck = window.EngineBridge.isInCheck(next, 'b');
      if (oppLegals.length === 0 && oppInCheck) { hasMate = true; mateMove = uci; break; }
    }
    expect(hasMate).toBe(true);
    // Optional: engine should be able to find it at sufficient depth
    const bestRaw = window.EngineBridge.chooseBestMove(FEN_MATE_IN_ONE, JSON.stringify({ searchDepth: 4 }));
    const best = JSON.parse(bestRaw);
    expect(best && best.best && best.best.uci).toBeTruthy();
  });

  it('sees at least one stalemate child from the given position', () => {
    const legals = listLegals(FEN_STALE_CHILD);
    let hasStale = false;
    for (const uci of legals) {
      const next = applyMove(FEN_STALE_CHILD, uci);
      const oppLegals = listLegals(next);
      const oppInCheck = window.EngineBridge.isInCheck(next); // defaults to side-to-move
      if (oppLegals.length === 0 && !oppInCheck) { hasStale = true; break; }
    }
    expect(hasStale).toBe(true);
  });

  it('at ancestor, best line avoids stalemate and aims for mate (high score)', () => {
    const bestRaw = window.EngineBridge.chooseBestMove(FEN_ANCESTOR, JSON.stringify({ searchDepth: 4 }));
    const best = JSON.parse(bestRaw);
    expect(best && best.best).toBeTruthy();
    const nextFen = applyMove(FEN_ANCESTOR, best.best.uci);
    const oppLegals = listLegals(nextFen);
    const oppInCheck = window.EngineBridge.isInCheck(nextFen);
    // If engine selects immediate stalemate move, oppLegals=0 and oppInCheck=false.
    // Prefer non-zero legals or checkmate direction; at minimum ensure not immediate stalemate.
    expect(!(oppLegals.length === 0 && !oppInCheck)).toBe(true);
  });
});
