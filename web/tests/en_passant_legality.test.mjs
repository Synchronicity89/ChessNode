import { describe, it, expect } from 'vitest'

// Ensure EngineBridge initializes in Node (polyfills window/document if needed)
async function loadEngine() {
  await import('../../web/engine-bridge2.js')
  return globalThis.EngineBridge || (global.window && global.window.EngineBridge)
}

describe('En Passant legality and expiry', () => {
  it('does not allow EP if it exposes own king (illegal EP filtered)', async () => {
    const EB = await loadEngine()
    expect(EB).toBeTruthy()

    // Rook on e8 pins the e-file; white king on e1; white pawn e5; black pawn d5; ep target d6
    // EP e5d6 would vacate e5 and open the e-file, leaving the white king in check -> illegal
    const fen = '4r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'

    const legals = JSON.parse(EB.listLegalMoves2Ply(fen))
    expect(Array.isArray(legals.moves)).toBe(true)
    expect(legals.moves).not.toContain('e5d6')

    // Sanity: engine can still move; best move should not be the illegal EP
    const res = JSON.parse(EB.chooseBestMove(fen, JSON.stringify({ searchDepth: 2 })))
    expect(res && res.best && typeof res.best.uci === 'string').toBe(true)
    expect(res.best.uci).not.toBe('e5d6')
  })

  it('clears EP target after a non-EP reply when white just double-pushed', async () => {
    const EB = await loadEngine()
    expect(EB).toBeTruthy()

    // White to move with e2 pawn; black pawn d4. After e2e4, EP target should be e3.
    const start = '4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1'

    const afterWhite = EB.applyMoveIfLegal(start, 'e2e4')
    expect(typeof afterWhite).toBe('string')
    const partsW = afterWhite.split(/\s+/)
    expect(partsW[3]).toBe('e3')

    // Black plays any legal move that is NOT the EP capture d4e3; EP should then clear.
    const movesB = JSON.parse(EB.listLegalMoves2Ply(afterWhite))
    expect(Array.isArray(movesB.moves)).toBe(true)
    const nonEp = movesB.moves.find(m => m !== 'd4e3')
    expect(nonEp).toBeTruthy()

    const afterBlack = EB.applyMoveIfLegal(afterWhite, nonEp)
    expect(typeof afterBlack).toBe('string')
    const partsB = afterBlack.split(/\s+/)
    expect(partsB[3]).toBe('-')
  })

  it('clears EP target after a non-EP reply when black just double-pushed', async () => {
    const EB = await loadEngine()
    expect(EB).toBeTruthy()

    // Black to move: black pawn d7; white pawn e5. After d7d5, EP target is d6.
    const startB = '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1'

    const afterBlack = EB.applyMoveIfLegal(startB, 'd7d5')
    expect(typeof afterBlack).toBe('string')
    const parts = afterBlack.split(/\s+/)
    expect(parts[3]).toBe('d6')

    // White makes any non-EP move (not e5d6), EP target should clear
    const movesW = JSON.parse(EB.listLegalMoves2Ply(afterBlack))
    expect(Array.isArray(movesW.moves)).toBe(true)
    const nonEpW = movesW.moves.find(m => m !== 'e5d6')
    expect(nonEpW).toBeTruthy()

    const afterWhite = EB.applyMoveIfLegal(afterBlack, nonEpW)
    expect(typeof afterWhite).toBe('string')
    const partsAfter = afterWhite.split(/\s+/)
    expect(partsAfter[3]).toBe('-')
  })
})
