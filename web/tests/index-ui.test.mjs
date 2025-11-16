import { describe, it, expect } from 'vitest';
import { loadIndexHtml } from './setupDom.mjs';
import { installStubBridge } from './engine-bridge2.stub.mjs';

function getTextContent(node) {
  return (node && node.textContent) ? node.textContent : '';
}

describe('index.html UI integration', () => {
  it('engine move then human black move updates PGN and log', async () => {
    const dom = await loadIndexHtml();
    const win = dom.window;
    const doc = win.document;

    // Attach stub bridge and fire ready event
    installStubBridge(win);

    // Call init explicitly if it is exposed
    if (typeof win.init === 'function') {
      win.init();
    }

    const btnNewGame = doc.querySelector('#btnNewGame');
    btnNewGame.click();

    const btnEngineMove = doc.querySelector('#btnEngineMove');
    btnEngineMove.click();

    const pgnBox = doc.querySelector('#pgn');
    const pgnAfterEngine = pgnBox.value.trim();
    expect(pgnAfterEngine).toMatch(/^1\.\s+\S+$/);

    // Simulate human black move via direct API call (simpler than DOM clicks)
    if (typeof win.tryHumanMove === 'function') {
      win.tryHumanMove('d7', 'd5');
    }

    const pgnAfterHuman = pgnBox.value.trim();
    expect(pgnAfterHuman).toMatch(/^1\.\s+\S+\s+\S+$/);

    const logDiv = doc.querySelector('#log');
    const logText = getTextContent(logDiv);

    expect(logText).toContain('ENGINE (white) MOVE REQUEST');
    expect(logText).toContain('HUMAN (black) MOVE REQUEST: d7d5');
  });

  it('moves a black piece on the board when human plays from a black-start rank', async () => {
    const dom = await loadIndexHtml();
    const win = dom.window;
    const doc = win.document;

    installStubBridge(win);
    if (typeof win.init === 'function') {
      win.init();
    }

    // New game then let engine move first (white)
    doc.querySelector('#btnNewGame').click();
    doc.querySelector('#btnEngineMove').click();

    const board = doc.querySelector('#board');

    // Helper: list all squares that currently contain any black piece
    // according to the data attributes added in index.html.
    function getBlackPieceSquares() {
      const result = [];
      const squares = board.querySelectorAll('.square');
      for (const sq of squares) {
        if (sq.getAttribute('data-color') === 'black') {
          const alg = sq.dataset && sq.dataset.sq;
          if (alg) result.push(alg);
        }
      }
      return result;
    }

    const beforeSquares = getBlackPieceSquares();
    // With human as black at the bottom, the board is flipped 180 degrees
    // at the start of a new game, so we expect to see black pieces.
    const rotation = board.getAttribute('data-rotated');
    expect(rotation).toBe('180');
    expect(beforeSquares.length).toBeGreaterThan(0);

    // Simulate human black move via public API (using a concrete pawn, but
    // we assert relative change rather than exact algebraic names because
    // the presentation layer uses a flipped board with black at the bottom)
    if (typeof win.tryHumanMove === 'function') {
      win.tryHumanMove('d7', 'd5');
    }

    const afterSquares = getBlackPieceSquares();

    // At least one black piece square should have changed after the move.
    // This confirms a black piece moved on the board without
    // hard-coding exact rank/file orientation.
    expect(afterSquares.length).toBeGreaterThan(0);
    expect(afterSquares.join(',')).not.toBe(beforeSquares.join(','));
  });

  it('engineEvaluateFen updates score and explanation text', async () => {
    const dom = await loadIndexHtml();
    const win = dom.window;
    const doc = win.document;

    installStubBridge(win);
    if (typeof win.init === 'function') {
      win.init();
    }

    const btnNewGame = doc.querySelector('#btnNewGame');
    btnNewGame.click();

    // Trigger a direct evaluation
    if (typeof win.engineEvaluateFen === 'function') {
      win.engineEvaluateFen();
    }

    const scoreText = doc.querySelector('#score').textContent.trim();
    expect(scoreText).not.toBe('--');

    const engineIO = doc.querySelector('#engineIO').value;
    expect(engineIO).toContain('fen (original board):');
    expect(engineIO).toContain('[explain.math]');
  });
});
