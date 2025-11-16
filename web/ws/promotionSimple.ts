type Color = 'w' | 'b';
type Piece = 'P'|'N'|'B'|'R'|'Q'|'K'|'p'|'n'|'b'|'r'|'q'|'k';
type Board = (Piece | null)[];

const pieceValues = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 } as const;
const promoGains = { q: pieceValues.Q - pieceValues.P, r: pieceValues.R - pieceValues.P, b: pieceValues.B - pieceValues.P, n: pieceValues.N - pieceValues.P } as const;

function parseFENBoard(fen: string): { board: Board, stm: Color } {
	// ...existing code...
	const [boardPart, stmPart] = fen.trim().split(/\s+/);
	const rows = boardPart.split('/');
	const board: Board = new Array(64).fill(null);
	let idx = 0; // 0..63, a8..h1
	for (let r = 0; r < 8; r++) {
		for (const ch of rows[r]) {
			if (/\d/.test(ch)) idx += Number(ch);
			else board[idx++] = ch as Piece;
		}
	}
	return { board, stm: (stmPart === 'w' ? 'w' : 'b') };
}

function idxToFile(i: number) { return i % 8; }             // 0..7 = a..h
function idxToRank(i: number) { return Math.floor(i / 8); } // 0..7 = rank 8..1 (0 is top)
function frToIdx(f: number, rFromTop: number) { return rFromTop * 8 + f; }
function sq(i: number) { return 'abcdefgh'[idxToFile(i)] + String(8 - idxToRank(i)); }
function uci(from: number, to: number, promo?: 'q'|'r'|'b'|'n') { return sq(from) + sq(to) + (promo ?? ''); }

function isWhite(p?: Piece | null) { return !!p && p >= 'A' && p <= 'Z'; }
function isBlack(p?: Piece | null) { return !!p && p >= 'a' && p <= 'z'; }

export type PromotionMoveVal = { uci: string; gain: number };

/**
 * List immediate pseudo-legal promotion moves (4 underpromotions) for a given color with simple material gain.
 * No pins/check/recapture logic; just target square occupancy rules.
 */
export function listPromotionMovesWithValueForColorFEN(fen: string, color: Color): PromotionMoveVal[] {
	const { board } = parseFENBoard(fen);
	const res: PromotionMoveVal[] = [];

	if (color === 'w') {
		// White pawns on rank 7 (row 1) promoting to rank 8 (row 0)
		for (let i = 0; i < 64; i++) {
			if (board[i] !== 'P') continue;
			const f = idxToFile(i), r = idxToRank(i);
			if (r !== 1) continue;

			// Forward if empty
			const toFwd = frToIdx(f, 0);
			if (!board[toFwd]) {
				for (const p of ['q','r','b','n'] as const) res.push({ uci: uci(i, toFwd, p), gain: promoGains[p] });
			}
			// Captures if enemy on target
			for (const df of [-1, 1]) {
				const cf = f + df;
				if (cf < 0 || cf > 7) continue;
				const toCap = frToIdx(cf, 0);
				if (board[toCap] && isBlack(board[toCap])) {
					for (const p of ['q','r','b','n'] as const) res.push({ uci: uci(i, toCap, p), gain: promoGains[p] });
				}
			}
		}
	} else {
		// Black pawns on rank 2 (row 6) promoting to rank 1 (row 7)
		for (let i = 0; i < 64; i++) {
			if (board[i] !== 'p') continue;
			const f = idxToFile(i), r = idxToRank(i);
			if (r !== 6) continue;

			// Forward if empty
			const toFwd = frToIdx(f, 7);
			if (!board[toFwd]) {
				for (const p of ['q','r','b','n'] as const) res.push({ uci: uci(i, toFwd, p), gain: promoGains[p] });
			}
			// Captures if enemy on target
			for (const df of [-1, 1]) {
				const cf = f + df;
				if (cf < 0 || cf > 7) continue;
				const toCap = frToIdx(cf, 7);
				if (board[toCap] && isWhite(board[toCap])) {
					for (const p of ['q','r','b','n'] as const) res.push({ uci: uci(i, toCap, p), gain: promoGains[p] });
				}
			}
		}
	}

	return res;
}

/**
 * Convenience: promotions for the side-to-move in the FEN (for UI/legal move listing).
 */
export function listPromotionMovesWithValueFEN(fen: string): PromotionMoveVal[] {
	const { stm } = parseFENBoard(fen);
	return listPromotionMovesWithValueForColorFEN(fen, stm);
}

/**
 * Net promotion bonus for eval:
 *   sum(my immediate promotion gains) - sum(opponent immediate promotion gains).
 * Add this to your evaluation (positive favors 'perspective').
 */
export function promotionNetBonusForPerspectiveFEN(fen: string, perspective: Color): number {
	const mine = listPromotionMovesWithValueForColorFEN(fen, perspective).reduce((s, m) => s + m.gain, 0);
	const opp = listPromotionMovesWithValueForColorFEN(fen, perspective === 'w' ? 'b' : 'w').reduce((s, m) => s + m.gain, 0);
	return mine - opp;
}