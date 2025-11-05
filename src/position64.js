// position64.js
// Compact reversible-ish packing of chess positions into 64-bit unsigned BigInts.
// Format scheme explained in README. This file implements:
// - attemptPackFormat2(fen) -> { ok: boolean, code: BigInt }
// - unpackFormat2(code) -> { fen } or throws
// - helpers: canonicalizeFEN, piece-list extraction, combinatorial indexing

'use strict';

const MAX_BITS = 64n;

// Precompute binomial coefficients C(n,k) as BigInt for 0 <= n <= 64
const MAX_N = 64;
const binom = Array.from({ length: MAX_N + 1 }, () => Array(MAX_N + 1).fill(0n));
for (let n = 0; n <= MAX_N; n++) {
  binom[n][0] = 1n;
  for (let k = 1; k <= n; k++) {
    binom[n][k] = binom[n - 1][k - 1] + binom[n - 1][k];
  }
}

// Piece type buckets and canonical ordering used for packing
const BUCKETS = [
  { key: 'P', color: 'w' }, // white pawn
  { key: 'N', color: 'w' }, // white knight
  { key: 'B', color: 'w' }, // white bishop
  { key: 'R', color: 'w' }, // white rook
  { key: 'Q', color: 'w' }, // white queen
  { key: 'K', color: 'w' }, // white king
  { key: 'p', color: 'b' }, // black pawn
  { key: 'n', color: 'b' },
  { key: 'b', color: 'b' },
  { key: 'r', color: 'b' },
  { key: 'q', color: 'b' },
  { key: 'k', color: 'b' }
];

// helpers to convert square <-> index
function sqIndex(fileRank) {
  // fileRank like 'e4' -> 0..63 (a1=0, h8=63)
  const f = fileRank.charCodeAt(0) - 'a'.charCodeAt(0);
  const r = parseInt(fileRank[1], 10) - 1;
  return r * 8 + f;
}
function idxToSquare(idx) {
  const r = Math.floor(idx / 8);
  const f = idx % 8;
  return String.fromCharCode('a'.charCodeAt(0) + f) + (r + 1);
}

// parse FEN into piece list and metadata minimally
function parseFEN(fen) {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) throw new Error('FEN must have >=4 fields');
  const board = parts[0];
  const side = parts[1]; // 'w' or 'b'
  const castling = parts[2]; // e.g., 'KQkq' or '-'
  const ep = parts[3]; // e.g., 'e3' or '-'
  const rows = board.split('/');
  const piecePositions = []; // array of {p, idx}
  for (let rank = 7; rank >= 0; rank--) {
    const row = rows[7 - rank];
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += parseInt(ch, 10);
      } else {
        const idx = rank * 8 + file;
        piecePositions.push({ p: ch, idx });
        file += 1;
      }
    }
  }
  return { piecePositions, side, castling, ep, fen };
}

// canonicalize fen: we will return a normalized fen string (no halfmove/fulmove fields)
function canonicalizeFEN(fen) {
  const parsed = parseFEN(fen);
  // sort piecePositions by bucket order and then by square index to keep canonical
  parsed.piecePositions.sort((a, b) => {
    const ai = BUCKETS.findIndex(x => x.key === a.p);
    const bi = BUCKETS.findIndex(x => x.key === b.p);
    if (ai !== bi) return ai - bi;
    return a.idx - b.idx;
  });
  // build board rows from piecePositions
  const board = Array.from({ length: 64 }, () => '.');
  for (const pos of parsed.piecePositions) board[pos.idx] = pos.p;
  let rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const c = board[r * 8 + f];
      if (c === '.') {
        empty++;
      } else {
        if (empty > 0) { row += empty; empty = 0; }
        row += c;
      }
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }
  const boardPart = rows.join('/');
  const cast = parsed.castling === '-' ? '-' : parsed.castling;
  const ep = parsed.ep === '-' ? '-' : parsed.ep;
  // canonical FEN without halfmove/fullmove
  return `${boardPart} ${parsed.side} ${cast} ${ep}`;
}

// compute multinomial bucket counts
function getBucketCounts(piecePositions) {
  const counts = Array(BUCKETS.length).fill(0);
  for (const pp of piecePositions) {
    const bi = BUCKETS.findIndex(x => x.key === pp.p);
    if (bi < 0) throw new Error('Unsupported piece: ' + pp.p);
    counts[bi] += 1;
  }
  return counts;
}

