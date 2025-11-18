import { describe, it, expect } from 'vitest'

// Ensure EngineBridge initializes in Node (polyfills window/document if needed)
async function loadEngine() {
  await import('../../web/engine-bridge2.js')
  return globalThis.EngineBridge || (global.window && global.window.EngineBridge)
}

describe('En Passant basics', () => {
  it('sets ep square after a black double pawn push and lists ep capture', async () => {
    const EB = await loadEngine()
    expect(EB).toBeTruthy()

    // Minimal legal position: Black to move, black pawn d7, white pawn e5; kings on e8/e1
    const start = '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1'

    // Black plays d7d5 (double push)
    const afterBlack = EB.applyMoveIfLegal(start, 'd7d5')
    expect(typeof afterBlack).toBe('string')
    // FEN parts: placement side castling ep half full
    const parts = afterBlack.split(/\s+/)
    expect(parts.length).toBeGreaterThanOrEqual(4)
    // ep target should be d6
    expect(parts[3]).toBe('d6')

    // White should have en passant capture e5d6 available
    const res = EB.listLegalMoves2Ply(afterBlack)
    const obj = JSON.parse(res)
    expect(Array.isArray(obj.moves)).toBe(true)
    expect(obj.moves).toContain('e5d6')

    // If White ignores ep and plays a different legal move (e.g., Kg1e2), ep should be cleared
    // Use a quiet king move from e1 to e2 if legal; try e1e2 then fall back to e1d1 if needed
    const tryMoves = ['e1e2', 'e1d1', 'e1f1']
    let afterWhite = null
    for (const mv of tryMoves) {
      const fen2 = EB.applyMoveIfLegal(afterBlack, mv)
      if (typeof fen2 === 'string' && fen2.includes(' ')) { afterWhite = fen2; break }
    }
    expect(afterWhite).toBeTruthy()
    const p2 = afterWhite.split(/\s+/)
    expect(p2[3]).toBe('-')
  })
})
