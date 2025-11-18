import { describe, it, expect } from 'vitest'

// Ensure EngineBridge initializes in Node (polyfills window/document if needed)
async function loadEngine() {
  await import('../../web/engine-bridge2.js')
  return globalThis.EngineBridge || (global.window && global.window.EngineBridge)
}

describe('En Passant evaluation', () => {
  it('evaluates child after EP capture as +100 vs parent and continues search', async () => {
    const EB = await loadEngine()
    expect(EB).toBeTruthy()

    // Deterministic ordering
    EB.setRandomSeed(1)

    // Position with EP available: white to move, ep target d6
    const fen = '5rnk/6pp/8/3pP3/2R1R3/8/8/4K3 w - d6 0 2'

    // EP must be legal
    const legals = JSON.parse(EB.listLegalMoves2Ply(fen))
    expect(Array.isArray(legals.moves)).toBe(true)
    expect(legals.moves).toContain('e5d6')

    const parentEval = EB.evaluateFEN(fen)

    // Apply EP and re-evaluate
    const fenAfterEP = EB.applyMoveIfLegal(fen, 'e5d6')
    expect(typeof fenAfterEP).toBe('string')
    const epEval = EB.evaluateFEN(fenAfterEP)

    // Material-only eval: capturing a black pawn increases white eval by +100
    expect(epEval).toBe(parentEval + 100)

    // Also check a quiet pawn push alternative (no material change)
    // If e5e6 isn't legal (should be), fall back to any other non-EP white move
    let altMove = 'e5e6'
    if (!legals.moves.includes(altMove)) {
      altMove = legals.moves.find(m => m !== 'e5d6') || null
    }
    expect(altMove).toBeTruthy()
    const fenAfterAlt = EB.applyMoveIfLegal(fen, altMove)
    expect(typeof fenAfterAlt).toBe('string')
    const altEval = EB.evaluateFEN(fenAfterAlt)

    // No capture: eval should remain unchanged relative to parent
    expect(altEval).toBe(parentEval)

    // Engine should continue searching from the EP child position
    const resChild = JSON.parse(EB.chooseBestMove(fenAfterEP, JSON.stringify({ searchDepth: 2 })))
    expect(resChild && resChild.best && typeof resChild.best.uci === 'string').toBe(true)
    expect(resChild.status === 'ok' || resChild.status === undefined).toBe(true)
  })

  it('evaluates black-side EP capture as -100 vs parent and continues search', async () => {
    const EB = await loadEngine()
    expect(EB).toBeTruthy()

    EB.setRandomSeed(1)

    // Black to move, en passant available at e3 (white just played e2e4)
    // Board: kings on e8/e1; black pawn d4; white pawn e4; stm=b; ep=e3
    const fenB = '4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1'

    const legalsB = JSON.parse(EB.listLegalMoves2Ply(fenB))
    expect(Array.isArray(legalsB.moves)).toBe(true)
    expect(legalsB.moves).toContain('d4e3')

    const parentEvalB = EB.evaluateFEN(fenB)

    const fenAfterEPB = EB.applyMoveIfLegal(fenB, 'd4e3')
    expect(typeof fenAfterEPB).toBe('string')
    const epEvalB = EB.evaluateFEN(fenAfterEPB)

    // From white's perspective, losing a pawn is -100
    expect(epEvalB).toBe(parentEvalB - 100)

    // Non-capturing alternative should not change material score
    let altB = legalsB.moves.find(m => m !== 'd4e3') || null
    expect(altB).toBeTruthy()
    const fenAfterAltB = EB.applyMoveIfLegal(fenB, altB)
    expect(typeof fenAfterAltB).toBe('string')
    const altEvalB = EB.evaluateFEN(fenAfterAltB)
    expect(altEvalB).toBe(parentEvalB)

    // Search from EP child should produce a move and not be terminal
    const resChildB = JSON.parse(EB.chooseBestMove(fenAfterEPB, JSON.stringify({ searchDepth: 2 })))
    expect(resChildB && resChildB.best && typeof resChildB.best.uci === 'string').toBe(true)
    expect(resChildB.status === 'ok' || resChildB.status === undefined).toBe(true)
  })
})
