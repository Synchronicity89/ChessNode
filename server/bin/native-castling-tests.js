#!/usr/bin/env node
// Simple native-engine castling test harness
// Runs a few FEN-based checks against the native addon (no HTTP needed).

const { legalMoves, chooseMove } = require('../native-wrapper');

function has(moves, uci){ return moves.includes(uci); }
function assert(cond, msg){ if (!cond) throw new Error(msg); }

function run(){
  const cases = [];
  // 1) Clear board around king: white can O-O and O-O-O
  cases.push({
    name: 'White can O-O and O-O-O on clear rank',
    fen: '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1',
    expectPresent: ['e1g1','e1c1'],
    expectAbsent: []
  });
  // 2) Clear board around king: black can O-O and O-O-O
  cases.push({
    name: 'Black can O-O and O-O-O on clear rank',
    fen: 'r3k2r/8/8/8/8/8/8/4K3 b kq - 0 1',
    expectPresent: ['e8g8','e8c8'],
    expectAbsent: []
  });
  // 3) No rights provided: ensure no castles
  cases.push({
    name: 'No castling rights => no castles',
    fen: '6k1/p4ppp/1p6/4p3/8/P3r1P1/1P1Nq2P/RKr5 w - - 0 27',
    expectPresent: [],
    expectAbsent: ['e1g1','e1c1','e8g8','e8c8']
  });
  // 4) Blocked path: a piece on f1 should block O-O
  cases.push({
    name: 'Blocked f1 prevents O-O',
    fen: '4k3/8/8/8/8/8/8/R3KB1R w KQ - 0 1', // bishop on f1 blocks O-O
    expectPresent: ['e1c1'],
    expectAbsent: ['e1g1']
  });

  // 5) En passant capture: white e5xd6 e.p. when ep target is d6
  cases.push({
    name: 'En passant: e5xd6 ep available',
    fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
    expectPresent: ['e5d6'],
    expectAbsent: []
  });

  // 6) Pinned knight cannot move (only king moves legal)
  cases.push({
    name: 'Pinned knight cannot move',
    fen: 'k3r3/8/8/8/8/8/4N3/4K3 w - - 0 1',
    expectPresent: [],
    expectAbsent: ['e2c1','e2d4','e2f4','e2g1','e2c3','e2d0','e2f0','e2g3'] // some knight patterns
  });

  // 7) Reported illegal castling FEN: no castling available, and castling must not capture
  cases.push({
    name: 'Reported FEN has no castling',
    fen: '2r3k1/p4ppp/1p6/4p3/8/P3r1P1/1PKNq2P/R1B5 w - - 0 26',
    expectPresent: [],
    expectAbsent: ['e1g1','e1c1']
  });

  let failed = 0; let passed = 0;
  for (const t of cases){
    const moves = legalMoves(t.fen);
    try {
      for (const u of t.expectPresent) assert(has(moves, u), `${t.name}: expected to contain ${u}, got ${moves.join(',')}`);
      for (const u of t.expectAbsent) assert(!has(moves, u), `${t.name}: expected to NOT contain ${u}, got ${moves.join(',')}`);
      passed++;
      console.log(`[OK ] ${t.name}`);
    } catch (e){
      failed++;
      console.error(`[FAIL] ${t.name}: ${e.message}`);
    }
  }
  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed>0) process.exit(1);
}

if (require.main === module) run();
