#!/usr/bin/env node
// Trace promotion race until black promotes; capture FEN before white's fatal move.
// Then evaluate that FEN with engine candidate scores.

const { spawnSync, spawn } = require('child_process');
const path = require('path');

const START_FEN = process.argv[2] || '7k/7P/7P/7P/7p/7p/7p/7K w - - 0 4';
const ENGINE_DEPTH = 8; // engine depth for white during trace
const STOCKFISH_DEPTH = 4; // shallow for speed
const EVAL_DEPTH = 8; // depth for post-mortem evaluation of white decision position
const MAX_PLIES = 200;

const engineBuildDir = process.platform === 'win32'
  ? 'engine\\build\\Release'
  : 'engine/build';
const chooseExe = process.platform === 'win32' ? 'choose_best_move_cli.exe' : 'choose_best_move_cli';
const applyExe = process.platform === 'win32' ? 'apply_move_cli.exe' : 'apply_move_cli';

function runChooseBestRaw(fen, depth){
  const res = spawnSync(`${engineBuildDir}\\${chooseExe}`, [fen, String(depth)], { encoding:'utf8' });
  if(res.error) throw res.error;
  const out = res.stdout.trim();
  if(!out) throw new Error('Empty choose_best output');
  return out;
}
function runChooseBestMove(fen, depth){
  const out = runChooseBestRaw(fen, depth);
  let obj; try { obj = JSON.parse(out); } catch { throw new Error('Parse choose_best JSON failed: ' + out); }
  if(obj.error) throw new Error('Engine error: ' + obj.error);
  if(!obj.best || !obj.best.uci) throw new Error('Missing best.uci');
  return obj.best.uci;
}
function runApply(fen, uci){
  const res = spawnSync(`${engineBuildDir}\\${applyExe}`, [fen, uci], { encoding:'utf8' });
  if(res.error) throw res.error;
  const out = res.stdout.trim();
  if(!out) throw new Error('Empty apply_move output');
  if(out.startsWith('{') && out.includes('error')) throw new Error('Illegal move application: ' + out);
  return out;
}

function initStockfish(){
  const stockfishJs = path.join(__dirname,'..','node_modules','stockfish','src','stockfish-nnue-16.js');
  const proc = spawn(process.execPath, [stockfishJs], { stdio:['pipe','pipe','inherit'] });
  const queue = [];
  let currentResolve = null;
  let ready = false;
  proc.stdout.on('data', chunk => {
    const text = chunk.toString();
    text.split(/\r?\n/).forEach(line => {
      if(!line.trim()) return;
      if(line.startsWith('uciok')) return;
      if(line.startsWith('readyok')){ ready = true; flush(); return; }
      const m = line.match(/^bestmove\s+(\S+)/);
      if(m && currentResolve){ const r = currentResolve; currentResolve=null; r(m[1]); flush(); }
    });
  });
  function send(cmd){ try { proc.stdin.write(cmd+'\n'); } catch {} }
  function flush(){
    if(currentResolve || !ready) return;
    const job = queue.shift();
    if(!job) return;
    currentResolve = job.resolve;
    send(`position fen ${job.fen}`);
    send(`go depth ${job.depth}`);
  }
  function getBestMove(fen, depth){
    return new Promise(resolve => { queue.push({ fen, depth, resolve }); flush(); });
  }
  send('uci');
  send('isready');
  return { proc, getBestMove };
}

function sideToMove(fen){ return fen.split(' ')[1]; }
function isPromotion(uci){ return uci && uci.length===5 && /[qrbn]$/.test(uci); }

async function trace(){
  let stockfish;
  try { stockfish = initStockfish(); } catch(e){ console.error('Stockfish init failed:', e.message); return; }
  let fen = START_FEN;
  let history = []; // {ply, side, fenBefore, move, fenAfter}
  for(let ply=1; ply<=MAX_PLIES; ply++){
    const side = sideToMove(fen);
    let move;
    if(side==='w'){
      try { move = runChooseBestMove(fen, ENGINE_DEPTH); } catch(e){ console.error('Engine choose failed:', e.message); break; }
    } else {
      try { move = await stockfish.getBestMove(fen, STOCKFISH_DEPTH); } catch(e){ console.error('Stockfish move failed:', e.message); break; }
    }
    const nextFen = runApply(fen, move);
    history.push({ ply, side, fenBefore: fen, move, fenAfter: nextFen });
    if(side==='b' && isPromotion(move)){
      console.log('Black promoted at ply', ply, 'with', move);
      // Identify white fatal move (previous ply) and positions
      const whiteState = history.find(h => h.ply === ply-1 && h.side === 'w');
      if(!whiteState){ console.error('Could not locate white fatal state'); break; }
      console.log('\nFEN before white fatal move (white to move):');
      console.log(whiteState.fenBefore);
      console.log('White chosen move:', whiteState.move);
      console.log('\nFEN after white fatal move (black to move, promotion imminent):');
      console.log(whiteState.fenAfter);
      // Evaluate decision position
      try {
        const evalJsonRaw = runChooseBestRaw(whiteState.fenBefore, EVAL_DEPTH);
        console.log('\nEngine evaluation JSON at decision FEN (depth', EVAL_DEPTH, '):');
        console.log(evalJsonRaw);
      } catch(e){ console.error('Evaluation failed:', e.message); }
      break;
    }
    fen = nextFen;
  }
  try { stockfish.proc.stdin.write('quit\n'); stockfish.proc.kill(); } catch {}
}

trace().catch(e=>{ console.error('Unhandled:', e); process.exit(1); });
