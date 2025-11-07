'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// We key the book by canonical 4-field FEN strings to avoid unstable encodings

function ensureSixFieldFEN(fen4) {
  // Produce a 6-field FEN acceptable to chess.js
  const parts = fen4.trim().split(/\s+/);
  // FEN 4-field is: board active castling ep
  // We add halfmove clock=0 and fullmove number=1 (best-effort)
  if (parts.length >= 6) return fen4;
  if (parts.length === 4) return `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]} 0 1`;
  throw new Error('Invalid FEN (expected 4 fields)');
}

class OpeningBook {
  constructor(dataDir) {
    this.dataDir = dataDir || path.resolve(__dirname, '..', 'data', 'game_positions');
    this.bookPath = path.join(this.dataDir, 'global.moves.json');
    this.book = null; // lazy-loaded map: key -> { total, moves: [{uci,to,count}] }
    this._mtimeMs = 0;
    this.indexPath = path.join(this.dataDir, 'global.index');
    this._indexSet = null; // Set of sha1(fen4)
  }

  load() {
    // Reload if file changed since last read
    try {
      const st = fs.statSync(this.bookPath);
      const m = st.mtimeMs || st.mtime.getTime();
      if (!this.book || m !== this._mtimeMs) {
        const raw = fs.readFileSync(this.bookPath, 'utf8');
        this.book = JSON.parse(raw || '{}');
        this._mtimeMs = m;
      }
      return this.book || {};
    } catch (_e) {
      // On first load if file doesn't exist, keep an empty book
      this.book = this.book || {};
      return this.book;
    }
  }

  loadIndex() {
    if (this._indexSet) return this._indexSet;
    try {
      const raw = fs.readFileSync(this.indexPath, 'utf8');
      const lines = raw.split(/\r?\n/).filter(Boolean);
      this._indexSet = new Set(lines.map((l) => l.trim()));
    } catch (_e) {
      this._indexSet = new Set();
    }
    return this._indexSet;
  }

  existsFen(fen4) {
    // Use global.index (sha1 of FEN) to check presence in the positions DB quickly
    const h = crypto.createHash('sha1').update(fen4).digest('hex');
    const idx = this.loadIndex();
    return idx.has(h);
  }

  getCandidatesForFen(fen4) {
    // Returns a UCI move string or null
    const key = fen4; // use fen4 directly as key
    const book = this.load();
    const entry = book[key];
    if (!entry || !entry.moves || entry.moves.length === 0) return [];
    // Filter to legal moves just in case
    let candidates = entry.moves;
    try {
      const { Chess } = require('chess.js');
      const chess = new Chess(ensureSixFieldFEN(fen4));
      const legal = new Set(chess.moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || '')));
      candidates = candidates.filter(m => legal.has(m.uci));
      if (candidates.length === 0) return [];
    } catch (_e) {
      // If legality check fails for some reason, proceed with unfiltered candidates
    }
    return candidates;
  }

  pickMoveForFen(fen4, mode = 'weighted') {
    const candidates = this.getCandidatesForFen(fen4);
    if (!candidates || candidates.length === 0) return null;

    if (mode === 'popular') {
      let best = candidates[0];
      for (const c of candidates) if (c.count > best.count) best = c;
      return best.uci;
    }
    // weighted random by count
    const total = candidates.reduce((s, c) => s + c.count, 0);
    let r = Math.random() * total;
    for (const c of candidates) {
      if ((r -= c.count) <= 0) return c.uci;
    }
    return candidates[candidates.length - 1].uci;
  }
}

module.exports = { OpeningBook };
