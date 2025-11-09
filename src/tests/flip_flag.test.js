'use strict';
const path = require('path');
const { Worker } = require('worker_threads');
const { Chess } = require('chess.js');

// Increase timeout slightly; we'll reduce search depth for speed
jest.setTimeout(30000);

function runWithFlip(fen4, depth, flip) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, '..', 'engine', 'worker.js');
    const prevRand = process.env.ENABLE_MOVE_RANDOMNESS;
    process.env.ENABLE_MOVE_RANDOMNESS = '0';
    // Pass flip explicitly to workerData to avoid env race
    const worker = new Worker(workerPath, { workerData: { flip } });
    const id = Math.floor(Math.random() * 1e9);
    worker.on('message', (m) => { if (m.id === id) { worker.terminate(); resolve(m); } });
    worker.on('error', (e) => { worker.terminate(); reject(e); });
    worker.postMessage({ type: 'search', id, fen4, depth, verbose: true, maxTimeMs: 3500 });
    // restore randomness flag
    process.env.ENABLE_MOVE_RANDOMNESS = prevRand;
  });
}

// Helper: find best and worst moves from verbose PV arrays (needs scored lines). We only get top & worst lines, so we infer extremes.
// We instead rerun at FLIP=1 and FLIP=-1 and confirm different choices and that the -1 choice's score is near bottom range.

function isWhiteToMove(fen4) { return fen4.split(' ')[1] === 'w'; }

// Build specific tactical positions via short SAN sequences for determinism
function fenAfterSans(sans) {
  const c = new Chess();
  for (const s of sans) c.move(s, { sloppy: true });
  return c.fen().split(' ').slice(0,4).join(' ');
}
// White non-mating middlegame starter: 1.e4 e5 2.Nf3 Nc6
const POS_WHITE = fenAfterSans(['e4','e5','Nf3','Nc6']);
// Black to move attacking position: 1.f3 e5 2.g4 (..Qh4# threat)
const POS_BLACK = fenAfterSans(['f3','e5','g4']);

