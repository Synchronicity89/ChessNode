'use strict';

const pos64 = require('./position64');
const cheat = require('./cheatStore');

// Encode a FEN into two 64-bit integers (hi, lo) and return the canonical 4-field FEN.
// Strategy:
// - Try Format 2 pack: if fits, hi=0n, lo=code
// - Else: store canonical FEN bytes in cheat store and encode a format1-cheat reference into lo, hi=0n
// - If anything fails, return zeros
function encodePosition128(fen) {
  try {
    const attempt = pos64.attemptPackFormat2(fen);
    const canfen = pos64.canonicalizeFEN(fen);
    if (attempt.ok) {
      return { hi: 0n, lo: attempt.code, fen: canfen, method: 'format2' };
    }
    // Cheat-store fallback: use existing cheat store (offset id) and reuse format1-cheat layout
    const buf = Buffer.from(canfen, 'utf8');
    const offset = cheat.storeBlob(buf);
    // Encode as format1-cheat: bit63=1, subformat=0b010 at bits 62..60, offset in low 60 bits
    let lo = 0n;
    lo |= (1n << 63n);
    lo |= (0b010n << 60n);
    lo |= BigInt(offset) & ((1n << 60n) - 1n);
    return { hi: 0n, lo, fen: canfen, method: 'cheat' };
  } catch {
    return { hi: 0n, lo: 0n, fen: pos64.canonicalizeFEN(fen), method: 'zero' };
  }
}

module.exports = { encodePosition128 };
