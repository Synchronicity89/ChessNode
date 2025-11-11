// Placeholder board implementation: maintains simple move list only.
(function(){
  const moveListEl = $('#moveList');
  let ply = 1;
  let cfg = (window.EngineConfig && window.EngineConfig.load()) || null;

  function addMove(san) {
    const li = $('<li>').text(ply + '. ' + san);
    moveListEl.append(li);
    ply++;
  }

  $('#newGame').on('click', () => {
    moveListEl.empty();
    ply = 1;
    addMove('Game start');
  });

  $('#loadFen').on('click', () => {
    const fen = $('#ioText').val().trim();
    if (!fen) { alert('Paste a FEN into the textbox first.'); return; }
    const score = EngineBridge.evaluateFEN(fen);
    $('#score').text((score >= 0 ? '+' : '') + Math.round(score/100));
    addMove('Loaded FEN');
  });

  // Simulate a random move every 5s when observing.
  setInterval(() => {
    const side = $('#sideSelect').val();
    if (side === 'observe') {
      // Use config randomness to vary the simulated move text slightly
      const r = (cfg?.search?.randomness ?? 0) / 100;
      const moves = ['e4','d4','c4','Nf3'];
      const pick = Math.random() < r ? Math.floor(Math.random()*moves.length) : 0;
      addMove(moves[pick] + ' (simulated)');
    }
  }, 5000);

  // Apply default depth from config if present
  $(function(){
    if (cfg?.search?.maxDepth) {
      $('#depth').val(String(cfg.search.maxDepth));
    }
  });
})();
