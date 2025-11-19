#!/usr/bin/env node
/*
  board2fen.js
  Convert an 8-rank textual board description into an X-FEN string.

  INPUT FORMAT (from stdin or --file):
    8 lines, rank8 first down to rank1.
    Each line contains 8 tokens separated by spaces.
    Tokens may be:
      - ASCII piece letters: P N B R Q K (white), p n b r q k (black)
      - Unicode chess symbols: ♙♘♗♖♕♔ and ♟♞♝♜♛♚
      - Empty squares: '.' or '·'
    Lines starting with '#', or blank lines, are ignored.

  OPTIONS:
    --stm w|b            Side to move (default w)
    --castling KQkq|-    Castling rights (default -)
    --ep <square|->      En passant target (default -)
    --half <int>         Halfmove clock (default 0)
    --full <int>         Fullmove number (default 1)
    --file <path>        Read board from file instead of stdin

  OUTPUT:
    Prints FEN (X-FEN format) then exits with 0.

  EXAMPLE (PowerShell heredoc):
    @"\nR N B Q K B N R\nP P P P P P P P\n. . . . . . . .\n. . . . . . . .\n. . . . . . . .\n. . . . . . . .\np p p p p p p p\nr n b q k b n r\n"@ | node utilities/board2fen.js --stm w --castling KQkq --ep - --half 0 --full 1
*/

const unicodeToAscii = {
  '♙':'P','♘':'N','♗':'B','♖':'R','♕':'Q','♔':'K',
  '♟':'p','♞':'n','♝':'b','♜':'r','♛':'q','♚':'k'
};
const allowedAscii = new Set(['P','N','B','R','Q','K','p','n','b','r','q','k','.','·']);

function parseArgs(argv){
  const args = { stm:'w', castling:'-', ep:'-', half:0, full:1, file:null };
  for (let i=2;i<argv.length;i++) {
    const a = argv[i];
    if (a==='--stm') args.stm = argv[++i];
    else if (a==='--castling') args.castling = argv[++i];
    else if (a==='--ep') args.ep = argv[++i];
    else if (a==='--half') args.half = parseInt(argv[++i],10);
    else if (a==='--full') args.full = parseInt(argv[++i],10);
    else if (a==='--file') args.file = argv[++i];
    else {
      console.error('Unknown arg: '+a);
      process.exit(2);
    }
  }
  return args;
}

function readBoardText(file){
  if (file) return require('fs').readFileSync(file,'utf8');
  return require('fs').readFileSync(0,'utf8');
}

function tokenizeBoard(text){
  const lines = text.split(/\r?\n/).filter(l=>l.trim().length>0 && !l.trim().startsWith('#'));
  if (lines.length < 8) throw new Error('Expected at least 8 non-comment lines, got '+lines.length);
  // Take first 8 lines as ranks 8..1
  const ranks = lines.slice(0,8).map(l=>l.trim().split(/\s+/));
  for (let r=0;r<8;r++) {
    if (ranks[r].length !== 8) throw new Error('Rank '+(8-r)+' does not have 8 tokens');
  }
  return ranks; // rank[0] = rank8 tokens
}

function normalizePiece(token){
  if (unicodeToAscii[token]) return unicodeToAscii[token];
  if (!allowedAscii.has(token)) throw new Error('Unsupported token: '+token);
  return token; // ASCII piece or '.'/·
}

function boardToFen(ranks){
  // ranks[0] rank8 ... ranks[7] rank1
  const parts = [];
  for (let r=0;r<8;r++) {
    let empty=0; let fenRank='';
    for (let c=0;c<8;c++) {
      const t = normalizePiece(ranks[r][c]);
      if (t==='.' || t==='·') { empty++; continue; }
      if (empty) { fenRank += empty.toString(); empty=0; }
      fenRank += t;
    }
    if (empty) fenRank += empty.toString();
    parts.push(fenRank);
  }
  return parts.join('/');
}

function validateCastling(c){
  if (c==='-') return '-';
  const filtered = c.split('').filter(ch=>'KQkq'.includes(ch));
  return filtered.join('') || '-';
}

function validateEp(ep){
  if (ep==='-') return '-';
  if (/^[a-h][1-8]$/.test(ep)) return ep; return '-';
}

function main(){
  try {
    const args = parseArgs(process.argv);
    const text = readBoardText(args.file);
    const ranks = tokenizeBoard(text);
    const boardFen = boardToFen(ranks);
    const castling = validateCastling(args.castling);
    const ep = validateEp(args.ep);
    const fen = `${boardFen} ${args.stm} ${castling} ${ep} ${args.half} ${args.full}`;
    console.log(fen);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

if (require.main === module) main();
