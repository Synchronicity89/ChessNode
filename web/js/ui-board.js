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
    if (score === null) {
      $('#score').text('engine-unavailable');
    } else {
      $('#score').text((score >= 0 ? '+' : '') + Math.round(score/100));
    }
    addMove('Loaded FEN');
  });

  // Simulate a random move every 5s when observing.
  setInterval(() => {
    const side = $('#sideSelect').val();
    if (side === 'observe') {
      // Pure UI-only random placeholder; not chess engine business logic.
      const moves = ['e4','d4','c4','Nf3'];
      const pick = Math.floor(Math.random()*moves.length);
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
