'use strict';
// Micro-benchmark: how long chess.js move generation takes for various FENs
const { Chess } = require('chess.js');

function ensureSix(f4) {
  const p = f4.trim().split(/\s+/);
  return p.length >= 6 ? f4 : `${p[0]} ${p[1]} ${p[2]} ${p[3]} 0 1`;
}

const SAMPLES = [
  // Opening position
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
  // Midgame rich position
  'r1bq1rk1/ppp2ppp/2n1pn2/3p4/3P4/2P1PN2/PP3PPP/RNBQ1RK1 w - -',
  // In-check position
  'rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq -',
  // Endgame
  '8/8/2k5/8/8/2K5/8/6R1 w - -',
  // Tactics-heavy
  'r1bqk2r/pppp1ppp/2n2n2/2b1p3/4P3/2NP1N2/PPP2PPP/R1BQKB1R w KQkq -'
];

function timeMovegen(fen4, iterations = 500) {
  const F = ensureSix(fen4);
  const ch = new Chess(F);
  // warmup
  for (let i = 0; i < 50; i++) ch.moves({ verbose: true });
  const t0 = process.hrtime.bigint();
  let total = 0;
  for (let i = 0; i < iterations; i++) {
    const mv = ch.moves({ verbose: true });
    total += mv.length;
  }
  const dt = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms: dt, iters: iterations, avgMs: dt / iterations, avgMoves: total / iterations };
}

(async function main(){
  const iterations = process.env.ITER || 500;
  const results = [];
  for (const fen of SAMPLES) {
    const r = timeMovegen(fen, iterations);
    results.push({ fen, ...r });
  }
  console.log(JSON.stringify({ iterations, results }, null, 2));
})();
