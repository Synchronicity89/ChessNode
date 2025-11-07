const { extractPositionsFromPGN } = require('../lichessDownloader');

function fourField(fen) {
  const parts = fen.trim().split(/\s+/);
  return parts.slice(0, 4).join(' ');
}

describe('PGN -> positions integration', () => {
  test('standard game from initial position yields positions including start and final', () => {
    const pgn = [
      '[Event "Test Game"]',
      '[Site "Local"]',
      '[Date "2025.11.06"]',
      '[Round "-"]',
      '[White "Alice"]',
      '[Black "Bob"]',
      '[Result "1-0"]',
      '',
      '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0',
      ''
    ].join('\n');

    const { Chess } = require('chess.js');
    const ref = new Chess();
    const expected = new Set();
    expected.add(fourField(ref.fen()));
    const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'];
    for (const san of sans) {
      const mv = ref.move(san);
      expect(mv).toBeTruthy();
      expected.add(fourField(ref.fen()));
    }

    const { fens, stats } = extractPositionsFromPGN(pgn);
  expect(stats.variantSkip).toBe(0);
  expect(stats.nonInitialFENSkip).toBe(0);
  expect(stats.parseFail).toBe(0);
    // We expect at least start + number of plies positions captured
    expect(fens.length).toBeGreaterThanOrEqual(expected.size);

    const got = new Set(fens);
    for (const fen of expected) {
      expect(got.has(fen)).toBe(true);
    }
  });

  test('From Position game is skipped (non-initial FEN)', () => {
    const { Chess } = require('chess.js');
    const ref = new Chess();
    // Make a single move to produce a non-initial FEN
    ref.move('e4');
    const nonInitial = fourField(ref.fen());

    const pgn = [
      '[Event "From Position Test"]',
      '[Site "Local"]',
      '[Date "2025.11.06"]',
      '[Round "-"]',
      '[White "Alice"]',
      '[Black "Bob"]',
      '[Result "*"]',
      '[Variant "Standard"]',
      '[SetUp "1"]',
      `[FEN "${nonInitial} 0 1"]`,
      '',
      '1. d4 *',
      ''
    ].join('\n');

    const { fens, stats } = extractPositionsFromPGN(pgn);
    expect(fens.length).toBe(0);
    expect(stats.nonInitialFENSkip).toBe(1);
  });
});
