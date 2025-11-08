'use strict';
const { Chess } = require('chess.js');

function ensureSix(f4) {
  const p = f4.trim().split(/\s+/);
  return p.length >= 6 ? f4 : `${p[0]} ${p[1]} ${p[2]} ${p[3]} 0 1`;
}

// Convert full FEN to fen4 (first 4 fields)
function fenToFen4(fen) {
  const parts = fen.trim().split(/\s+/);
  return parts.slice(0, 4).join(' ');
}

// Parse a PGN string and return an array of { moveIndex, san, from, to, fen4 } after each move
function pgnToFens(pgn) {
  // Strip headers, comments, variations, and results; split into SAN tokens
  let body = pgn.replace(/^\s*\[[^\]]*\]\s*$/gm, ''); // tag pairs
  body = body.replace(/\{[^}]*\}/g, ''); // comments
  body = body.replace(/\([^)]*\)/g, ''); // variations
  body = body.replace(/\d+\.(\.{2})?/g, ' '); // move numbers
  body = body.replace(/\s+/g, ' ').trim();
  const tokens = body.split(' ').filter(t => t && !/^1-0|0-1|1\/2-1\/2|\*$/.test(t));
  const c = new Chess();
  const out = [];
  let idx = 0;
  for (const san of tokens) {
    const made = c.move(san, { sloppy: true });
    if (!made) throw new Error('Failed to apply SAN: ' + san);
    out.push({ moveIndex: idx, san: made.san, from: made.from, to: made.to, fen4: fenToFen4(c.fen()) });
    idx++;
  }
  return out;
}

// Find the first occurrence of a SAN (e.g., 'Ke7') and return its entry
function findSan(pgn, sanTarget) {
  const list = pgnToFens(pgn);
  return list.find(x => x.san.replace(/[+#]/g, '') === sanTarget);
}

module.exports = {
  pgnToFens,
  findSan,
  fenToFen4,
  ensureSix,
};