// combinatorial unranking for multiset: we pack by selecting sets of squares for each bucket
// canonical order: BUCKETS[0], BUCKETS[1], ...
// For bucket i with c pieces, we choose a combination of c squares out of remaining N squares.
// The combined index is the mixed-radix number where each digit is the combinatorial index of chosen subset
function packMultisetSquares(occupiedIndicesSorted, bucketCounts) {
  // occupiedIndicesSorted: ascending array of indices where pieces exist
  // bucketCounts: array nb of pieces per bucket (sum = m)
  let remainingSquares = 64;
  let availableIndices = Array.from({ length: 64 }, (_, i) => i);
  // We'll produce a BigInt index by iteratively computing combination ranks.
  let idx = 0n;
  let offset = 0n;
  let pointer = 0; // pointer into occupiedIndicesSorted
  for (let b = 0; b < bucketCounts.length; b++) {
    const c = bucketCounts[b];
    if (c === 0) continue;
    // For this bucket choose c elements out of remainingSquares. We must find rank of chosen subset
    // The chosen subset for this bucket is the next c elements in occupiedIndicesSorted but their positions are relative to availableIndices
    // Build mapping from square index to rank in availableIndices
    const mapIndexToRank = new Map();
    for (let r = 0; r < availableIndices.length; r++) mapIndexToRank.set(availableIndices[r], r);
    // build list of ranks for this bucket
    const ranks = [];
    for (let j = 0; j < c; j++) {
      const sq = occupiedIndicesSorted[pointer + j];
      const rank = mapIndexToRank.get(sq);
      if (rank === undefined) throw new Error('inconsistent mapping during pack');
      ranks.push(rank);
    }
    // ranks is strictly increasing; compute its combination rank
    // rank = sum_{i=0..c-1} C(remainingSquares - 1 - ranks[i], c - i)
    // but we want lexicographic ranking with combinations in increasing order: use standard formula
    let combRank = 0n;
    let prev = -1;
    for (let i = 0; i < c; i++) {
      const rnk = ranks[i];
      // for t from (prev+1) to (rnk-1): add C(remainingSquares - 1 - t, c - i -1)
      for (let t = prev + 1; t < rnk; t++) {
        const n = remainingSquares - 1 - t;
        const k = c - i - 1;
        combRank += binom[n][k];
      }
      prev = rnk;
    }
    // Now combRank is the local digit; we need to multiply offset by the modulus (C(remainingSquares, c)) and add
    const base = binom[remainingSquares][c];
    idx = idx * base + combRank;
    // Now remove the chosen c squares from availableIndices to prepare next bucket
    // The chosen actual squares are availableIndices[ranks[*]]
    // Remove by creating a new array
    const newAvail = [];
    let rp = 0;
    for (let i = 0; i < availableIndices.length; i++) {
      if (ranks.includes(i)) {
        // skip
      } else newAvail.push(availableIndices[i]);
    }
    availableIndices = newAvail;
    remainingSquares = availableIndices.length;
    pointer += c;
  }
  return idx;
}

// Determine how many bits are required to store a given BigInt value (minimum bits)
function bitlen(big) {
  if (big === 0n) return 1;
  let v = big;
  let l = 0;
  while (v > 0n) {
    v >>= 1n;
    l++;
  }
  return l;
}

