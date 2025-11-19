#!/usr/bin/env node
/*
  FEN to Unicode Board Renderer
  Usage:
    node utilities/fen2board.js "<FEN string>"
  or:  echo "<FEN string>" | node utilities/fen2board.js

  Produces a human & machine readable rectangular board using Unicode chess
  piece symbols. Empty squares shown as '·'. Ranks 8..1 top to bottom.
*/

const pieceMap = {
  'P': '♙','N': '♘','B': '♗','R': '♖','Q': '♕','K': '♔',
  'p': '♟','n': '♞','b': '♝','r': '♜','q': '♛','k': '♚'
};

function parseFenBoard(fen) {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 1) throw new Error('Invalid FEN');
  const boardPart = parts[0];
  const ranks = boardPart.split('/');
  if (ranks.length !== 8) throw new Error('Expected 8 ranks');
  const board = []; // array of 8 ranks, each an array of 8 squares
  for (const rank of ranks) {
    const row = [];
    for (const ch of rank) {
      if (/[1-8]/.test(ch)) {
        for (let i=0;i<Number(ch);i++) row.push('·');
      } else if (pieceMap[ch]) {
        row.push(pieceMap[ch]);
      } else {
        throw new Error('Bad FEN char: ' + ch);
      }
    }
    if (row.length !== 8) throw new Error('Rank not 8 squares after expansion');
    board.push(row);
  }
  return board; // board[0] is rank 8, board[7] rank1
}

function renderBoard(board) {
  const files = ['a','b','c','d','e','f','g','h'];
  const topBorder = '  +-------------------------------+'; // 8 squares * (3 chars incl space)
  let out = [];
  out.push(topBorder);
  for (let r=0;r<8;r++) {
    const rankNum = 8 - r;
    const squares = board[r].map(p => p + ' '); // piece plus trailing space
    out.push(rankNum + ' | ' + squares.join('') + '|');
  }
  out.push('  +-------------------------------+');
  out.push('    ' + files.map(f=>f+'  ').join('')); // file labels spaced
  return out.join('\n');
}

function main() {
  let fen = '';
  if (process.argv.length >= 3) {
    fen = process.argv.slice(2).join(' ');
  } else {
    // read from stdin
    fen = require('fs').readFileSync(0,'utf8').trim();
  }
  if (!fen) {
    console.error('Provide FEN as argument or stdin');
    process.exit(1);
  }
  try {
    const board = parseFenBoard(fen);
    console.log('FEN:', fen);
    console.log(renderBoard(board));
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}
