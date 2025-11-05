// Demonstration encoder for pawn + king + knight subsets

function choose(n, k) {
    if (k < 0 || k > n) return 0n;
    let res = 1n;
    for (let i = 1n; i <= k; i++) {
        res = res * BigInt(n) / i;
        n--;
    }
    return res;
}

// Rank a sorted set of square indices into a combinatorial index
function rankCombination(positions, totalSquares = 64) {
    let k = positions.length;
    let index = 0n;
    let prev = -1;
    for (let i = 0; i < k; i++) {
        let p = positions[i];
        for (let sq = prev + 1; sq < p; sq++) {
            index += choose(totalSquares - sq - 1, k - i - 1);
        }
        prev = p;
    }
    return index;
}

function encodePosition(pieces) {
    // Example input:
    // pieces = { whiteKing: 60, whitePawn: [52, 53], blackKing: 4 }

    let squares = [];

    if (pieces.whiteKing !== undefined) squares.push(pieces.whiteKing);
    if (pieces.blackKing !== undefined) squares.push(pieces.blackKing);
    if (pieces.whitePawn !== undefined) squares.push(...pieces.whitePawn);
    // Extend for all piece types...

    squares = squares.sort((a, b) => a - b);
    const index = rankCombination(squares, 64);

    return index; // Later packed with metadata
}

module.exports = { encodePosition, rankCombination, choose };
