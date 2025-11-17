import { describe, it, expect, beforeAll } from 'vitest';
import '../engine-bridge2.js';

function waitBridgeReady() {
  return new Promise((resolve) => {
    if (window.EngineBridge && window.EngineBridge.wasmReady) return resolve();
    window.addEventListener('engine-bridge-ready', () => resolve(), { once: true });
    setTimeout(() => resolve(), 50);
  });
}

// Flipped FEN so it's White to move; black Qb4->e1 maps to white Qg5->d8
const FEN_QB4_LINE = '6k1/5pp1/6p1/6Q1/8/n2b4/1r1n4/qrbK4 w - - 5 4';
const FEN_MATE_LINE = '8/8/P3R3/3k1P2/1P3P2/P6R/3N3P/3K2N1 w - - 7 45';

// Quick test switch: set env QUICK=1 (or 'true') to skip slow tests
const QUICK = (typeof process !== 'undefined') && (process.env.QUICK === '1' || String(process.env.QUICK).toLowerCase() === 'true');
const itSlow = QUICK ? it.skip : it; // mark slow tests with itSlow

function chooseBest(fen, opts) {
  const json = window.EngineBridge.chooseBestMove(fen, JSON.stringify(opts || {}));
  try { return JSON.parse(json); } catch { return null; }
}

function listLegals(fen) {
  const raw = window.EngineBridge.listLegalMoves2Ply(fen);
  try { const obj = JSON.parse(raw); return obj.moves || []; } catch { return []; }
}

function detectTerminal(fen) {
  if (!fen) return { status: 'error' };
  try { return JSON.parse(window.EngineBridge.detectTerminal(fen)); } catch { return { status: 'error' }; }
}

describe('Threefold repetition handling', () => {
  beforeAll(async () => {
    await waitBridgeReady();
    if (window.EngineBridge && window.EngineBridge.setRandomSeed) window.EngineBridge.setRandomSeed(24680);
  });

  it('detects the Qg5d8 repetition draw when losing material (flipped)', () => {
    // In flipped space, black's Qb4->e1 corresponds to white's Qg5->d8
    const repeatFen = window.EngineBridge.applyMoveIfLegal(FEN_QB4_LINE, 'g5d8');
    expect(repeatFen).toBeTruthy();
    const opts = {
      searchDepth: 3,
      repetition: {
        history: [repeatFen, repeatFen]
      }
    };
    const res = chooseBest(FEN_QB4_LINE, opts);
    expect(res).toBeTruthy();
    expect(res.best && res.best.uci).toBe('g5d8');
    const nextFen = window.EngineBridge.applyMoveIfLegal(FEN_QB4_LINE, 'g5d8');
    const term = detectTerminal(nextFen);
    expect(term.status).not.toBe('stalemate');
    // With the same history, repeating the child FEN immediately triggers draw recognition.
    const child = chooseBest(nextFen, { searchDepth: 1, repetition: { history: [repeatFen, repeatFen] } });
    expect(child).toBeTruthy();
    expect(child.status).toBe('draw-repetition');
    expect(child.best && child.best.score).toBe(0);
  });

  // Slow: deeper search to find mate line; skip when QUICK is enabled
  itSlow('avoids repetition and finds the mate line when winning', () => {
    const legals = listLegals(FEN_MATE_LINE);
    expect(legals.length).toBeGreaterThan(0);
    let repeatMove = null;
    let repeatFen = null;
    for (const uci of legals) {
      const next = window.EngineBridge.applyMoveIfLegal(FEN_MATE_LINE, uci);
      const term = detectTerminal(next);
      if (term.status !== 'checkmate') {
        repeatMove = uci;
        repeatFen = next;
        break;
      }
    }
    expect(repeatMove).toBeTruthy();
    const opts = {
      searchDepth: 7,
      repetition: {
        history: [repeatFen, repeatFen]
      }
    };
    const res = chooseBest(FEN_MATE_LINE, opts);
    expect(res && res.best && res.best.uci).toBeTruthy();
    expect(res.best.uci).not.toBe(repeatMove);
    expect(res.status).not.toBe('draw-repetition');
    expect(res.best.score).toBeGreaterThan(0);
    const repeatDraw = chooseBest(repeatFen, { searchDepth: 2, repetition: { history: [repeatFen, repeatFen] } });
    expect(repeatDraw && repeatDraw.status).toBe('draw-repetition');
  });
});
