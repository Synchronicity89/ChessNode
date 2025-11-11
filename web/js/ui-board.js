// Placeholder board implementation: maintains simple move list only.
(function(){
  const moveListEl = $('#moveList');
  let ply = 1;

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
      addMove('e4 (simulated)');
    }
  }, 5000);
})();
