'use strict';
const { Chess } = require('chess.js');
const path = require('path');
const { Worker } = require('worker_threads');

const PGN = `
[Event "Local Session"]
[Site "Localhost"]
[Date "2025-11-08"]
[Round "-"]
[White "Human"]
[Black "Engine"]
[Result "*"]

1. e4 Nc6 2. d4 b6 3. d5 Nb8 4. Bc4 c6 5. Qf3 Nh6 6. dxc6 a6 7. Bxh6 f6 8. e5 a5 9. exf6 Qc7 10. fxg7 Qe5+ 11. Ne2 Rg8 12. gxf8=Q+ Rxf8 13. Qxf8# *
`;

function runWorker(fen4, depth, verbose) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '..', 'engine', 'worker.js'));
    const id = Math.floor(Math.random()*1e6);
    // Allow a maxTimeMs budget so iterative deepening completes at least depth 2-3
    const maxTimeMs = 4000; // 4s budget for regression test
    const to = setTimeout(() => { worker.terminate(); reject(new Error('timeout')); }, maxTimeMs + 2000);
    worker.on('message', (m) => { clearTimeout(to); resolve(m); worker.terminate(); });
    worker.on('error', (e) => { clearTimeout(to); reject(e); });
    worker.postMessage({ type: 'search', id, fen4, depth, verbose, maxTimeMs });
  });
}

describe('PGN regression: deep search runs and returns PV', () => {
  test('PGN is legal and search returns PV at key positions', async () => {
  const game = new Chess();
  game.loadPgn(PGN, { sloppy: true });
  expect(game.isCheckmate()).toBe(true);
    // Collect FENs before each black move (engine side in transcript)
    const moves = game.history({ verbose: true });
    const fensBeforeBlack = [];
    const tmp = new Chess();
    tmp.reset();
    // Re-simulate to capture FENs before black moves
    fensBeforeBlack.push(tmp.fen().split(' ').slice(0,4).join(' ')); // before 1... move
    for (const mv of moves) {
      tmp.move({ from: mv.from, to: mv.to, promotion: mv.promotion || 'q' });
      if (tmp.turn() === 'b') {
        fensBeforeBlack.push(tmp.fen().split(' ').slice(0,4).join(' '));
      }
    }
    // Sample a couple of midgame positions (skip startpos, avoid too many threads)
    const sample = fensBeforeBlack.filter((_, idx) => idx === 2).slice(0, 1);
    for (const f4 of sample) {
      const res = await runWorker(f4, 3, true);
      expect(res.ok).toBe(true);
      expect(typeof res.best).toBe('string');
      expect(typeof res.score).toBe('number');
      expect(Array.isArray(res.bestLines)).toBe(true);
      expect(Array.isArray(res.worstLines)).toBe(true);
    }
  }, 15000);
});