// Alternate search/eval (simple and independent)
function ensureSix(f4){ const p=f4.split(/\s+/); return p.length>=6?f4:`${p[0]} ${p[1]} ${p[2]} ${p[3]} 0 1`; }
function flipSide(f4, side){ const p=f4.split(/\s+/); return `${p[0]} ${side} ${p[2]} -`; }
function altEvalWhiteCentric(fen4){
  const c = new Chess(ensureSix(fen4));
  const val = { p:1,n:3,b:3,r:5,q:9,k:0 };
  let w=0,b=0;
  for (const row of c.board()) for (const sq of row) if (sq){ const v=val[sq.type]||0; if (sq.color==='w') w+=v; else b+=v; }
  let score = w-b;
  const mW = new Chess(ensureSix(flipSide(fen4,'w'))).moves().length;
  const mB = new Chess(ensureSix(flipSide(fen4,'b'))).moves().length;
  score += (mW - mB) * 0.03;
  if (c.turn()==='w' && c.isCheck()) score -= 0.2; if (c.turn()==='b' && c.isCheck()) score += 0.2;

  // Early king move penalty if king left start while castling rights remain (mirror production behavior roughly)
  const parts = fen4.split(/\s+/); const rights = parts[2] || '-';
  let wKing=null,bKing=null; for (const row of c.board()) for (const sq of row) if (sq){ if (sq.type==='k' && sq.color==='w') wKing=sq.square; if (sq.type==='k' && sq.color==='b') bKing=sq.square; }
  const wRightsRemain = rights.includes('K') || rights.includes('Q');
  const bRightsRemain = rights.includes('k') || rights.includes('q');
  if (wKing && wKing !== 'e1' && wRightsRemain) score -= 3.0;
  if (bKing && bKing !== 'e8' && bRightsRemain) score += 3.0;

  // Minor development: penalize back-rank minors on start squares (small)
  function hasPiece(square, type, color){ for(const row of c.board()) for(const sq of row) if(sq && sq.square===square && sq.type===type && sq.color===color) return true; return false; }
  const whiteStarts = [['b1','n'],['g1','n'],['c1','b'],['f1','b']];
  const blackStarts = [['b8','n'],['g8','n'],['c8','b'],['f8','b']];
  // Mirror production: increased penalty (+50%) for undeveloped minors
  for (const [sq,t] of whiteStarts) if (hasPiece(sq,t,'w')) score -= 0.075;
  for (const [sq,t] of blackStarts) if (hasPiece(sq,t,'b')) score += 0.075;

  // Queen immediate capture heuristic: penalize if queen can be taken right away by opponent
  function findSquare(type, color){ for(const row of c.board()) for(const x of row) if(x && x.type===type && x.color===color) return x.square; return null; }
  const wQ = findSquare('q','w'); const bQ = findSquare('q','b');
  if (wQ){ const enemy = new Chess(ensureSix(flipSide(fen4,'b'))); const cap = enemy.moves({verbose:true}).some(m=>m.to===wQ && m.flags && m.flags.includes('c')); if (cap) score -= 6.0; }
  if (bQ){ const enemy = new Chess(ensureSix(flipSide(fen4,'w'))); const cap = enemy.moves({verbose:true}).some(m=>m.to===bQ && m.flags && m.flags.includes('c')); if (cap) score += 6.0; }
  return +score.toFixed(2);
}
function orderMovesSimple(c){
  const val={ p:1,n:3,b:3,r:5,q:9,k:99};
  return c.moves({verbose:true}).sort((a,b)=>{
    const ac=a.captured?1:0, bc=b.captured?1:0; if (ac!==bc) return bc-ac;
    if (ac){ const as=(val[a.captured]||0)-(val[a.piece]||0); const bs=(val[b.captured]||0)-(val[b.piece]||0); return bs-as; }
    return 0;
  });
}
function altNegamax(fen4, depth, alpha=-Infinity, beta=Infinity){
  const c=new Chess(ensureSix(fen4));
  if (depth<=0) return { score: altEvalWhiteCentric(fen4), pv: [] };
  if (c.isCheckmate()) return { score: -100000, pv: [] };
  if (c.isDraw()) return { score: 0, pv: [] };
  let best=-Infinity, pvBest=[];
  for (const m of orderMovesSimple(c)){
    const c2=new Chess(ensureSix(fen4));
    const made=c2.move({from:m.from,to:m.to,promotion:m.promotion||'q'}); if(!made) continue;
    const child=c2.fen().split(' ').slice(0,4).join(' ');
    const r=altNegamax(child, depth-1, -beta, -alpha);
    const s=-r.score;
    if (s>best){ best=s; pvBest=[made.san, ...r.pv]; }
    if (s>alpha) alpha=s; if (alpha>=beta) break;
  }
  return { score: best, pv: pvBest };
}
function altRootAll(fen4, depth){
  const c=new Chess(ensureSix(fen4));
  const out=[];
  for (const m of orderMovesSimple(c)){
    const c2=new Chess(ensureSix(fen4)); const made=c2.move({from:m.from,to:m.to,promotion:m.promotion||'q'}); if(!made) continue;
    const child=c2.fen().split(' ').slice(0,4).join(' ');
    const r=altNegamax(child, depth-1);
    out.push({ uci: m.from+m.to+(m.promotion||''), score: -r.score });
  }
  out.sort((a,b)=>b.score-a.score);
  return out;
}

describe('FLIP environment flag root selection', () => {
  test('White to move: FLIP=1 picks higher-ranked than FLIP=-1 (color-symmetric)', async () => {
    const alt = altRootAll(POS_WHITE, 2);
    expect(alt.length).toBeGreaterThan(3);
    const wBest = await runWithFlip(POS_WHITE, 2, 1);
    const wWorst = await runWithFlip(POS_WHITE, 2, -1);
    expect(wBest.ok).toBe(true); expect(wWorst.ok).toBe(true);
    const rankBest = alt.findIndex(m => m.uci === wBest.best);
    const rankWorst = alt.findIndex(m => m.uci === wWorst.best);
    // FLIP inversion property: FLIP=1 choice should rank strictly better than FLIP=-1
    expect(rankBest).toBeGreaterThanOrEqual(0);
    expect(rankWorst).toBeGreaterThanOrEqual(0);
    expect(rankBest).toBeLessThan(rankWorst);
  });

  test('Black to move: FLIP=1 picks higher-ranked than FLIP=-1 (color-symmetric)', async () => {
    const alt = altRootAll(POS_BLACK, 2);
    expect(alt.length).toBeGreaterThan(3);
    const bBest = await runWithFlip(POS_BLACK, 2, 1);
    const bWorst = await runWithFlip(POS_BLACK, 2, -1);
    expect(bBest.ok).toBe(true); expect(bWorst.ok).toBe(true);
    const rankBest = alt.findIndex(m => m.uci === bBest.best);
    const rankWorst = alt.findIndex(m => m.uci === bWorst.best);
    expect(rankBest).toBeGreaterThanOrEqual(0);
    expect(rankWorst).toBeGreaterThanOrEqual(0);
    expect(rankBest).toBeLessThan(rankWorst);
  });
});
