// Usage: node utilities/terminal_debug.js --fen "<FEN>" [--fen "<FEN2>"]
// Provides pseudo vs legal counts and terminal status using EngineBridge.debugTerminal.

function polyfillWindowDocument() {
  if (!global.window) global.window = {};
  if (!global.window.addEventListener) {
    const listeners = {};
    global.window.addEventListener = (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); };
    global.window.dispatchEvent = (evt) => {
      const arr = listeners[evt.type] || [];
      for (const fn of arr) fn(evt);
    };
  }
  if (!global.document) {
    global.document = { createEvent: () => ({ initEvent: function(type){ this.type = type; }, type: '' }) };
  }
  // eslint-disable-next-line no-global-assign
  window = global.window;
}

async function loadEngine() {
  polyfillWindowDocument();
  await import('../web/engine-bridge2.js');
}

function parseArgs() {
  const fens = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fen' && argv[i+1]) { fens.push(argv[i+1]); i++; }
  }
  return fens;
}

(async () => {
  const fens = parseArgs();
  if (!fens.length) {
    console.error('No FEN provided. Use --fen "<FEN>"');
    process.exit(1);
  }
  await loadEngine();
  await new Promise(r => setTimeout(r, 10));
  for (const fen of fens) {
    const info = window.EngineBridge.debugTerminal(fen);
    console.log('\nFEN:', fen);
    console.log('Status:', info.status, 'Pseudo:', info.pseudoCount, 'Legal:', info.legalCount, 'InCheck:', info.inCheck);
  }
})();
