const { Worker } = require('worker_threads');
const path = require('path');
const workerPath = path.join(__dirname, '..', 'src', 'engine', 'worker.js');
const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/5N2/PPPPBPPP/RNBQK2R w KQkq -';
function search(depth=3){
  return new Promise(res=>{
    const w = new Worker(workerPath);
    const id = Math.floor(Math.random()*1e9);
    w.on('message', m=>{ if(m.id===id){ res(m); w.terminate(); }});
    w.postMessage({ type:'search', id, fen4:fen, depth, verbose:true, maxTimeMs:4000 });
  });
}
search(3).then(r=>{
  console.log('bestLines:', r.bestLines);
  if (r.scored) {
    const idx = r.scored.findIndex(m => m.san === 'O-O');
    console.log('O-O index:', idx);
    console.log('top 10:', r.scored.slice(0,10).map(x=>x.san+':'+x.score.toFixed(2)));
  } else {
    console.log('no scored array returned');
  }
});
