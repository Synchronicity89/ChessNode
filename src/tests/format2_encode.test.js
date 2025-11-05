const { encodePosition } = require('../format2_encode');

describe('format2_encode demo', () => {
  test('encodes simple position with WK on e1, BK on a1, pawns on e2/e3', () => {
    const idx = encodePosition({ whiteKing: 60, whitePawn: [52, 53], blackKing: 0 });
    expect(typeof idx).toBe('bigint');
    // monotonicity sanity: adding a square earlier in ordering should reduce index
    const idx2 = encodePosition({ whiteKing: 60, whitePawn: [52], blackKing: 0 });
    expect(idx2).toBeLessThan(idx);
  });
});
