#!/usr/bin/env node
// Engine (white) vs Stockfish (black) from given promotion race FEN.
// Record Stockfish evaluation after every position. Detect the first white move
// that produces a large advantage or forced mate for black when black becomes to move.
// Output the decision FEN (before white's fatal move) and details.

const { spawnSync, spawn } = require('child_process');
const path = require('path');

const START_FEN = process.argv[2] || '7k/7P/7P/7P/7p/7p/7p/7K w - - 0 4'; // starting scenario
const ENGINE_DEPTH = parseInt(process.argv[3] || '8',10);      // depth for our engine white moves
const STOCKFISH_PLAY_DEPTH = parseInt(process.argv[4] || '4',10); // depth for Stockfish black moves (fast)
const STOCKFISH_EVAL_DEPTH = parseInt(process.argv[5] || '10',10); // depth for evaluation of each position
const MAX_PLIES = parseInt(process.argv[6] || '160',10);
const BLUNDER_CP_THRESHOLD = parseInt(process.argv[7] || '200',10); // threshold for first significant advantage to black after white move

const engineBuildDir = process.platform === 'win32'
  ? 'engine\\build\\Release'
  : 'engine/build';
const chooseExe = process.platform === 'win32' ? 'choose_best_move_cli.exe' : 'choose_best_move_cli';
const applyExe = process.platform === 'win32' ? 'apply_move_cli.exe' : 'apply_move_cli';

function runChooseBestJSON(fen, depth){
  const res = spawnSync(`${engineBuildDir}\\${chooseExe}`, [fen, String(depth)], { encoding:'utf8' });
  if(res.error) throw res.error;
  const out = res.stdout.trim();
  if(!out) throw new Error('Empty choose_best output');
  return out;
}
function parseBestMove(jsonStr){
  try { const o = JSON.parse(jsonStr); return (o && o.best && o.best.uci)? o.best.uci : ''; } catch { return ''; }
}
function runApply(fen, move){
  const res = spawnSync(`${engineBuildDir}\\${applyExe}`, [fen, move], { encoding:'utf8' });
  if(res.error) throw res.error;
  const out = res.stdout.trim();
  if(!out) throw new Error('Empty apply move output');
  if(out.startsWith('{') && out.includes('error')) throw new Error('Illegal move: ' + move);
  return out;
}

function initStockfish(){
  const stockfishJs = path.join(__dirname,'..','node_modules','stockfish','src','stockfish-nnue-16.js');
  const proc = spawn(process.execPath, [stockfishJs], { stdio:['pipe','pipe','inherit'] });
  let ready = false;
  const jobs = [];
  let current = null;
  proc.stdout.on('data', chunk => {
    const text = chunk.toString();
    text.split(/\r?\n/).forEach(line => {
      if(!line) return;
      if(line.startsWith('readyok')){ ready = true; flush(); }
      if(current){
        // Capture info score lines
        const cpMatch = line.match(/info .*score cp (-?\d+)/);
        if(cpMatch){ current.lastScore = { type:'cp', value: parseInt(cpMatch[1],10) }; }
        const mateMatch = line.match(/info .*score mate (-?\d+)/);
        if(mateMatch){ current.lastScore = { type:'mate', value: parseInt(mateMatch[1],10) }; }
        if(line.startsWith('bestmove ')){
          const move = line.split(' ')[1];
          const job = current; current = null;
          job.resolve({ move, score: job.lastScore || null });
          flush();
        }
      }
    });
  });
  function send(cmd){ try { proc.stdin.write(cmd+'\n'); } catch {} }
  function flush(){
    if(current || !ready) return;
    const job = jobs.shift();
    if(!job) return;
    current = job; current.lastScore = null;
    send(`position fen ${job.fen}`);
    send(`go depth ${job.depth}`);
  }
  function getBestWithEval(fen, depth){
    return new Promise(resolve => { jobs.push({ fen, depth, resolve }); flush(); });
  }
  send('uci');
  send('isready');
  return { proc, getBestWithEval };
}

function sideToMove(fen){ return fen.split(' ')[1]; }
function moveIsPromotion(m){ return m && m.length===5 && /[qrbn]$/.test(m); }

