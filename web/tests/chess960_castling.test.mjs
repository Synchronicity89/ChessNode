import { describe, it, expect } from 'vitest'

// Ensure EngineBridge initializes in Node (polyfills window/document if needed)
async function loadEngine() {
  await import('../../web/engine-bridge2.js')
  return globalThis.EngineBridge || (global.window && global.window.EngineBridge)
}

function boardFromFen(fen) {
  const placement = fen.split(' ')[0]
  const rows = placement.split('/')
  const out = []
  for (let r = 0; r < 8; r++) {
    const row = []
    for (const ch of rows[r]) {
      if (/^[1-8]$/.test(ch)) {
        for (let i = 0; i < parseInt(ch, 10); i++) row.push('.')
      } else {
        row.push(ch)
      }
    }
    out.push(row)
  }
  return out
}

function pieceAtBoard(board, sq) {
  const file = sq.charCodeAt(0) - 97
  const rank = sq.charCodeAt(1) - 49
  const r = 7 - rank
  const c = file
  return board[r][c]
}

describe('Castling: Standard and Chess960 (X-FEN)', () => {
  it('generates and applies standard castling (KQ)', async () => {
    const EB = await loadEngine()
    expect(EB).toBeTruthy()

    // Minimal standard castling position: Rook a1, King e1, Rook h1; both paths clear
    const fen = '8/8/8/8/8/8/8/R3K2R w KQ - 0 1'

    const legals = JSON.parse(EB.listLegalMoves2Ply(fen))
    expect(legals.moves).toContain('e1g1')
    expect(legals.moves).toContain('e1c1')

    // Apply kingside castle e1g1; rook should relocate to f1
    const afterKs = EB.applyMoveIfLegal(fen, 'e1g1')
    const partsKs = afterKs.split(/\s+/)
    expect(partsKs[1]).toBe('b')

    const boardKs = boardFromFen(afterKs)
    expect(pieceAtBoard(boardKs, 'g1')).toBe('K')
    expect(pieceAtBoard(boardKs, 'f1')).toBe('R')
    expect(pieceAtBoard(boardKs, 'h1')).toBe('.')
    expect(partsKs[2] || '-').not.toMatch(/[KQ]/) // white castling rights removed
  })

  it('generates and applies Chess960 castling via X-FEN letters', async () => {
    const EB = await loadEngine()
    expect(EB).toBeTruthy()

    // Chess960-like: King e1, rooks on b1 and h1. X-FEN rights use rook files: B (file 1) and H (file 7)
    // Board rank 1: 1R2K2R -> a1 empty, b1 rook, c1 empty, d1 empty, e1 king, f1 empty, g1 empty, h1 rook
    const fen960 = '8/8/8/8/8/8/8/1R2K2R w BH - 0 1'

    const legals960 = JSON.parse(EB.listLegalMoves2Ply(fen960))
    expect(legals960.moves).toContain('e1g1')
    expect(legals960.moves).toContain('e1c1')

    // Apply queenside castle e1c1; rook from b1 should move to d1
    const afterQ = EB.applyMoveIfLegal(fen960, 'e1c1')
    const partsQ = afterQ.split(/\s+/)
    const boardQ = boardFromFen(afterQ)
    expect(partsQ[1]).toBe('b')
    expect(pieceAtBoard(boardQ, 'c1')).toBe('K')
    expect(pieceAtBoard(boardQ, 'd1')).toBe('R')
    expect(pieceAtBoard(boardQ, 'b1')).toBe('.')
    expect(partsQ[2] || '-').not.toMatch(/[A-H]/) // white castling rights removed
  })

  it('removes only the touched X-FEN right when moving a rook off its origin file', async () => {
    const EB = await loadEngine()
    expect(EB).toBeTruthy()

    const fen960 = '8/8/8/8/8/8/8/1R2K2R w BH - 0 1'

    // Move queenside rook b1->b2; should remove only the B right, keep H
    const afterR = EB.applyMoveIfLegal(fen960, 'b1b2')
    const parts = afterR.split(/\s+/)
    const rights = parts[2] || '-'
    expect(rights).not.toContain('B')
    expect(rights).toContain('H')

    // Starting fresh, moving the other rook h1->h2 should remove only H, keep B
    const afterR_h = EB.applyMoveIfLegal(fen960, 'h1h2')
    const partsH = afterR_h.split(/\s+/)
    const rightsH = partsH[2] || '-'
    expect(rightsH).not.toContain('H')
    expect(rightsH).toContain('B')
  })
})
