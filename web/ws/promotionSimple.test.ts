import {
	listPromotionMovesWithValueFEN,
	promotionNetBonusForPerspectiveFEN,
} from './promotionSimple';

function assert(cond: boolean, msg: string) {
	if (!cond) throw new Error(msg);
}
function assertEq(a: any, b: any, msg: string) {
	if (JSON.stringify(a) !== JSON.stringify(b)) {
		throw new Error(`${msg} expected=${JSON.stringify(b)} got=${JSON.stringify(a)}`);
	}
}

// Helper: normalize ordering
function sortUCIs(moves: { uci: string; gain: number }[]) {
	return moves.slice().sort((x, y) => x.uci.localeCompare(y.uci));
}

// 1. White forward promotion (no captures)
(function whiteForward() {
	const fen = '8/P7/8/8/8/8/8/8 w - - 0 1';
	const moves = sortUCIs(listPromotionMovesWithValueFEN(fen));
	assertEq(moves.map(m => m.uci), ['a7a8b','a7a8n','a7a8q','a7a8r'], 'White promotion UCIs');
	assertEq(moves.map(m => m.gain), [230,220,800,400], 'White gains list');
	assertEq(moves.reduce((s,m)=>s+m.gain,0), 1650, 'White total gain');
	assertEq(promotionNetBonusForPerspectiveFEN(fen,'w'),1650,'White net bonus');
	assertEq(promotionNetBonusForPerspectiveFEN(fen,'b'),-1650,'Black net penalty');
})();

// 2. Black forward promotion
(function blackForward() {
	const fen = '8/8/8/8/8/8/1p6/8 b - - 0 1';
	const moves = sortUCIs(listPromotionMovesWithValueFEN(fen));
	assertEq(moves.map(m => m.uci), ['b2b1b','b2b1n','b2b1q','b2b1r'], 'Black promotion UCIs');
	assertEq(moves.map(m => m.gain), [230,220,800,400], 'Black gains list');
	assertEq(moves.reduce((s,m)=>s+m.gain,0),1650,'Black total gain');
	assertEq(promotionNetBonusForPerspectiveFEN(fen,'b'),1650,'Black net bonus');
	assertEq(promotionNetBonusForPerspectiveFEN(fen,'w'),-1650,'White net penalty');
})();

// 3. No promotions
(function noPromotions() {
	const fen = '8/8/8/8/8/8/8/8 w - - 0 1';
	const moves = listPromotionMovesWithValueFEN(fen);
	assertEq(moves.length,0,'No promotion moves');
	assertEq(promotionNetBonusForPerspectiveFEN(fen,'w'),0,'White no bonus');
	assertEq(promotionNetBonusForPerspectiveFEN(fen,'b'),0,'Black no bonus');
})();

// 4. Mutual promotion potential (both can promote next move)
(function mutual() {
	// White pawn on a7; Black pawn on h2
	const fen = '8/P6p/8/8/8/8/7p/8 w - - 0 1';
	const wMoves = sortUCIs(listPromotionMovesWithValueFEN(fen));
	assertEq(wMoves.map(m=>m.uci), ['a7a8b','a7a8n','a7a8q','a7a8r'],'White mutual UCIs');
	assertEq(promotionNetBonusForPerspectiveFEN(fen,'w'),1650 - 1650,'Net zero (both side potentials counted)');
	assertEq(promotionNetBonusForPerspectiveFEN(fen,'b'),1650 - 1650,'Net zero (both sides)');
})();

// 5. User example with black to move (threat)
(function userExample() {
	const fen = '8/6p1/8/6Np/2knPKnP/8/1p4P1/3R4 b - - 0 45';
	const bMoves = sortUCIs(listPromotionMovesWithValueFEN(fen));
	assertEq(bMoves.map(m=>m.uci), ['b2b1b','b2b1n','b2b1q','b2b1r'],'User example black UCIs');
	assertEq(promotionNetBonusForPerspectiveFEN(fen,'b'),1650,'Black bonus');
	assertEq(promotionNetBonusForPerspectiveFEN(fen,'w'),-1650,'White penalty');
})();

export function runPromotionTests() {
	// Already executed via IIFEs. Provided for manual invocation.
}
