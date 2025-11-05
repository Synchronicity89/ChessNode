#!/usr/bin/env node
// uciEngine.js
// Minimal UCI-compatible engine that focuses on position storage in 64-bit codes.
// Use: node uciEngine.js
'use strict';

const readline = require('readline');
const pos64 = require('./position64');
const db = require('./dbAdapter');
const cheat = require('./cheatStore');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

let lastFen = null;
let lastCode = null;
let lastMeta = null;

function encodeFormat1Opening(index) {
  // bit63 =1, subformat=000, index in lower 60 bits
  let code = 0n;
  code |= (1n << 63n); // format1 tag
  // subformat 3 bits at 62..60 (zero already)
  code |= BigInt(index) & ((1n << 60n) - 1n);
  return code;
}
function encodeFormat1Cheat(offset) {
  let code = 0n;
  code |= (1n << 63n);
  const subformat = 0b010n;
  code |= (subformat << 60n);
  code |= BigInt(offset) & ((1n << 60n) - 1n);
  return code;
}

function processPositionCommand(arg) {
  // uci "position" command usually: "position startpos" or "position fen ... moves ..."
  // For simplicity support "position fen <fen>"
  if (arg.includes('startpos')) {
    // standard startpos FEN
    lastFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
  } else {
    const m = arg.match(/fen\s+([^ ]+\/[^ ]+\/[^ ]+\/[^ ]+\/[^ ]+\/[^ ]+\/[^ ]+\/[^ ]+)\s+([wb])\s+([KQkq\-]+)\s+([a-h1-8\-]+)/);
    if (m) {
      lastFen = `${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
    } else {
      // fallback: if arg starts with fen, take next 4 fields
      const toks = arg.trim().split(/\s+/);
      const idx = toks.indexOf('fen');
      if (idx >= 0 && toks.length >= idx + 5) {
        lastFen = toks.slice(idx + 1, idx + 5).join(' ');
      }
    }
  }

  if (!lastFen) {
    console.log('info string could not parse position');
    return;
  }

  // attempt pack format2
  const attempt = pos64.attemptPackFormat2(lastFen);
  if (attempt.ok) {
    lastCode = attempt.code;
    lastMeta = attempt.meta;
    console.log(`info string packed into format2 m=${attempt.meta.m} multiBits=${attempt.meta.multiBits}`);
  } else {
    // consult opening DB adapter
    const cf = pos64.canonicalizeFEN(lastFen);
    const found = db.findPosition(cf);
    if (found.found) {
      lastCode = encodeFormat1Opening(found.index);
      lastMeta = { format: 'format1-opening', index: found.index };
      console.log(`info string used opening db index ${found.index}`);
    } else {
      // store cheat blob (store canonical FEN and maybe extra context)
      const buf = Buffer.from(cf, 'utf8');
      const offset = cheat.storeBlob(buf);
      lastCode = encodeFormat1Cheat(offset);
      lastMeta = { format: 'format1-cheat', offset };
      console.log(`info string stored in cheat store offset ${offset}`);
    }
  }
}

// minimal random move generator (placeholder)
function pickRandomMove() {
  // Very small placeholder: always reply with a legal-sounding move "a2a3"
  return 'a2a3';
}

console.log('id name Tiny64Engine');
console.log('id author Prototype');
console.log('uciok');

rl.on('line', (line) => {
  line = line.trim();
  if (line === 'isready') {
    console.log('readyok');
  } else if (line.startsWith('position')) {
    processPositionCommand(line);
  } else if (line.startsWith('go')) {
    // we will not perform a real search - return a placeholder bestmove
    const best = pickRandomMove();
    console.log(`bestmove ${best}`);
  } else if (line === 'uci') {
    // respond with id lines again
    console.log('id name Tiny64Engine');
    console.log('id author Prototype');
    console.log('uciok');
  } else if (line === 'quit') {
    rl.close();
    process.exit(0);
  }
});
