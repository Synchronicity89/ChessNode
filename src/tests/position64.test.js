const { attemptPackFormat2, canonicalizeFEN } = require('../position64');

// Utility to ensure code fits in 63 bits (Format 2 payload)
function isWithin63Bits(big) {
  return big >= 0n && big < (1n << 63n);
}

describe('position64: attemptPackFormat2', () => {
  test('start position likely too large for format2', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
    const res = attemptPackFormat2(fen);
    expect(res.ok).toBe(false);
  });

  test('two kings only packs successfully within 63 bits', () => {
    const fen = '8/8/8/8/8/8/8/K6k w - -';
    const res = attemptPackFormat2(fen);
    expect(res.ok).toBe(true);
    expect(isWithin63Bits(res.code)).toBe(true);
    expect(res.meta.m).toBe(2);
  });

  test('few pieces midgame-like position packs or gives clear reason', () => {
    const fen = 'r1bqkbnr/pppppppp/2n5/8/8/2N5/PPPPPPPP/R1BQKBNR w KQkq -';
    const res = attemptPackFormat2(fen);
    if (res.ok) {
      expect(isWithin63Bits(res.code)).toBe(true);
      expect(res.meta.m).toBeGreaterThan(0);
    } else {
      // Either too many pieces or combination index too big for current limits
      expect(['too many pieces for format2 (m>31)', 'combination index too big']).toContain(
        res.reason
      );
    }
  });

  test('canonicalizeFEN keeps structure and fields count', () => {
    const fen = '8/8/8/8/8/8/8/K6k w - -';
    const cf = canonicalizeFEN(fen);
    expect(cf.split(/\s+/).length).toBe(4);
  });
});
