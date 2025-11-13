// Placeholder board implementation: maintains simple move list only.
(function(){
  let engineReady = false;
  try {
    window.addEventListener('engine-bridge-ready', (e)=>{
      engineReady = !!(e && e.detail && e.detail.wasmReady);
      if (!engineReady){
        try {
          const box = $('#activityLog');
          box.empty().append($('<div>').addClass('err').css('color','#b00020').text('Engine unavailable: WASM not loaded; GUI disabled.'));
        } catch {}
      }
    }, { once:true });
  } catch {}
  const moveListEl = $('#moveList');
  const boardHost = $('#board');
  let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let ply = 1;
  let selectedSq = null; // algebraic like 'e2'
  let legalCache = []; // cached legal moves for current position
  let cfg = (window.EngineConfig && window.EngineConfig.load()) || null;
  let evalCfg = (window.EngineEvalConfig && window.EngineEvalConfig.load()) || null;

  // Activity log helpers
  function logActivity(message, level){
    try {
      const box = $('#activityLog');
      const ts = new Date();
      const hh = String(ts.getHours()).padStart(2,'0');
      const mm = String(ts.getMinutes()).padStart(2,'0');
      const ss = String(ts.getSeconds()).padStart(2,'0');
      const ms = String(ts.getMilliseconds()).padStart(3,'0');
      const cls = level||'info';
      const line = $('<div>').addClass(cls);
      line.append($('<span>').addClass('ts').text(`[${hh}:${mm}:${ss}.${ms}] `));
      line.append(document.createTextNode(message));
      box.append(line);
      const children = box.children();
      if (children.length > 200) children.slice(0, children.length - 200).remove();
      box.scrollTop(box.prop('scrollHeight'));
      if (cls==='err') console.error('[Activity]', message); else if (cls==='warn') console.warn('[Activity]', message); else console.log('[Activity]', message);
    } catch {}
  }

  function addMove(label) {
    const li = $('<li>').text(ply + '. ' + label);
    moveListEl.append(li);
    ply++;
  }

  function renderBoard() {
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
    if (selectedSq===alg) td.css('outline','3px solid #2c7');
    if (selectedSq){
      for (const m of legalCache){
        if (m.from===selectedSq && m.to===alg){ td.css('box-shadow','inset 0 0 0 3px #ffeb3b'); break; }
      }
    }
    td.on('click', ()=> onCellClick(alg, piece));
    return td;
  }

  function refreshLegal(){
    if (!window.EngineBridge || !engineReady){ legalCache=[]; return; }
    try {
      const json = window.EngineBridge.listLegalMoves ? window.EngineBridge.listLegalMoves(currentFen,null,{castleSafety:true}) : null;
      const moves = json ? JSON.parse(json).moves : [];
      const changed = (!legalCache) || (moves.length !== legalCache.length);
      legalCache = moves;
      if (changed) logActivity(`Legal moves: ${legalCache.length}`);
    } catch { legalCache=[]; }
  }

  function refreshEvalScore(){
    if (!window.EngineBridge || !engineReady) { $('#score').text('engine-unavailable'); return; }
    evalCfg = (window.EngineEvalConfig && window.EngineEvalConfig.load()) || evalCfg;
    const opts = evalCfg ? window.EngineEvalConfig.toEngineOptions(evalCfg) : null;
    let cp = null;
    if (window.EngineBridge.evaluateFENOptions && opts){
      cp = window.EngineBridge.evaluateFENOptions(currentFen, opts);
    } else if (window.EngineBridge.evaluateFEN){
      cp = window.EngineBridge.evaluateFEN(currentFen);
    }
    if (cp===null || cp===undefined){ $('#score').text('engine-unavailable'); return; }
    const pawns = (cp/100).toFixed(5);
    $('#score').text((cp>=0?'+':'') + pawns);
    logActivity(`Score updated to ${(cp>=0?'+':'') + (cp/100).toFixed(5)}`);
  }

  function refreshFenDisplay(){
    const el = $('#fenDisplay');
    if (!el.length) return;
    el.val(currentFen);
    logActivity(`FEN: ${currentFen}`);
  }

  function maybeAppendPromotion(uci, fromAlg, toAlg){
    try {
      if (!fromAlg || !toAlg || !uci) return uci;
      const src = algToRC(fromAlg), dst = algToRC(toAlg);
      if (!src || !dst) return uci;
      const rows = currentFen.split(' ')[0].split('/');
      const fenRow = rows[src.r];
      let col=0, srcPiece='.';
      for (const ch of fenRow){
        if (/^[1-8]$/.test(ch)) { col+=parseInt(ch,10); }
        else { if (col===src.c) srcPiece=ch; col++; }
      }
      if (srcPiece.toLowerCase()==='p' && (dst.r===0 || dst.r===7) && uci.length===4){
        return uci + 'q';
      }
      return uci;
    } catch { return uci; }
  }

  // Helpers
  function parseBoardArray(fen){
    const boardPart = (fen||'').split(' ')[0]||'';
    const rows = boardPart.split('/');
    const grid = Array.from({length:8}, ()=>Array(8).fill('.'));
    for (let r=0;r<8 && r<rows.length;r++){
      let c=0;
      for (const ch of rows[r]){
        if (/^[1-8]$/.test(ch)){ c += parseInt(ch,10); }
        else { if (c<8) grid[r][c++] = ch; }
      }
    }
    return grid;
  }
  function getPieceAt(boardGrid, alg){ const rc = algToRC(alg); return (!boardGrid||!rc)?'.':boardGrid[rc.r]?.[rc.c]||'.'; }
  function isUpper(ch){ return !!ch && ch>='A' && ch<='Z'; }
  function isLower(ch){ return !!ch && ch>='a' && ch<='z'; }
  function manhattanToCenter(alg){ if (!alg) return 0; const rc = algToRC(alg); if (!rc) return 0; const centers = ['d4','e4','d5','e5'].map(algToRC); let best = 99; for (const c of centers){ if (!c) continue; const d = Math.abs(c.r - rc.r) + Math.abs(c.c - rc.c); if (d<best) best=d; } return best===99?0:best; }
  function locateKing(boardGrid, side){ const target = side==='w' ? 'K' : 'k'; for (let r=0;r<8;r++) for (let c=0;c<8;c++){ if (boardGrid[r][c]===target){ return rcToAlg(r,c); } } return null; }
  function countOpponentStrength(boardGrid, opponentSide){ let n=0,b=0,r=0,q=0; const isOpp = opponentSide==='w'?isUpper:isLower; for (let r0=0;r0<8;r0++) for (let c0=0;c0<8;c0++){ const ch = boardGrid[r0][c0]; if (!ch || ch==='.' ) continue; if (isOpp(ch)){ const lc = ch.toLowerCase(); if (lc==='n') n++; else if (lc==='b') b++; else if (lc==='r') r++; else if (lc==='q') q++; } } return 3*(n+b) + 5*r + 9*q; }
  function endgamishFactor(boardGrid, opponentSide, cfg){ const T = (cfg?.endgamishness?.T) ?? 31; const L = (cfg?.endgamishness?.L) ?? 6; const S = countOpponentStrength(boardGrid, opponentSide); let x = (T - S) / Math.max(1e-9, (T - L)); x = Math.max(0, Math.min(1, x)); const min = cfg?.endgamishness?.min ?? 0; const max = cfg?.endgamishness?.max ?? 1; x = Math.max(min, Math.min(max, x)); const pow = cfg?.endgamishnessPow ?? 1.0; return Math.pow(x, pow); }
  function isCaptureMove(uci, boardGrid, stm){ if (!uci || uci.length<4) return false; const dst = uci.slice(2,4); const piece = getPieceAt(boardGrid, dst); if (piece && piece!=='.'){ return (stm==='w' && isLower(piece)) || (stm==='b' && isUpper(piece)); } return false; }
  function plyEquivalentForMove(uci, boardGrid, tradeEq, stm){ return isCaptureMove(uci, boardGrid, stm) ? (tradeEq||0.5) : 1.0; }
  function riskAtDepth(dEq, D, riskCfg){ const type = (riskCfg?.type)||'exponential'; const x = Math.max(0, (dEq/Math.max(1e-9, D||0.0001)) - 1); let r; if (type==='logistic'){ const slope = riskCfg?.slope ?? 5; const m = riskCfg?.midpointMultiplier ?? 1.0; r = 1/(1+Math.exp(slope*((dEq/(Math.max(1e-9, m*(D||0.0001)))) - 1))); } else { const k = Math.max(1.000001, riskCfg?.kAt2x ?? 100); r = Math.exp(-Math.log(k)*x); } const p = riskCfg?.riskPow ?? 1.0; return Math.pow(r, p); }

  // Removed legacy Random/Greedy engine modes; engine moves now always use engine-side chooseBestMove.

  function onCellClick(alg, piece){
    if (!selectedSq){
      const hasMoves = legalCache.some(m=>m.from===alg);
      if (hasMoves){ selectedSq=alg; renderBoard(); }
      return;
    }
    if (selectedSq === alg){ selectedSq=null; renderBoard(); return; }
    const move = legalCache.find(m=>m.from===selectedSq && m.to===alg);
    if (!move){ selectedSq=null; renderBoard(); return; }
    let uci = move.uci;
    const srcRC = algToRC(selectedSq), dstRC = algToRC(alg);
    if (srcRC && dstRC){
      const rows = currentFen.split(' ')[0].split('/');
      let sr=srcRC.r, sc=srcRC.c, fenRow=rows[sr];
      let col=0, srcPiece='.';
      for (const ch of fenRow){ if (/^[1-8]$/.test(ch)){ col+=parseInt(ch,10); } else { if (col===sc) srcPiece=ch; col++; } }
      if (srcPiece.toLowerCase()==='p' && (dstRC.r===0 || dstRC.r===7) && (!move.promo)){
        if (window.event && window.event.ctrlKey){ const choice = prompt('Promote to (q,r,b,n)?','q'); const pc = (choice||'q').charAt(0).toLowerCase(); if (/^[qrbn]$/.test(pc)) uci += pc; else uci+='q'; }
        else { uci += 'q'; }
      }
    }
    try {
      const nextFen = window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(currentFen, uci, {castleSafety:true}) : null;
      if (nextFen && !/^\{"error"/.test(nextFen)){
        currentFen = nextFen;
        addMove(uci);
        selectedSq=null;
        refreshLegal();
        renderBoard();
        refreshFenDisplay();
        logActivity(`Human move: ${uci}`);
        // Immediately trigger engine turn if applicable (no animation delay)
        // Reset lastRequestedFen to allow immediate request on the new position
        try { lastRequestedFen = null; } catch {}
        try {
          const side = $('#sideSelect').val();
          const stm = currentFen.split(' ')[1];
          const humanSide = side === 'white' ? 'w' : (side === 'black' ? 'b' : null);
          const engineTurn = (side === 'observe') || (humanSide && stm !== humanSide);
          if (engineTurn){
            const lineCfg = window.EngineEvalConfig && window.EngineEvalConfig.toLineEvalOptions ? window.EngineEvalConfig.toLineEvalOptions() : {};
            const depthVal = Number($('#depth').val()||1); lineCfg.searchDepth = depthVal;
            logActivity(`Engine turn: requesting best move (Depth=${depthVal})…`);
            const t0 = performance.now();
            const res = window.EngineBridge.chooseBestMove ? window.EngineBridge.chooseBestMove(currentFen, lineCfg) : null;
            const obj = res ? JSON.parse(res) : null;
            const t1 = performance.now();
            if (obj && obj.best && obj.best.uci){
              const u = obj.best.uci;
              const nodesInfo = (typeof obj.nodesTotal === 'number') ? `, nodes=${obj.nodesTotal}` : (typeof obj.best.nodes === 'number') ? `, nodes=${obj.best.nodes}` : '';
              const pliesInfo = (typeof obj.best.actualPlies === 'number') ? `, plies=${obj.best.actualPlies}` : '';
              const depthInfo = (typeof obj.depth === 'number') ? `, depthUsed=${obj.depth}` : '';
              logActivity(`Engine chose: ${u} (score=${typeof obj.best.score==='number'?obj.best.score:'n/a'} cp) in ${(t1-t0).toFixed(1)} ms${nodesInfo}${pliesInfo}${depthInfo}`, 'ok');
              try { if ($('#showPv').is(':checked') && Array.isArray(obj.best.pv) && obj.best.pv.length){ logActivity(`PV: ${obj.best.pv.join(' ')}`); } } catch {}
              try { if ($('#showPv').is(':checked') && Array.isArray(obj.best.pv) && obj.best.pv.length){ logActivity(`PV: ${obj.best.pv.join(' ')}`); } } catch {}
              const nextFen2 = window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(currentFen, u, {castleSafety:true}) : null;
              if (nextFen2 && !/^\{"error"/.test(nextFen2)){
                currentFen = nextFen2; addMove(u); refreshLegal(); renderBoard(); refreshFenDisplay();
                if (typeof obj.best.score === 'number'){ const pawns = (obj.best.score/100).toFixed(5); $('#score').text((obj.best.score>=0?'+':'') + pawns); }
              } else { logActivity('Engine move application failed', 'err'); }
            } else if (obj && obj.error){ logActivity(`Engine error: ${obj.error}`,'err'); }
            else if (obj && obj.candidates && obj.candidates.length===0){ logActivity('Engine reports no candidate moves', 'warn'); }
            else { logActivity('Engine returned no decision or parse failed', 'warn'); }
          }
        } catch(e){}
      } else {
        selectedSq=null; renderBoard();
        logActivity(`Illegal move attempt or error applying move`, 'warn');
      }
    } catch {
      selectedSq=null; renderBoard();
      logActivity(`Exception applying human move`, 'err');
    }
  }

  $('#newGame').on('click', () => {
    moveListEl.empty(); ply=1; currentFen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    refreshLegal(); renderBoard(); addMove('Game start');
    refreshEvalScore(); refreshFenDisplay();
    logActivity('New game started');
    // Kick engine immediately if engine should move first
    try {
      const side = $('#sideSelect').val();
      const stm = currentFen.split(' ')[1];
      const humanSide = side === 'white' ? 'w' : (side === 'black' ? 'b' : null);
      const engineTurn = (side === 'observe') || (humanSide && stm !== humanSide);
      if (engineTurn){
        const lineCfg = window.EngineEvalConfig && window.EngineEvalConfig.toLineEvalOptions ? window.EngineEvalConfig.toLineEvalOptions() : {};
        const depthVal = Number($('#depth').val()||1); lineCfg.searchDepth = depthVal;
        logActivity(`Engine turn: requesting best move (Depth=${depthVal})…`);
        const t0 = performance.now();
        const res = window.EngineBridge.chooseBestMove ? window.EngineBridge.chooseBestMove(currentFen, lineCfg) : null;
        const obj = res ? JSON.parse(res) : null;
        const t1 = performance.now();
        if (obj && obj.best && obj.best.uci){
          const u = obj.best.uci;
          const nodesInfo = (typeof obj.nodesTotal === 'number') ? `, nodes=${obj.nodesTotal}` : (typeof obj.best.nodes === 'number') ? `, nodes=${obj.best.nodes}` : '';
          const pliesInfo = (typeof obj.best.actualPlies === 'number') ? `, plies=${obj.best.actualPlies}` : '';
          logActivity(`Engine chose: ${u} (score=${typeof obj.best.score==='number'?obj.best.score:'n/a'} cp) in ${(t1-t0).toFixed(1)} ms${nodesInfo}${pliesInfo}`, 'ok');
          try { if ($('#showPv').is(':checked') && Array.isArray(obj.best.pv) && obj.best.pv.length){ logActivity(`PV: ${obj.best.pv.join(' ')}`); } } catch {}
          try { if ($('#showPv').is(':checked') && Array.isArray(obj.best.pv) && obj.best.pv.length){ logActivity(`PV: ${obj.best.pv.join(' ')}`); } } catch {}
          const nextFen2 = window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(currentFen, u, {castleSafety:true}) : null;
          if (nextFen2 && !/^\{"error"/.test(nextFen2)){
            currentFen = nextFen2; addMove(u); refreshLegal(); renderBoard(); refreshFenDisplay();
            if (typeof obj.best.score === 'number'){ const pawns = (obj.best.score/100).toFixed(5); $('#score').text((obj.best.score>=0?'+':'') + pawns); }
          } else { logActivity('Engine move application failed', 'err'); }
        } else if (obj && obj.error){ logActivity(`Engine error: ${obj.error}`,'err'); }
        else if (obj && obj.candidates && obj.candidates.length===0){ logActivity('Engine reports no candidate moves', 'warn'); }
        else { logActivity('Engine returned no decision or parse failed', 'warn'); }
      }
    } catch(e){}
  });

  $('#loadFen').on('click', () => {
    const fen = $('#ioText').val().trim();
    if (!fen) { alert('Paste a FEN into the textbox first.'); return; }
    currentFen = fen;
    refreshLegal(); renderBoard(); addMove('Loaded FEN');
    refreshEvalScore(); refreshFenDisplay();
    logActivity('Loaded FEN from textbox');
    // Immediate engine move if needed on loaded position
    try {
      const side = $('#sideSelect').val();
      const stm = currentFen.split(' ')[1];
      const humanSide = side === 'white' ? 'w' : (side === 'black' ? 'b' : null);
      const engineTurn = (side === 'observe') || (humanSide && stm !== humanSide);
      if (engineTurn){
        const lineCfg = window.EngineEvalConfig && window.EngineEvalConfig.toLineEvalOptions ? window.EngineEvalConfig.toLineEvalOptions() : {};
        const depthVal = Number($('#depth').val()||1); lineCfg.searchDepth = depthVal;
        logActivity(`Engine turn: requesting best move (Depth=${depthVal})…`);
        const t0 = performance.now();
        const res = window.EngineBridge.chooseBestMove ? window.EngineBridge.chooseBestMove(currentFen, lineCfg) : null;
        const obj = res ? JSON.parse(res) : null;
        const t1 = performance.now();
        if (obj && obj.best && obj.best.uci){
          const u = obj.best.uci;
          const nodesInfo = (typeof obj.nodesTotal === 'number') ? `, nodes=${obj.nodesTotal}` : (typeof obj.best.nodes === 'number') ? `, nodes=${obj.best.nodes}` : '';
          const pliesInfo = (typeof obj.best.actualPlies === 'number') ? `, plies=${obj.best.actualPlies}` : '';
          const depthInfo = (typeof obj.depth === 'number') ? `, depthUsed=${obj.depth}` : '';
          logActivity(`Engine chose: ${u} (score=${typeof obj.best.score==='number'?obj.best.score:'n/a'} cp) in ${(t1-t0).toFixed(1)} ms${nodesInfo}${pliesInfo}${depthInfo}`, 'ok');
          try { if ($('#showPv').is(':checked') && Array.isArray(obj.best.pv) && obj.best.pv.length){ logActivity(`PV: ${obj.best.pv.join(' ')}`); } } catch {}
          try { if ($('#showPv').is(':checked') && Array.isArray(obj.best.pv) && obj.best.pv.length){ logActivity(`PV: ${obj.best.pv.join(' ')}`); } } catch {}
          const nextFen2 = window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(currentFen, u, {castleSafety:true}) : null;
          if (nextFen2 && !/^\{"error"/.test(nextFen2)){
            currentFen = nextFen2; addMove(u); refreshLegal(); renderBoard(); refreshFenDisplay();
            if (typeof obj.best.score === 'number'){ const pawns = (obj.best.score/100).toFixed(5); $('#score').text((obj.best.score>=0?'+':'') + pawns); }
          } else { logActivity('Engine move application failed', 'err'); }
        } else if (obj && obj.error){ logActivity(`Engine error: ${obj.error}`,'err'); }
        else if (obj && obj.candidates && obj.candidates.length===0){ logActivity('Engine reports no candidate moves', 'warn'); }
        else { logActivity('Engine returned no decision or parse failed', 'warn'); }
      }
    } catch(e){}
  });

  // Engine move timer (also drives observe mode); log only on state changes and once per FEN
  let lastHaveMoves = null;
  let lastEngineTurn = null;
  let lastRequestedFen = null;
  let engineUnavailableNotified = false;
  setInterval(() => {
    const side = $('#sideSelect').val();
    const haveMoves = !!legalCache.length;
    const stm = currentFen.split(' ')[1];
    const humanSide = side === 'white' ? 'w' : (side === 'black' ? 'b' : null);
    const engineTurn = (side === 'observe' && haveMoves) || (humanSide && haveMoves && stm !== humanSide);

    if (lastHaveMoves !== haveMoves){
      if (!haveMoves) logActivity('No legal moves available (game over or invalid position)', 'warn');
      lastHaveMoves = haveMoves;
    }
    if (lastEngineTurn !== engineTurn){
      lastEngineTurn = engineTurn;
    }
    if (!haveMoves) return;

    if (!window.EngineBridge || !window.EngineBridge.chooseBestMove || !engineReady){
      if (!engineUnavailableNotified){
        logActivity('Engine unavailable or chooseBestMove not exported', 'err');
        engineUnavailableNotified = true;
      }
      return;
    } else if (engineUnavailableNotified){
      logActivity('Engine became available');
      engineUnavailableNotified = false;
    }

    if (engineTurn){
      if (lastRequestedFen === currentFen) return; // only once per FEN
      lastRequestedFen = currentFen;
      try {
        const lineCfg = window.EngineEvalConfig && window.EngineEvalConfig.toLineEvalOptions ? window.EngineEvalConfig.toLineEvalOptions() : {};
        const depthVal = Number($('#depth').val()||1); lineCfg.searchDepth = depthVal;
        logActivity(`Engine turn: requesting best move (Depth=${depthVal})…`);
        const t0 = performance.now();
        const res = window.EngineBridge.chooseBestMove ? window.EngineBridge.chooseBestMove(currentFen, lineCfg) : null;
        const obj = res ? JSON.parse(res) : null;
        const t1 = performance.now();
        if (obj && obj.best && obj.best.uci){
          const uci = obj.best.uci;
          const nodesInfo = (typeof obj.nodesTotal === 'number') ? `, nodes=${obj.nodesTotal}` : (typeof obj.best.nodes === 'number') ? `, nodes=${obj.best.nodes}` : '';
          const pliesInfo = (typeof obj.best.actualPlies === 'number') ? `, plies=${obj.best.actualPlies}` : '';
          const depthInfo = (typeof obj.depth === 'number') ? `, depthUsed=${obj.depth}` : '';
          logActivity(`Engine chose: ${uci} (score=${typeof obj.best.score==='number'?obj.best.score:'n/a'} cp) in ${(t1-t0).toFixed(1)} ms${nodesInfo}${pliesInfo}${depthInfo}`, 'ok');
          try { if ($('#showPv').is(':checked') && Array.isArray(obj.best.pv) && obj.best.pv.length){ logActivity(`PV: ${obj.best.pv.join(' ')}`); } } catch {}
          try { if ($('#showPv').is(':checked') && Array.isArray(obj.best.pv) && obj.best.pv.length){ logActivity(`PV: ${obj.best.pv.join(' ')}`); } } catch {}
          const move = legalCache.find(m=>m.uci===uci) || legalCache.find(m=> (m.from+m.to)===uci.slice(0,4));
          if (move){ selectedSq = move.from; onCellClick(move.to,''); }
          if (typeof obj.best.score === 'number'){
            const pawns = (obj.best.score/100).toFixed(5);
            $('#score').text((obj.best.score>=0?'+':'') + pawns);
          }
        } else if (obj && obj.error){
          logActivity(`Engine error: ${obj.error}`,'err');
        } else if (obj && obj.candidates && obj.candidates.length===0){
          logActivity('Engine reports no candidate moves', 'warn');
        } else {
          logActivity('Engine returned no decision or parse failed', 'warn');
        }
      } catch (e){ logActivity(`Engine error: ${e&&e.message?e.message:'unknown'}`, 'err'); }
    }
  }, 2000);

  $(function(){
    if (cfg?.search?.maxDepth) $('#depth').val(String(cfg.search.maxDepth));
    refreshLegal(); renderBoard(); addMove('Game start');
    refreshEvalScore(); refreshFenDisplay();
    logActivity('UI ready');
  });

  try {
    window.addEventListener('engine-bridge-ready', (e)=>{
      const ok = !!(e && e.detail && e.detail.wasmReady);
      logActivity(`Engine bridge: ${ok?'ready':'unavailable'}` , ok?'ok':'warn');
    }, { once:true });
  } catch {}
})();
