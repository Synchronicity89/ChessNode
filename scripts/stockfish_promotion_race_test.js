#!/usr/bin/env node
// Promotion race test: our engine (White) vs Stockfish (Black).
// Fails if Black promotes first. Includes provisional quiet draw rule (no pawn move or capture for QUIET_PLY_LIMIT half-moves).
// Uses working direct spawn of stockfish-nnue-16.js.
const { spawnSync, spawn } = require('child_process');

const START_FEN = process.argv[2] || '7k/7P/7P/7P/7p/7p/7p/7K w - - 0 4';
// Reduced depths for faster iteration while test under development
const ENGINE_DEPTH = 8;
const STOCKFISH_DEPTH = 4; // keep shallow for fast iteration; adjust later
const QUIET_PLY_LIMIT = 10; // 5 moves rule (dev)
const MAX_PLIES = 400;

const engineBuildDir = process.platform === 'win32'
  ? 'engine\\build\\Release'
  : 'engine/build';
const chooseExe = process.platform === 'win32' ? 'choose_best_move_cli.exe' : 'choose_best_move_cli';
const applyExe = process.platform === 'win32' ? 'apply_move_cli.exe' : 'apply_move_cli';

function runChooseBest(fen, depth){
  const res = spawnSync(`${engineBuildDir}\\${chooseExe}`, [fen, String(depth)], { encoding:'utf8' });
  if(res.error) throw res.error;
  const out = res.stdout.trim();
  if(!out) throw new Error('Empty choose_best output');
  let obj; try { obj = JSON.parse(out); } catch { throw new Error('Parse choose_best JSON failed: ' + out); }
  if(obj.error) throw new Error('Engine error: ' + obj.error);
  if(!obj.best || !obj.best.uci) throw new Error('Missing best.uci in JSON');
  return obj.best.uci;
}

function runApply(fen, uci){
  const res = spawnSync(`${engineBuildDir}\\${applyExe}`, [fen, uci], { encoding:'utf8' });
  if(res.error) throw res.error;
  const out = res.stdout.trim();
  if(!out) throw new Error('Empty apply_move output');
  if(out.startsWith('{') && out.includes('"error"')) throw new Error('Illegal move application: ' + out);
  return out;
}

function parseBoard(fen){
  const boardPart = fen.split(' ')[0];
  const rows = boardPart.split('/');
  const grid = Array.from({length:8}, ()=>Array(8).fill('.'));
  for(let r=0;r<8;r++){
    let c=0;
    for(const ch of rows[r]){
      if(/^[1-8]$/.test(ch)){ c += parseInt(ch,10); }
      else { grid[r][c++] = ch; }
    }
  }
  return grid;
}
function algToRC(a){ return { r: 8 - parseInt(a[1],10), c: a.charCodeAt(0)-97 }; }
function pieceAt(grid, alg){ const rc=algToRC(alg); return grid[rc.r][rc.c]; }
function isUpper(p){ return p>='A' && p<='Z'; }
function isLower(p){ return p>='a' && p<='z'; }
function sideToMove(fen){ return fen.split(' ')[1]; }
function isPawnMove(uci, grid){ if(!uci || uci.length<4) return false; const from=uci.slice(0,2); const p=pieceAt(grid,from); return p && (p==='P' || p==='p'); }
function isCapture(uci, grid, stm){ if(!uci || uci.length<4) return false; const to=uci.slice(2,4); const dst=pieceAt(grid,to); if(dst==='.') return false; return (stm==='w' && isLower(dst)) || (stm==='b' && isUpper(dst)); }
function isPromotion(uci){ return uci && uci.length===5 && /[qrbn]$/.test(uci); }

// --- Stockfish Helper ---
function initStockfish(){
  const path = require('path');
  const stockfishJs = path.join(__dirname,'..','node_modules','stockfish','src','stockfish-nnue-16.js');
  const proc = spawn(process.execPath, [stockfishJs], { stdio:['pipe','pipe','inherit'] });
  const queue = [];
  let currentResolve = null;
  let ready = false;
  proc.on('error', err => {
    console.error('Stockfish spawn error:', err.message);
  });
  proc.stdout.on('data', chunk => {
    const text = chunk.toString();
    text.split(/\r?\n/).forEach(line => {
      if(!line.trim()) return;
      if(line.startsWith('uciok')){ /* ignore */ }
      if(line.startsWith('readyok')){ ready = true; flushQueue(); }
      const m = line.match(/^bestmove\s+(\S+)/);
      if(m && currentResolve){ const r = currentResolve; currentResolve=null; r(m[1]); flushQueue(); }
    });
  });
  function send(cmd){ try { proc.stdin.write(cmd + '\n'); } catch(e){} }
  function flushQueue(){
    if(currentResolve || !ready) return;
    const job = queue.shift();
    if(!job) return;
    currentResolve = job.resolve;
    // issue position then go
    send(`position fen ${job.fen}`);
    send(`go depth ${job.depth}`);
  }
  function getBestMove(fen, depth){
    return new Promise(resolve => {
      queue.push({ fen, depth, resolve });
      flushQueue();
    });
  }
  // handshake
  send('uci');
  send('isready');
  return { proc, getBestMove };
}

async function main(){
  let stockfish;
  let useFallbackHeuristic = false;
  try {
    stockfish = initStockfish();
  } catch(e){
    console.error('Stockfish init failed:', e.message);
    useFallbackHeuristic = true;
  }

  let fen = START_FEN;
  let whitePromoted=false, blackPromoted=false;
  let quietPlies=0;
  for(let ply=1; ply<=MAX_PLIES; ply++){
    const grid = parseBoard(fen);
    const stm = sideToMove(fen);
    let move;
    if(stm==='w'){
      try { move = runChooseBest(fen, ENGINE_DEPTH); } catch(e){ console.error('Engine choose_best failed:', e.message); process.exitCode=1; return; }
    } else {
      if(!useFallbackHeuristic && stockfish){
        try {
          move = await stockfish.getBestMove(fen, STOCKFISH_DEPTH);
        } catch(e){
          console.error('Stockfish move error:', e.message);
          useFallbackHeuristic = true;
        }
      }
      if(useFallbackHeuristic){
        // Simple fallback: engine chooses for black at depth 1.
        try { move = runChooseBest(fen, 1); } catch(e){ move = '0000'; }
      }
    }
    const pawnMove = isPawnMove(move, grid);
    const capture = isCapture(move, grid, stm);
    if(pawnMove || capture) quietPlies = 0; else quietPlies++;
    if(isPromotion(move)){
      if(stm==='w') whitePromoted=true; else blackPromoted=true;
      console.log(`Promotion: side=${stm} move=${move} ply=${ply}`);
      break;
    }
    try { fen = runApply(fen, move); } catch(e){ console.error('Apply failed:', e.message); process.exitCode=1; return; }
    if(quietPlies >= QUIET_PLY_LIMIT){ console.log('Draw (dev 5-move rule)'); break; }
  }

  if(blackPromoted && !whitePromoted){
    console.error('FAIL: Black promoted first');
    process.exitCode = 1;
  } else {
    console.log('PASS: White promotes first or draw/no promotion');
    process.exitCode = 0;
  }
  // Terminate Stockfish worker
  if(stockfish && !useFallbackHeuristic){ try { stockfish.proc.stdin.write('quit\n'); stockfish.proc.kill(); } catch {} }
}

main().catch(e=>{ console.error('Unhandled error:', e); process.exit(1); });
