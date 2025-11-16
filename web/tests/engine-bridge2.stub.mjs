// Test stub for EngineBridge used by index.html

export function installStubBridge(win) {
  win.EngineBridge = {
    wasmReady: true,
    wasmModule: {},
    setRandomSeed() {},
    evaluateFEN(fen) {
      // simple material: ignore for now, just return 0 so score is stable
      return 0;
    },
    chooseBestMove(fen, optsJson) {
      const stm = (fen.split(' ')[1] || 'w');
      const uci = stm === 'w' ? 'e2e4' : 'd7d5';
      return JSON.stringify({
        depth: 2,
        nodesTotal: 0,
        best: { uci, score: 20 },
        explain: { math: 'Stub test EngineBridge for UI tests.' }
      });
    },
    applyMoveIfLegal(fen, uci) {
      // Minimal: just toggle side-to-move so UI PGN logic advances.
      const parts = fen.split(' ');
      if (parts.length < 2) return fen;
      parts[1] = parts[1] === 'w' ? 'b' : 'w';
      return parts.join(' ');
    }
  };

  const evt = new win.Event('engine-bridge-ready');
  win.dispatchEvent(evt);
}
