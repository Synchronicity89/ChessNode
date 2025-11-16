#!/usr/bin/env node

// FEN and UCI flip utilities + CLI wrapper.
// Mirrors the flip logic used in web/index.html so results match UI behavior.

function flipFenString(fen) {
  try {
    const parts = (fen || '').trim().split(/\s+/);
    if (parts.length < 6) return fen;

    const placement = parts[0];
    const side = parts[1];
    const cast = parts[2];
    const ep = parts[3];
    const half = parts[4];
    const full = parts[5];

    const ranks = placement.split('/');
    if (ranks.length !== 8) return fen;

    const squares = new Array(64).fill('.');
    for (let r = 0; r < 8; r++) {
      let file = 0;
      for (const ch of ranks[r]) {
        if (/^[1-8]$/.test(ch)) {
          const n = parseInt(ch, 10);
          for (let k = 0; k < n; k++) {
            squares[r * 8 + file] = '.';
            file++;
          }
        } else {
          squares[r * 8 + file] = ch;
          file++;
        }
      }
      if (file !== 8) return fen;
    }

    const out = new Array(64).fill('.');
    for (let i = 0; i < 64; i++) {
      let p = squares[i];
      const j = 63 - i;
      if (p !== '.') {
        const upper = p.toUpperCase();
        const lower = p.toLowerCase();
        p = (p === upper) ? lower : upper;
      }
      out[j] = p;
    }

    const rowsOut = [];
    for (let r = 0; r < 8; r++) {
      let row = '';
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = out[r * 8 + c];
        if (p === '.') {
          empty++;
        } else {
          if (empty) {
            row += String(empty);
            empty = 0;
          }
          row += p;
        }
      }
      if (empty) row += String(empty);
      rowsOut.push(row);
    }

    const newPlacement = rowsOut.join('/');
    const newSide = (side === 'w') ? 'b' : 'w';

    const has = { K: false, Q: false, k: false, q: false };
    for (const ch of (cast || '')) {
      if (Object.prototype.hasOwnProperty.call(has, ch)) has[ch] = true;
    }
    const newCast = (has.k ? 'K' : '') + (has.q ? 'Q' : '') + (has.K ? 'k' : '') + (has.Q ? 'q' : '');
    const castOut = newCast || '-';

    let epOut = '-';
    if (ep && ep.length === 2 && /^[a-h][1-8]$/.test(ep)) {
      const f = ep.charCodeAt(0) - 97;
      const r = ep.charCodeAt(1) - 49;
      const nf = 7 - f;
      const nr = 7 - r;
      epOut = String.fromCharCode(97 + nf) + String.fromCharCode(49 + nr);
    }

    return `${newPlacement} ${newSide} ${castOut} ${epOut} ${half} ${full}`;
  } catch {
    return fen;
  }
}

function flipSquare180(alg) {
  if (!alg || alg.length !== 2) return alg;
  const f = alg.charCodeAt(0) - 97;
  const r = alg.charCodeAt(1) - 49;
  if (f < 0 || f > 7 || r < 0 || r > 7) return alg;
  const nf = 7 - f;
  const nr = 7 - r;
  return String.fromCharCode(97 + nf) + String.fromCharCode(49 + nr);
}

function flipMoveUci180(uci) {
  if (!uci || uci.length < 4) return uci;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promo = uci.length > 4 ? uci.slice(4) : '';
  return flipSquare180(from) + flipSquare180(to) + promo;
}

function parseArgs(argv) {
  const args = { fen: '', move: '' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fen' && i + 1 < argv.length) { args.fen = argv[++i]; continue; }
    if (a === '--move' && i + 1 < argv.length) { args.move = argv[++i]; continue; }
    if (!args.fen) { args.fen = a; continue; }
    if (!args.move) { args.move = a; continue; }
  }
  return args;
}

function usage() {
  console.log('Usage: node utilities/fenflip.js --fen "<FEN>" [--move "e2e4"]');
  console.log('   or: node utilities/fenflip.js "<FEN>" [e2e4]');
}

async function main() {
  const { fen, move } = parseArgs(process.argv);
  if (!fen) { usage(); process.exitCode = 1; return; }
  const flippedFen = flipFenString(fen);
  console.log(flippedFen);
  if (move) {
    console.log(flipMoveUci180(move));
  }
}

if (require.main === module) {
  main();
}

module.exports = { flipFenString, flipMoveUci180 };
