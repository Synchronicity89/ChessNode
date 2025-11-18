import { describe, it, expect } from 'vitest';
import { loadIndexHtml } from './setupDom.mjs';

function getFenPlacement(fen){
  return (fen || '').split(' ')[0] || '';
}

describe('UI Standard castling test', () => {
  it('allows kingside castling for human and moves rook correctly', async () => {
    const dom = await loadIndexHtml({ query: '?debug=true', realEngine: true });
    const win = dom.window;
    const doc = win.document;

    if (typeof win.init === 'function') {
      win.init();
    }

    // Click our helper button to load a castle-ready Standard FEN for the human side
    const btnStdCastle = doc.querySelector('#btnStdCastle');
    expect(btnStdCastle).toBeTruthy();
    btnStdCastle.click();

    const fenBefore = doc.querySelector('#fenCurrent').value;
    // Debug: print initial FEN after Std Castle setup
    // eslint-disable-next-line no-console
    console.log('[test] fenBefore=', fenBefore);
    const partsBefore = fenBefore.trim().split(/\s+/);
    expect(partsBefore.length).toBeGreaterThanOrEqual(2);

    const stm = partsBefore[1];
    // Human is black by default (engine plays white), so expect 'b' to move
    expect(stm === 'b' || stm === 'w').toBe(true);

    // Perform a kingside castle for the side-to-move (human)
    if (typeof win.performHumanClickMove === 'function') {
      if (stm === 'b') {
        win.performHumanClickMove('e8', 'g8');
      } else {
        win.performHumanClickMove('e1', 'g1');
      }
    }

    const fenAfter = doc.querySelector('#fenCurrent').value;
    // Debug: print FEN after attempting castle
    // eslint-disable-next-line no-console
    console.log('[test] fenAfter=', fenAfter);
    const placement = getFenPlacement(fenAfter);

    if (stm === 'b') {
      // After black castles O-O from r3k2r, back rank should compress to r4rk1
      expect(placement.startsWith('r4rk1/')).toBe(true);
    } else {
      // After white castles O-O from R3K2R, last rank should end with R4RK1
      expect(placement.endsWith('/R4RK1')).toBe(true);
    }
  });
});
