import { describe, it, beforeAll, expect } from 'vitest';
import '../engine-bridge2.js';

function waitBridgeReady() {
  return new Promise((resolve) => {
    if (window.EngineBridge && window.EngineBridge.wasmReady) return resolve();
    window.addEventListener('engine-bridge-ready', () => resolve(), { once: true });
    setTimeout(() => resolve(), 50);
  });
}

function flipFen(fen) {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 6) return fen;
  const [placement, stm, cast, ep, half, full] = parts;
  const rows = placement.split('/');
  const squares = [];
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (/^[1-8]$/.test(ch)) { c += parseInt(ch, 10); while (squares.length < r*8 + c) squares.push('.'); }
      else { squares.push(ch); c++; }
    }
  }
  const out = new Array(64).fill('.');
  for (let i = 0; i < 64; i++) {
    let p = squares[i];
    const j = 63 - i;
    if (p !== '.') p = (p === p.toUpperCase()) ? p.toLowerCase() : p.toUpperCase();
    out[j] = p;
  }
  const rowsOut = [];
  for (let r = 0; r < 8; r++) {
    let row = ''; let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = out[r*8+c];
      if (p === '.') empty++; else { if (empty) { row += String(empty); empty = 0; } row += p; }
    }
    if (empty) row += String(empty);
    rowsOut.push(row);
  }
  const newPlacement = rowsOut.join('/');
  const newSide = (stm === 'w') ? 'b' : 'w';
  function swapCast(s) { if (!s || s === '-') return '-'; let has={K:false,Q:false,k:false,q:false}; for(const ch of s){ has[ch]=true; } const t = (has.k?'K':'')+(has.q?'Q':'')+(has.K?'k':'')+(has.Q?'q':''); return t||'-'; }
  function flipSq(sq) { if (!/^[a-h][1-8]$/.test(sq)) return '-'; const f=sq.charCodeAt(0)-97; const r=sq.charCodeAt(1)-49; const nf=7-f; const nr=7-r; return String.fromCharCode(97+nf)+String.fromCharCode(49+nr); }
  const newCast = swapCast(cast);
  const newEp = ep && ep !== '-' ? flipSq(ep) : '-';
  return `${newPlacement} ${newSide} ${newCast} ${newEp} ${half} ${full}`;
}

function normalizeToWhite(fen) {
  const stm = (fen.split(' ')[1] || 'w');
  if (stm === 'w') return { fen, flipped: false, mapMove: (m)=>m };
  function flipSq(sq){ const f=sq.charCodeAt(0)-97; const r=sq.charCodeAt(1)-49; const nf=7-f; const nr=7-r; return String.fromCharCode(97+nf)+String.fromCharCode(49+nr); }
  function flipMove(uci){ const a=uci.slice(0,2), b=uci.slice(2,4), p=uci.slice(4); return flipSq(a)+flipSq(b)+p; }
  return { fen: flipFen(fen), flipped: true, mapMove: flipMove };
}

const FEN_BLACK_TO_MOVE = '8/8/P7/4RP2/1P1k1P2/P6R/3N3P/3K2N1 b - - 6 44'; // stalemate position

describe('Normalize-to-white score dump utility', () => {
  beforeAll(async () => { await waitBridgeReady(); if (window.EngineBridge.setRandomSeed) window.EngineBridge.setRandomSeed(12345); });

  it('handles black-to-move by flipping to white and returns consistent status', () => {
    const norm = normalizeToWhite(FEN_BLACK_TO_MOVE);
    const res = JSON.parse(window.EngineBridge.chooseBestMove(norm.fen, JSON.stringify({ searchDepth: 2, debugMoves: true })));
    expect(res.status).toBe('stalemate');
    // On stalemate positions, expect no candidates
    expect(res.candidates === undefined || res.candidates.length === 0).toBe(true);
  });
});
