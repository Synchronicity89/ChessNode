'use strict';
const { Chess } = require('chess.js');
const path = require('path');
const { Worker } = require('worker_threads');

// Two short mate games provided in conversation; we verify engine search stability
// by sampling one mid-position from each and ensuring a PV is returned.

const PGN_G1 = `
[Event "Local Session"]
[Site "Localhost"]
[Date "2025-11-08"]
[Round "-"]
[White "Human"]
[Black "Engine"]
[Result "*"]

1. e4 Nf6 2. Nc3 c6 3. d4 b6 4. e5 Ng8 5. Bc4 h6 6. Qf3 h5 7. Qxf7# *
`;

const PGN_G2 = `
[Event "Local Session"]
[Site "Localhost"]
[Date "2025-11-08"]
[Round "-"]
[White "Human"]
[Black "Engine"]
[Result "*"]

1. e4 Nf6 2. Nc3 c6 3. Nf3 b6 4. Bc4 a6 5. d4 h6 6. Bf4 Nh5 7. Qd2 c5 8. O-O-O f5 9. Rhe1 Rh7 10. Ne5 b5 11. Bf7# *
`;

const PGN_G3 = `
[Event "Local Session"]
[Site "Localhost"]
[Date "2025-11-08"]
[Round "-"]
[White "Human"]
[Black "Engine"]
[Result "*"]

1. e4 Nf6 2. d4 a6 3. e5 Ng8 4. Nc3 f6 5. Bd3 g6 6. Nf3 Ra7 7. Be3 Ra8 8. Qe2 c6 9. O-O-O g5 10. Rhe1 g4 11. Nh4 Nh6 12. Bxh6 f5 13. Nxf5 c5 14. Qxg4 c4 15. Qh5# *
`;

const PGN_G4 = `
[Event "Local Session"]
[Site "Localhost"]
[Date "2025-11-08"]
[Round "-"]
[White "Human"]
[Black "Engine"]
[Result "*"]

1. e4 Nf6 2. Nc3 c6 3. Nf3 Qa5 4. Bc4 Qxc3 5. bxc3 Nxe4 6. d3 Nxc3 7. Qd2 d5 8. Qxc3 dxc4 9. Qxc4 f5 10. Ne5 b5 11. Qf7+ Kd8 12. Bg5 Kc7 13. Bxe7 Bxe7 14. Qxe7+ Nd7 15. O-O-O a5 16. d4 h5 17. d5 Kb7 18. dxc6+ Kb6 19. cxd7 Ka6 20. d8=Q Rxd8 21. Qxd8 Bb7 22. Rd6+ Bc6 23. Rxc6+ Kb7 24. Qc7# *
`;

function runWorker(fen4, depth, verbose) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '..', 'engine', 'worker.js'));
    const id = Math.floor(Math.random()*1e6);
    const maxTimeMs = 3000; // shorter budget (games are tiny)
    const to = setTimeout(() => { worker.terminate(); reject(new Error('timeout')); }, maxTimeMs + 1500);
    worker.on('message', (m) => { clearTimeout(to); resolve(m); worker.terminate(); });
    worker.on('error', (e) => { clearTimeout(to); reject(e); });
    worker.postMessage({ type: 'search', id, fen4, depth, verbose, maxTimeMs });
  });
}

function sampleMidPositions(pgn) {
  const game = new Chess();
  game.loadPgn(pgn, { sloppy: true });
  const moves = game.history({ verbose: true });
  // Rewind and re-play to collect FEN4 before each black move
  const tmp = new Chess();
  const fens = [];
  fens.push(tmp.fen().split(' ').slice(0,4).join(' '));
  for (const mv of moves) {
    tmp.move({ from: mv.from, to: mv.to, promotion: mv.promotion || 'q' });
    if (tmp.turn() === 'b') fens.push(tmp.fen().split(' ').slice(0,4).join(' '));
  }
  // Choose a middle index if available, else first
  const midIdx = Math.min(Math.floor(fens.length/2), fens.length-1);
  return [fens[midIdx]];
}

describe('Mini mate PGN regression set', () => {
  const samples = [
    ...sampleMidPositions(PGN_G1),
    ...sampleMidPositions(PGN_G2),
    ...sampleMidPositions(PGN_G3),
    ...sampleMidPositions(PGN_G4)
  ];
  for (const f of samples) {
    test(`Search returns PV for mid position ${f}`, async () => {
      const res = await runWorker(f, 3, true);
      expect(res.ok).toBe(true);
      expect(typeof res.best).toBe('string');
      expect(typeof res.score).toBe('number');
      expect(Array.isArray(res.bestLines)).toBe(true);
      expect(Array.isArray(res.worstLines)).toBe(true);
    }, 10000);
  }
});
