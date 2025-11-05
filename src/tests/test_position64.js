// tests/test_position64.js
const pos64 = require('../position64');

const fens = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -', // startpos
  '8/8/8/8/8/8/8/8 w - -', // empty
  '8/8/8/8/8/8/8/K6k w - -', // two kings only
  'r1bqkbnr/pppppppp/2n5/8/8/2N5/PPPPPPPP/R1BQKBNR w KQkq -' // few pieces
];

for (const fen of fens) {
  console.log('FEN:', fen);
  const res = pos64.attemptPackFormat2(fen);
  console.log('pack:', res.ok, res.reason || '', res.meta ? JSON.stringify(res.meta) : '');
  console.log('---');
}