async function main(){
  console.log('Start FEN:', START_FEN); // verification
  let sf = initStockfish();
  let fen = START_FEN;
  const log = []; // { ply, side, fenBefore, engineJSON?, move, sfPlayScore?, sfEvalBefore?, sfEvalAfter? }
  let fatalRecord = null; // first large jump after a white move
  let lastDrawnFen = null; // last near-drawn position (white to move) before fatal jump
  for(let ply=1; ply<=MAX_PLIES; ply++){
    const side = sideToMove(fen);
    // Stockfish evaluation BEFORE move (current position)
    const evalBefore = await sf.getBestWithEval(fen, STOCKFISH_EVAL_DEPTH).catch(()=>({score:null, move:null}));
    let move, engineJSON=null, playScore=null;
    if(side==='w'){
      engineJSON = runChooseBestJSON(fen, ENGINE_DEPTH);
      move = parseBestMove(engineJSON);
    } else {
      const r = await sf.getBestWithEval(fen, STOCKFISH_PLAY_DEPTH);
      move = r.move; playScore = r.score;
    }
    if(!move){ console.error('No move produced at ply', ply); break; }
    const nextFen = runApply(fen, move);
    // Evaluate AFTER white move when black to move (potential fatal detection)
    let evalAfter = null;
    if(side==='w'){
      // Evaluate position after white move from black's perspective.
      evalAfter = await sf.getBestWithEval(nextFen, STOCKFISH_EVAL_DEPTH).catch(()=>({score:null}));
      const beforeScore = evalBefore.score; // eval BEFORE white move
      const afterScore = evalAfter.score;   // eval AFTER white move (black to move)
      // Update last drawn fen if beforeScore indicates near equality.
      if(!fatalRecord){
        if(beforeScore && beforeScore.type==='cp' && Math.abs(beforeScore.value) < BLUNDER_CP_THRESHOLD){
          lastDrawnFen = fen; // white to move position still near draw
        }
      }
      if(afterScore && !fatalRecord){
        const isMateGain = afterScore.type==='mate' && afterScore.value > 0; // mate for black
        const cpGain = afterScore.type==='cp' && afterScore.value >= BLUNDER_CP_THRESHOLD;
        if(isMateGain || cpGain){
          fatalRecord = {
            decisionFen: fen,
            chosenMove: move,
            evalBefore: beforeScore,
            evalAfter: afterScore,
            ply,
            lastDrawnFen
          };
        }
      }
    }
    log.push({ ply, side, fenBefore: fen, move, fenAfter: nextFen, engineJSON, sfEvalBefore: evalBefore.score, sfEvalAfter: evalAfter? evalAfter.score : null });
    if(side==='b' && moveIsPromotion(move)){
      console.log('Black promotion at ply', ply, 'move', move);
      break;
    }
    fen = nextFen;
  }
  try { sf.proc.stdin.write('quit\n'); sf.proc.kill(); } catch {}

  // Output summary
  console.log('\nTrace Summary (ply, side, move, evalBefore, evalAfter):');
  for(const r of log){
    const eb = r.sfEvalBefore ? (r.sfEvalBefore.type + ':' + r.sfEvalBefore.value) : 'null';
    const ea = r.sfEvalAfter ? (r.sfEvalAfter.type + ':' + r.sfEvalAfter.value) : '-';
    console.log(`${r.ply}\t${r.side}\t${r.move}\t${eb}\t${ea}`);
  }
  if(fatalRecord){
    console.log('\nFirst blunder detected:');
    console.log('Ply:', fatalRecord.ply);
    console.log('Decision FEN (white to move before blunder):');
    console.log(fatalRecord.decisionFen);
    console.log('At decision FEN, white played:', fatalRecord.chosenMove);
    console.log('Eval before:', fatalRecord.evalBefore ? `${fatalRecord.evalBefore.type}:${fatalRecord.evalBefore.value}` : 'null');
    console.log('Eval after:', `${fatalRecord.evalAfter.type}:${fatalRecord.evalAfter.value}`);
    if(fatalRecord.lastDrawnFen){
      console.log('\nLast drawn position (earlier, white to move) before blunder (no move applied here):');
      console.log(fatalRecord.lastDrawnFen);
    } else {
      console.log('\nNo earlier drawn position recorded (jump occurred immediately).');
    }
  } else {
    console.log('\nNo blunder detected (threshold not crossed).');
  }
}

main().catch(e=>{ console.error('Unhandled error:', e); process.exit(1); });