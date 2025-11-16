// Promotion threat utilities: list immediate promotions and compute a simple risk penalty.
// Works off FEN to stay decoupled. Integrate by calling from your eval/move-list code.

type Color = 'w' | 'b';
type Piece = 'P'|'N'|'B'|'R'|'Q'|'K'|'p'|'n'|'b'|'r'|'q'|'k';
type Board = (Piece | null)[];

const pieceValues = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

function parseFENBoard(fen: string): { board: Board, stm: Color } {
	// ...existing code...
	const [boardPart, stmPart] = fen.trim().split(/\s+/);
	const rows = boardPart.split('/');
	const board: Board = new Array(64).fill(null);
	let idx = 0; // 0..63, row-major from a8 (0) to h1 (63)
	for (let r = 0; r < 8; r++) {
		const row = rows[r];
		for (const ch of row) {
			if (/\d/.test(ch)) {
				idx += parseInt(ch, 10);
			} else {
				board[idx++] = ch as Piece;
			}
		}
	}
	const stm: Color = (stmPart === 'w' ? 'w' : 'b');
	return { board, stm };
}

function idxToFile(idx: number): number { return idx % 8; } // 0..7 = a..h
function idxToRank(idx: number): number { return Math.floor(idx / 8); } // 0..7 = 8..1 (0 is rank8)
function fileRankToIdx(file: number, rankFromTop: number): number { return rankFromTop * 8 + file; }
function toSq(idx: number): string {
	const file = 'abcdefgh'[idxToFile(idx)];
	const rank = (8 - idxToRank(idx)).toString();
	return `${file}${rank}`;
}
function fromSqFR(file: number, rank: number): string {
	const f = 'abcdefgh'[file];
	const r = (8 - rank).toString();
	return `${f}${r}`;
}

function isWhite(p?: Piece | null): boolean { return !!p && p >= 'A' && p <= 'Z'; }
function isBlack(p?: Piece | null): boolean { return !!p && p >= 'a' && p <= 'z'; }
function colorOf(p: Piece | null): Color | null { return p ? (isWhite(p) ? 'w' : 'b') : null; }
function pieceType(p: Piece | null): string | null { return p ? p.toUpperCase() : null; }

function uci(fromIdx: number, toIdx: number, promo?: 'q'|'r'|'b'|'n'): string {
	const base = `${toSq(fromIdx)}${toSq(toIdx)}`;
	return promo ? base + promo : base;
}

// Sliding attack helpers
const knightD = [ [-2,-1], [-2,1], [-1,-2], [-1,2], [1,-2], [1,2], [2,-1], [2,1] ];
const kingD = [ [-1,-1], [-1,0], [-1,1], [0,-1], [0,1], [1,-1], [1,0], [1,1] ];
const bishopD = [ [-1,-1], [-1,1], [1,-1], [1,1] ];
const rookD = [ [-1,0], [1,0], [0,-1], [0,1] ];

