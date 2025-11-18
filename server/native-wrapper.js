// Loads the native addon once and exposes simple functions.
const path = require('path');

let addon = null;
function loadAddon() {
  if (addon) return addon;
  try {
    const p = path.join(__dirname, 'native-addon', 'build', 'Release', 'engine_addon.node');
    addon = require(p);
    return addon;
  } catch (e) {
    console.error('[native-wrapper] Failed to load addon. Build it with:');
    console.error('  npm run build:addon');
    throw e;
  }
}

function chooseMove(fen, depth=3) {
  return loadAddon().choose(fen, depth);
}

function perft(fen, depth) {
  return loadAddon().perft(fen, depth);
}

function legalMoves(fen) {
  return loadAddon().legalMoves(fen);
}

module.exports = { chooseMove, perft, legalMoves };
