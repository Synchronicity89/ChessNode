// Placeholder board implementation: maintains simple move list only.
(function(){
  const moveListEl = $('#moveList');
  const boardHost = $('#board');
  let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let ply = 1;
  let selectedSq = null; // algebraic like 'e2'
  let legalCache = []; // cached legal moves for current position
  let cfg = (window.EngineConfig && window.EngineConfig.load()) || null;

  function addMove(label) {
    const li = $('<li>').text(ply + '. ' + label);
    moveListEl.append(li);
    ply++;
  }

  function renderBoard() {
    // Parse board portion for display only
    const boardPart = currentFen.split(' ')[0];
    const rows = boardPart.split('/');
    const table = $('<table>').css({borderCollapse:'collapse'});
    for (let r=0;r<8;r++){
      const tr=$('<tr>');
      let file=0;
      for (const ch of rows[r]){
        if (/^[1-8]$/.test(ch)){
          const n = parseInt(ch,10);
          for (let k=0;k<n;k++){ tr.append(renderCell(r,file++,'.')); }
        } else {
          tr.append(renderCell(r,file++,ch));
        }
      }
      table.append(tr);
    }
    boardHost.empty().append(table);
  }

  function rcToAlg(r,c){ return String.fromCharCode(97+c) + (8-r); }
  function algToRC(a){ if(!a||a.length!==2) return null; return {r:8-parseInt(a[1],10), c:a.charCodeAt(0)-97}; }

  function renderCell(r,c,piece){
    const td=$('<td>').css({width:'48px',height:'48px',border:'1px solid #888',textAlign:'center',fontSize:'30px',cursor:'pointer',background: ((r+c)%2)?'#b58863':'#f0d9b5'});
    const map={P:'♙',N:'♘',B:'♗',R:'♖',Q:'♕',K:'♔',p:'♟',n:'♞',b:'♝',r:'♜',q:'♛',k:'♚'};
    td.text(map[piece]||'');
    const alg = rcToAlg(r,c);
    // Highlight selection
    if (selectedSq===alg) td.css('outline','3px solid #2c7');
    // Highlight legal destinations from selected square
    if (selectedSq){
      for (const m of legalCache){
        if (m.from===selectedSq && m.to===alg){ td.css('box-shadow','inset 0 0 0 3px #ffeb3b'); break; }
      }
    }
    td.on('click', ()=> onCellClick(alg, piece));
    return td;
  }

  function refreshLegal(){
    if (!window.EngineBridge){ legalCache=[]; return; }
    try {
      const json = window.EngineBridge.listLegalMoves ? window.EngineBridge.listLegalMoves(currentFen,null,{castleSafety:true}) : null;
      legalCache = json ? JSON.parse(json).moves : [];
    } catch { legalCache=[]; }
  }

  function onCellClick(alg, piece){
    if (!selectedSq){
      // Select only if it has at least one legal move
      const hasMoves = legalCache.some(m=>m.from===alg);
      if (hasMoves){ selectedSq=alg; renderBoard(); }
      return;
    }
    if (selectedSq === alg){ selectedSq=null; renderBoard(); return; }
    // Attempt move selectedSq -> alg if legal
    const move = legalCache.find(m=>m.from===selectedSq && m.to===alg);
    if (!move){ selectedSq=null; renderBoard(); return; }
    let uci = move.uci;
    // Promotion handling: if move ends on rank 8 or 1 and is a pawn without promo, default to queen, unless ctrl pressed -> prompt
    const srcRC = algToRC(selectedSq), dstRC = algToRC(alg);
    if (srcRC && dstRC){
      // heuristically detect a pawn move by presence of piece char in FEN at source (simplify by parsing board again)
      const rows = currentFen.split(' ')[0].split('/');
      let sr=srcRC.r, sc=srcRC.c, fenRow=rows[sr];
      // Quick board reconstruction for source char
      let col=0, srcPiece='.';
      for (const ch of fenRow){
        if (/^[1-8]$/.test(ch)){ col+=parseInt(ch,10); } else { if (col===sc) srcPiece=ch; col++; }
      }
      if (srcPiece.toLowerCase()==='p' && (dstRC.r===0 || dstRC.r===7) && (!move.promo)){
        if (window.event && window.event.ctrlKey){
          const choice = prompt('Promote to (q,r,b,n)?','q');
          const pc = (choice||'q').charAt(0).toLowerCase();
          if (/^[qrbn]$/.test(pc)) uci += pc; else uci+='q';
        } else {
          uci += 'q';
        }
      }
    }
    // Apply via engine
    try {
      const nextFen = window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(currentFen, uci, {castleSafety:true}) : null;
      if (nextFen && !/^\{"error"/.test(nextFen)){
        currentFen = nextFen;
        addMove(uci);
        selectedSq=null;
        refreshLegal();
        renderBoard();
      } else {
        // Illegal or error
        selectedSq=null; renderBoard();
      }
    } catch {
      selectedSq=null; renderBoard();
    }
  }

  $('#newGame').on('click', () => {
    moveListEl.empty(); ply=1; currentFen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    refreshLegal(); renderBoard(); addMove('Game start');
  });

  $('#loadFen').on('click', () => {
    const fen = $('#ioText').val().trim();
    if (!fen) { alert('Paste a FEN into the textbox first.'); return; }
    currentFen = fen;
    const score = EngineBridge.evaluateFEN(fen);
    $('#score').text(score===null? 'engine-unavailable' : ((score>=0?'+':'')+Math.round(score/100)) );
    refreshLegal(); renderBoard(); addMove('Loaded FEN');
  });

  // Self-play observe mode placeholder (still random, not engine logic)
  setInterval(() => {
    const side = $('#sideSelect').val();
    if (side === 'observe' && legalCache.length){
      const idx = Math.floor(Math.random()*legalCache.length);
      const mv = legalCache[idx];
      selectedSq = mv.from; onCellClick(mv.to,'');
    }
  }, 6000);

  $(function(){
    if (cfg?.search?.maxDepth) $('#depth').val(String(cfg.search.maxDepth));
    refreshLegal(); renderBoard(); addMove('Game start');
  });
})();
