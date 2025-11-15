// Node test to verify engine honors arbitrary searchDepth without clamping.
// Usage: node scripts/test-depth-node.js [depth]
// Requires: a recent build so manual_test_env/engine.js & engine.wasm exist.

const path = require('path');
const fs = require('fs');

(async function main(){
  const depth = Number(process.argv[2]||77);
  const manualEnv = path.resolve(__dirname, '..', 'manual_test_env');
  const candidatePaths = [
    path.join(manualEnv, 'engine.js'),
    path.join(manualEnv, 'web', 'wasm', 'engine.js')
  ];
  const engineJs = candidatePaths.find(p=>fs.existsSync(p));
  if (!engineJs){
    console.error('engine.js not found in manual_test_env. Run the build script first.');
    console.error('Checked paths:\n  ' + candidatePaths.join('\n  '));
    process.exit(1);
  }
  const createModule = require(engineJs);
  const Module = await createModule({});
  const cwrap = Module.cwrap.bind(Module);
  const choose_best_move = cwrap('choose_best_move', 'string', ['string','string']);

  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1';
  const opts = JSON.stringify({ searchDepth: depth, extendOnCapture: true, extendOnCheck: false });
  console.log(`Calling choose_best_move at depth=${depth}...`);
  const t0 = Date.now();
  const res = choose_best_move(startFen, opts);
  const t1 = Date.now();
  try {
    const obj = JSON.parse(res);
    console.log(`Result depth field: ${obj.depth}`);
    console.log(`Best move: ${obj.best && obj.best.uci}`);
    if (obj.depth !== depth){
      console.error(`Depth mismatch: engine reported ${obj.depth}, expected ${depth}.`);
      process.exit(2);
    }
    console.log(`OK: depth echoed correctly. Elapsed ${(t1-t0)} ms`);
  } catch (e){
    console.error('Failed to parse engine result:', e);
    console.error(res);
    process.exit(3);
  }
})();
