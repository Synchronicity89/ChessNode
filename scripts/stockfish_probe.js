#!/usr/bin/env node
// Minimal Stockfish probe: spawn JS engine directly, request best move for a FEN.
// Avoids previously hung process by spawning a fresh instance and exiting cleanly.

const { spawn } = require('child_process');
const path = require('path');

// Attempt direct path to NNUE JS entry shipped in package.
const stockfishJs = path.join(__dirname, '..', 'node_modules', 'stockfish', 'src', 'stockfish-nnue-16.js');

function spawnEngine() {
  const child = spawn(process.execPath, [stockfishJs], { stdio: ['pipe', 'pipe', 'inherit'] });
  child.on('error', err => {
    console.error('Spawn error:', err.message);
  });
  return child;
}

function analyzeFEN(fen, depth = 12, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const engine = spawnEngine();
    let resolved = false;
    const lines = [];

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { engine.kill(); } catch {}
        reject(new Error('Timeout waiting for bestmove'));
      }
    }, timeoutMs);

    engine.stdout.on('data', chunk => {
      const text = chunk.toString();
      text.split(/\r?\n/).forEach(l => { if (l.trim()) lines.push(l.trim()); });
      // Capture bestmove
      const m = text.match(/bestmove\s+(\S+)/);
      if (m && !resolved) {
        resolved = true;
        clearTimeout(timer);
        try { engine.stdin.write('quit\n'); } catch {}
        try { engine.kill(); } catch {}
        resolve(m[1]);
      }
    });

    engine.on('exit', code => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(new Error('Engine exited early code=' + code));
      }
    });

    // UCI handshake then position search.
    engine.stdin.write('uci\n');
    engine.stdin.write('isready\n');
    engine.stdin.write(`position fen ${fen}\n`);
    engine.stdin.write(`go depth ${depth}\n`);
  });
}

async function main() {
  const fen = process.argv[2] || '8/8/8/3p4/3P4/4r3/8/2K1k3 b - - 0 1';
  const depth = parseInt(process.argv[3] || '12', 10);
  try {
    const move = await analyzeFEN(fen, depth);
    console.log('Best move:', move);
    process.exit(0);
  } catch (e) {
    console.error('Failed:', e.message);
    process.exit(1);
  }
}

main();
