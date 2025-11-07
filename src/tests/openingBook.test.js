const fs = require('fs');
const path = require('path');
const os = require('os');
const { Chess } = require('chess.js');
const { OpeningBook } = require('../openingBook');

function fourField(fen) {
  const parts = fen.trim().split(/\s+/);
  return parts.slice(0, 4).join(' ');
}


describe('OpeningBook early opening selections', () => {
  test('After 1.e4 Nc6 2.d4 (black to move), book suggests common replies', () => {
    // Build the target position
    const ch = new Chess();
    ch.move('e4'); // 1. e4
    ch.move('Nc6'); // ... Nc6
    ch.move('d4'); // 2. d4
    const fen4 = fourField(ch.fen());

    // Candidate black replies we expect the book to propose
    const expectedUCIs = ['e7e5', 'd7d5'];

    // Build a temporary opening book with these replies
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'booktest-'));
    const dataDir = path.join(tmp, 'game_positions');
    fs.mkdirSync(dataDir, { recursive: true });

  const fromKey = fen4;

    const moves = [];
    let total = 0;
    for (const uci of expectedUCIs) {
      const next = new Chess();
      // Recreate the target position to apply the UCI move
      next.move('e4');
      next.move('Nc6');
      next.move('d4');
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promo = uci.slice(4) || undefined;
      const applied = next.move({ from, to, promotion: promo || 'q' });
      expect(applied).toBeTruthy();
      const toFen4 = fourField(next.fen());
  const toKey = toFen4;
      moves.push({ uci, to: toKey, count: 10 });
      total += 10;
    }

    const bookPath = path.join(dataDir, 'global.moves.json');
  const bookObj = { [fromKey]: { total, moves } };
    fs.writeFileSync(bookPath, JSON.stringify(bookObj), 'utf8');

    const book = new OpeningBook(dataDir);
  // Sanity: legal moves should include our expected UCIs
  const fen6 = `${fen4} 0 1`;
  const legal = new Set(new Chess(fen6).moves({ verbose: true }).map(m => m.from + m.to + (m.promotion || '')));
  for (const u of expectedUCIs) expect(legal.has(u)).toBe(true);

  // The raw book should have an entry for this position
  const raw = book.load();
  expect(Object.prototype.hasOwnProperty.call(raw, fromKey)).toBe(true);
  expect(raw[fromKey].moves.length).toBeGreaterThan(0);

  // Should find candidates
    const cands = book.getCandidatesForFen(fen4);
    expect(cands.length).toBeGreaterThan(0);
    const candUCIs = new Set(cands.map(c => c.uci));
    for (const u of expectedUCIs) expect(candUCIs.has(u)).toBe(true);

    // Random picks should always be one of the expected UCIs
    for (let i = 0; i < 200; i++) {
      const pick = book.pickMoveForFen(fen4, 'weighted');
      expect(expectedUCIs.includes(pick)).toBe(true);
    }
  });
});