// Primary attempt to pack FEN into a 64-bit BigInt format2. Returns {ok, code}
function attemptPackFormat2(fen) {
  const canfen = canonicalizeFEN(fen);
  const parsed = parseFEN(fen);
  const counts = getBucketCounts(parsed.piecePositions);
  const m = parsed.piecePositions.length;
  if (m > 31) return { ok: false, reason: 'too many pieces for format2 (m>31)' }; // header uses 5 bits for m
  // build occupiedIndicesSorted ascending
  const occ = parsed.piecePositions.map(p => p.idx).sort((a, b) => a - b);
  // pack the bucket multiset
  const multiIndex = packMultisetSquares(occ, counts);
  // now compute header and metadata bits sizes
  const header_m = BigInt(m) & 0x1Fn; // 5 bits
  const sideBit = parsed.side === 'w' ? 0n : 1n;
  // castling 4 bits mask: KQkq in bit order K Q k q (K=bit3 ... q=bit0)
  let castMask = 0n;
  if (parsed.castling.includes('K')) castMask |= 1n << 3n;
  if (parsed.castling.includes('Q')) castMask |= 1n << 2n;
  if (parsed.castling.includes('k')) castMask |= 1n << 1n;
  if (parsed.castling.includes('q')) castMask |= 1n << 0n;
  // en-passant: encode 0..8 (0 = none, 1..8 = file a..h)
  let epVal = 0n;
  if (parsed.ep !== '-' && parsed.ep.length === 2) {
    const file = parsed.ep.charCodeAt(0) - 'a'.charCodeAt(0); // 0..7
    epVal = BigInt(file + 1);
  }
  // construct raw index: start with combinatorial index (multiIndex)
  // compute required bits for multiIndex
  // The total combinatorial space size for given buckets is product of C(64 - sum(prev), c_i) = binom(64, m) * multinomial correction but our mixed-radix base computed in pack is product of C(rem, c).
  let totalCombSpace = 1n;
  let rem = 64;
  for (let b = 0; b < counts.length; b++) {
    const c = counts[b];
    if (c === 0) continue;
    totalCombSpace *= binom[rem][c];
    rem -= c;
  }
  const multiBits = bitlen(totalCombSpace - 1n);
  // now estimate bits for metadata: m (5 bits) + side (1) + castling(4) + ep(4) = 14 bits
  const metaBits = 5 + 1 + 4 + 4;
  const needed = BigInt(multiBits + metaBits);
  if (needed > 63n) {
    return { ok: false, reason: 'combination index too big', needed: Number(needed), avail: 63 };
  }
  // layout bits:
  // bit63 (MSB) = 0 for format2
  // bits62..(63-needed+1) : unused/reserved
  // next meta bits and then multiIndex in least significant bits
  // We'll store as: [reserved][m:5][side:1][cast:4][ep:4][multiIndex:multiBits]
  let code = 0n;
  // pack: shift left to make room for multiIndex
  code = (BigInt(m) << BigInt(metaBits + multiBits - 5)) // but simpler: build step by step
  // do in steps
  let cursor = 0n;
  // start with multiIndex in low bits
  code = multiIndex;
  cursor = BigInt(multiBits);
  // add ep (4 bits)
  code |= (epVal << cursor);
  cursor += 4n;
  // cast
  code |= (castMask << cursor);
  cursor += 4n;
  // side
  code |= (sideBit << cursor);
  cursor += 1n;
  // m
  code |= (BigInt(m) << cursor);
  cursor += 5n;
  // now ensure cursor <= 63
  if (cursor > 63n) return { ok: false, reason: 'overflow during pack' };
  // bit63 must be zero; we return code as unsigned 64-bit BigInt
  code = code & ((1n << 63n) - 1n);
  return { ok: true, code, canfen, meta: { m, multiBits, metaBits, totalCombSpace: totalCombSpace.toString() } };
}

// basic unpack for format2 (best-effort)
// Note: we only implement minimal unpacking to reconstruct FEN for the cases this packer supports.
function unpackFormat2(code) {
  // code is BigInt <= 2^63-1
  const mask63 = (1n << 63n) - 1n;
  code = code & mask63;
  // read m (low: multiIndex bits unknown) — we need to find m: it's stored at bits cursor position
  // Because we don't store multiBits explicitly, we must parse by reading m at the position we know: m occupies bits starting at bit position metaBits + multiBits, but multiBits depends on m and bucket counts; full unpacking is complex.
  // For the prototype, we will decode header knowing that we encoded m in bits [cursor..cursor+5)
  // As we constructed: multiIndex low bits, then ep(4), cast(4), side(1), m(5).
  // So we can read m by shifting right by (multiBits + 9), but multiBits unknown.
  // Simpler approach: read top 14 bits (m,side,cast,ep) by brute force scanning m values 0..31
  for (let tryM = 0; tryM <= 31; tryM++) {
    const metaBits = 5 + 1 + 4 + 4;
    // test cursor assuming minimal multiBits = 0: get a candidate m from the code by shifting right by (multiBits + 9) = metaBits -5?
    // Instead, we compute candidate m by extracting bits at positions >= ???  Because the multiBits is variable, a deterministic unpack needs storing multiBits.
    // For simplicity we will require that unpackFormat2 be used only for codes that were created by attemptPackFormat2 and returned the meta data.
    throw new Error('unpackFormat2: full unpack is not implemented in prototype; use attemptPackFormat2 result to keep meta.');
  }
}

module.exports = {
  attemptPackFormat2,
  unpackFormat2,
  canonicalizeFEN
};
