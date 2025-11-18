import { describe, it, expect } from 'vitest'

// Ensure EngineBridge initializes in Node (polyfills window/document if needed)
async function loadEngine() {
  await import('../../web/engine-bridge2.js')
  return globalThis.EngineBridge || (global.window && global.window.EngineBridge)
}

describe('En Passant choice', () => {
  it('prefers en passant capture with forked rooks present', async () => {
    const EB = await loadEngine()
    expect(EB).toBeTruthy()

    // Deterministic ordering
    EB.setRandomSeed(1)

    // Provided FEN: white to move, ep target d6; best is e5d6 en passant
    const fen = '5rnk/6pp/8/3pP3/2R1R3/8/8/4K3 w - d6 0 2'

    const res = EB.chooseBestMove(fen, JSON.stringify({ searchDepth: 2 }))
    const out = JSON.parse(res)

    expect(out && out.best && out.best.uci).toBe('e5d6')
    // Should be a normal position, not terminal
    expect(out.status === 'ok' || out.status === undefined).toBe(true)
  })
})