function onBoard(file: number, rank: number): boolean {
	return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

// Minimal attacker value among given color that can capture target idx (pseudo-legal, ignores pins/checks).
function minimalAttackerValue(board: Board, color: Color, targetIdx: number): number | null {
	let minVal: number | null = null;

	// Pawns: find pawns that would capture onto target
	const tf = idxToFile(targetIdx);
	const tr = idxToRank(targetIdx);
	if (color === 'w') {
		// White pawns capture from one rank below (toward up): (tr+1, tf±1)
		for (const df of [-1, 1]) {
			const f = tf + df, r = tr + 1;
			if (!onBoard(f, r)) continue;
			const idx = fileRankToIdx(f, r);
			if (board[idx] === 'P') minVal = Math.min(minVal ?? Infinity, pieceValues.P);
		}
	} else {
		// Black pawns capture from one rank above: (tr-1, tf±1)
		for (const df of [-1, 1]) {
			const f = tf + df, r = tr - 1;
			if (!onBoard(f, r)) continue;
			const idx = fileRankToIdx(f, r);
			if (board[idx] === 'p') minVal = Math.min(minVal ?? Infinity, pieceValues.P);
		}
	}

	// Knights
	for (const [dr, df] of knightD) {
		const f = tf + df, r = tr + dr;
		if (!onBoard(f, r)) continue;
		const idx = fileRankToIdx(f, r);
		const p = board[idx];
		if (!p) continue;
		if ((color === 'w' && p === 'N') || (color === 'b' && p === 'n')) {
			minVal = Math.min(minVal ?? Infinity, pieceValues.N);
		}
	}

	// Bishops/Queens on diagonals
	for (const [dr, df] of bishopD) {
		let f = tf + df, r = tr + dr;
		while (onBoard(f, r)) {
			const idx = fileRankToIdx(f, r);
			const p = board[idx];
			if (p) {
				if (color === 'w') {
					if (p === 'B' || p === 'Q') minVal = Math.min(minVal ?? Infinity, p === 'B' ? pieceValues.B : pieceValues.Q);
				} else {
					if (p === 'b' || p === 'q') minVal = Math.min(minVal ?? Infinity, p === 'b' ? pieceValues.B : pieceValues.Q);
				}
				break;
			}
			f += df; r += dr;
		}
	}

	// Rooks/Queens on files/ranks
	for (const [dr, df] of rookD) {
		let f = tf + df, r = tr + dr;
		while (onBoard(f, r)) {
			const idx = fileRankToIdx(f, r);
			const p = board[idx];
			if (p) {
				if (color === 'w') {
					if (p === 'R' || p === 'Q') minVal = Math.min(minVal ?? Infinity, p === 'R' ? pieceValues.R : pieceValues.Q);
				} else {
					if (p === 'r' || p === 'q') minVal = Math.min(minVal ?? Infinity, p === 'r' ? pieceValues.R : pieceValues.Q);
				}
				break;
			}
			f += df; r += dr;
		}
	}

	// King
	for (const [dr, df] of kingD) {
		const f = tf + df, r = tr + dr;
		if (!onBoard(f, r)) continue;
		const idx = fileRankToIdx(f, r);
		const p = board[idx];
		if ((color === 'w' && p === 'K') || (color === 'b' && p === 'k')) {
			minVal = Math.min(minVal ?? Infinity, pieceValues.K);
		}
	}

	return minVal;
}

// List immediate promotion UCI moves for side-to-move, enumerating =q,=r,=b,=n.
export function listPromotionMovesFEN(fen: string): string[] {
	const { board, stm } = parseFENBoard(fen);
	const promos: string[] = [];
	if (stm === 'w') {
		// White pawn on rank 7 (row 1) moving to rank 8 (row 0)
		for (let idx = 0; idx < 64; idx++) {
			if (board[idx] !== 'P') continue;
			const f = idxToFile(idx), r = idxToRank(idx);
			if (r !== 1) continue;
			// Forward
			const to = fileRankToIdx(f, 0);
			if (!board[to]) {
				for (const sfx of ['q','r','b','n'] as const) promos.push(uci(idx, to, sfx));
			}
			// Captures
			for (const df of [-1, 1]) {
				const cf = f + df;
				if (!onBoard(cf, 0)) continue;
				const capIdx = fileRankToIdx(cf, 0);
				if (board[capIdx] && isBlack(board[capIdx])) {
					for (const sfx of ['q','r','b','n'] as const) promos.push(uci(idx, capIdx, sfx));
				}
			}
		}
	} else {
		// Black pawn on rank 2 (row 6) moving to rank 1 (row 7)
		for (let idx = 0; idx < 64; idx++) {
			if (board[idx] !== 'p') continue;
			const f = idxToFile(idx), r = idxToRank(idx);
			if (r !== 6) continue;
			// Forward
			const to = fileRankToIdx(f, 7);
			if (!board[to]) {
				for (const sfx of ['q','r','b','n'] as const) promos.push(uci(idx, to, sfx));
			}
			// Captures
			for (const df of [-1, 1]) {
				const cf = f + df;
				if (!onBoard(cf, 7)) continue;
				const capIdx = fileRankToIdx(cf, 7);
				if (board[capIdx] && isWhite(board[capIdx])) {
					for (const sfx of ['q','r','b','n'] as const) promos.push(uci(idx, capIdx, sfx));
				}
			}
		}
	}
	return promos;
}

// Compute a promotion-risk penalty from the perspective of 'perspective' color.
// Looks only at immediate one-move promotions available to the opponent if it were their move now.
// penalty ≈ max_over_opponent_promotions( (Q - P) - minImmediateRecaptureValue )
// Clamp at >= 0. Return 0 if no immediate promotion exists.
export function promotionThreatPenaltyFEN(fen: string, perspective: Color): number {
	const { board } = parseFENBoard(fen);
	const opp: Color = (perspective === 'w') ? 'b' : 'w';

	// Gather opponent's immediate promotion destination squares and sources.
	type Threat = { fromIdx: number; toIdx: number; isCapture: boolean };
	const threats: Threat[] = [];

	if (opp === 'w') {
		// Opponent white promotes from row 1 -> row 0
		for (let idx = 0; idx < 64; idx++) {
			if (board[idx] !== 'P') continue;
			const f = idxToFile(idx), r = idxToRank(idx);
			if (r !== 1) continue;
			// forward
			let to = fileRankToIdx(f, 0);
			if (!board[to]) threats.push({ fromIdx: idx, toIdx: to, isCapture: false });
			// captures
			for (const df of [-1, 1]) {
				const cf = f + df; if (!onBoard(cf, 0)) continue;
				to = fileRankToIdx(cf, 0);
				if (board[to] && isBlack(board[to])) threats.push({ fromIdx: idx, toIdx: to, isCapture: true });
			}
		}
	} else {
		// Opponent black promotes from row 6 -> row 7
		for (let idx = 0; idx < 64; idx++) {
			if (board[idx] !== 'p') continue;
			const f = idxToFile(idx), r = idxToRank(idx);
			if (r !== 6) continue;
			// forward
			let to = fileRankToIdx(f, 7);
			if (!board[to]) threats.push({ fromIdx: idx, toIdx: to, isCapture: false });
			// captures
			for (const df of [-1, 1]) {
				const cf = f + df; if (!onBoard(cf, 7)) continue;
				to = fileRankToIdx(cf, 7);
				if (board[to] && isWhite(board[to])) threats.push({ fromIdx: idx, toIdx: to, isCapture: true });
			}
		}
	}

	if (threats.length === 0) return 0;

	// Worst-case gain assumes promotion to Queen; underpromotions are less valuable and covered by search.
	const baseGain = pieceValues.Q - pieceValues.P;

	let worst = 0;
	for (const t of threats) {
		// Compute minimal immediate recapture value the perspective side has on the promotion square.
		const minRecap = minimalAttackerValue(board, perspective, t.toIdx);
		const recapVal = (minRecap ?? 0);
		const swing = Math.max(0, baseGain - recapVal);
		if (swing > worst) worst = swing;
	}

	// Optional scaling to keep it from overwhelming normal eval; tweak as desired.
	const scale = 1.0;
	return Math.floor(worst * scale);
}

// Convenience: if you need the opponent’s four UCI promotion strings (when it’s their move), flip side-to-move in FEN before calling listPromotionMovesFEN.
// Example:
//   const promosNow = listPromotionMovesFEN(fen); // side-to-move promotions for UI
//   const penaltyForWhite = promotionThreatPenaltyFEN(fen, 'w'); // eval penalty vs black’s immediate promotion