// Placeholder board implementation: maintains simple move list only.
(function(){
  let engineReady = false;
  try {
    window.addEventListener('engine-bridge-ready', (e)=>{
      engineReady = !!(e && e.detail && e.detail.wasmReady);
      try {
        const statusEl = $('#engineStatus');
        if (engineReady){
          // Initialize deterministic RNG seed unless user overrides later.
          try { if (window.EngineBridge && window.EngineBridge.setRandomSeed) { window.EngineBridge.setRandomSeed(12345); logActivity('Engine RNG seed set to 12345'); } } catch {}
          const v = (window.EngineBridge && typeof window.EngineBridge.getVersion==='function') ? window.EngineBridge.getVersion() : 'ready';
          if (statusEl && statusEl.length) statusEl.text(v);
          // Now that engine is ready, fetch legal moves and refresh UI
          refreshLegal();
          renderBoard();
          refreshEvalScore();
          refreshFenDisplay();
        } else {
          if (statusEl && statusEl.length) statusEl.text('unavailable');
          try {
            const box = $('#activityLog');
            box.empty().append($('<div>').addClass('err').css('color','#b00020').text('Engine unavailable: WASM not loaded; GUI disabled.'));
          } catch {}
        }
      } catch {}
    }, { once:true });
  } catch {}
  const moveListEl = $('#moveList');
  const boardHost = $('#board');
  let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let ply = 1;
   let quietHalfPlies = 0; // dev 5-move rule counter (reset on capture or pawn move)
   let selfPlayActive = false;
  let selectedSq = null; // algebraic like 'e2'
  let legalCache = []; // cached legal moves for current position
  let enginePaused = false; // End Game pauses engine automation
  let lastAppliedFromFen = null; // track FEN for which engine move was applied
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
      const rawObj = json ? JSON.parse(json) : null;
      const moves = rawObj ? rawObj.moves : [];
      // Augment moves with from/to if missing (engine currently returns only UCI)
      for (const m of moves){
        if (m && m.uci && (m.from===undefined || m.to===undefined) && m.uci.length>=4){
          m.from = m.uci.slice(0,2);
          m.to = m.uci.slice(2,4);
        }
      }
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
    try { const inline = $('#fenInputBoard'); if (inline.length) inline.val(currentFen); } catch {}
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
      if (!legalCache.length){ refreshLegal(); }
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
        const ev = window.event || {};
        const wantChoice = !!(ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey);
        if (wantChoice){
          const choice = prompt('Promote to (q,r,b,n)?','q');
          const pc = (choice||'q').charAt(0).toLowerCase();
          if (/^[qrbn]$/.test(pc)) uci += pc; else uci+='q';
        } else {
          uci += 'q';
        }
      }
    }
    try {
      const nextFen = window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(currentFen, uci, {castleSafety:true}) : null;
      if (nextFen && !/^\{"error"/.test(nextFen)){
        currentFen = nextFen;
         // Update quiet rule counters for human move
         try { updateQuietRule(uci); } catch {}
        addMove(uci);
        selectedSq=null;
        refreshLegal();
        renderBoard();
        refreshFenDisplay();
        logActivity(`Human move: ${uci}`);
        try { lastRequestedFen = null; } catch {}
        // Defer engine search to next tick so user sees the move immediately
        setTimeout(()=>{
          try {
            const side = $('#sideSelect').val();
            const stm = currentFen.split(' ')[1];
            const humanSide = side === 'white' ? 'w' : (side === 'black' ? 'b' : null);
            const engineTurn = (side === 'observe') || (humanSide && stm !== humanSide);
            if (engineTurn && !enginePaused){
              const lineCfg = window.EngineEvalConfig && window.EngineEvalConfig.toLineEvalOptions ? window.EngineEvalConfig.toLineEvalOptions() : {};
              const depthVal = Number($('#depth').val()||1); lineCfg.searchDepth = depthVal;
              if (window.EngineBridge && typeof window.EngineBridge.supportsAsync==='function' && window.EngineBridge.supportsAsync()){
                window.EngineBridge.startSearch(currentFen, lineCfg);
                lastRequestedFen = currentFen; lastAppliedFromFen = null;
                logActivity(`Engine turn: started async search (Depth=${depthVal})…`);
                updateRunStateLabel(true);
              } else if (window.EngineBridge && window.EngineBridge.chooseBestMove){
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
                const nextFen2 = window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(currentFen, u, {castleSafety:true}) : null;
                if (nextFen2 && !/^\{"error"/.test(nextFen2)){
                  currentFen = nextFen2; addMove(u); refreshLegal(); renderBoard(); refreshFenDisplay();
                   try { updateQuietRule(u); } catch {}
                  if (typeof obj.best.score === 'number'){ const pawns = (obj.best.score/100).toFixed(5); $('#score').text((obj.best.score>=0?'+':'') + pawns); }
                } else { logActivity('Engine move application failed', 'err'); }
              } else if (obj && obj.error){ logActivity(`Engine error: ${obj.error}`,'err'); }
              else if (obj && obj.candidates && obj.candidates.length===0){ logActivity('Engine reports no candidate moves', 'warn'); }
              else { logActivity('Engine returned no decision or parse failed', 'warn'); }
              }
            }
          } catch(e){}
        },0);
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
    try { if (window.EngineBridge && window.EngineBridge.cancelSearch) window.EngineBridge.cancelSearch(); } catch {}
    enginePaused = false;
    moveListEl.empty(); ply=1; currentFen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    quietHalfPlies = 0; selfPlayActive = false;
    refreshLegal(); renderBoard(); addMove('Game start');
    refreshEvalScore(); refreshFenDisplay();
    logActivity('New game started');
    updateRunStateLabel(false);
    // Kick engine immediately if engine should move first
    try {
      const side = $('#sideSelect').val();
      const stm = currentFen.split(' ')[1];
      const humanSide = side === 'white' ? 'w' : (side === 'black' ? 'b' : null);
      const engineTurn = (side === 'observe') || (humanSide && stm !== humanSide);
      if (engineTurn){
        const lineCfg = window.EngineEvalConfig && window.EngineEvalConfig.toLineEvalOptions ? window.EngineEvalConfig.toLineEvalOptions() : {};
        const depthVal = Number($('#depth').val()||1); lineCfg.searchDepth = depthVal;
        if (window.EngineBridge && typeof window.EngineBridge.supportsAsync==='function' && window.EngineBridge.supportsAsync()){
          window.EngineBridge.startSearch(currentFen, lineCfg);
          lastRequestedFen = currentFen; lastAppliedFromFen = null;
          logActivity(`Engine turn: started async search (Depth=${depthVal})…`);
          // Try immediate status read to avoid waiting for interval
          try {
            const statusJson = window.EngineBridge.getSearchStatus ? window.EngineBridge.getSearchStatus() : null;
            if (statusJson){
              let st=null; try { st = JSON.parse(statusJson); } catch{}
              updateRunStateLabel(!!(st && st.running));
              if (st && st.status && st.status.best && st.status.best.uci && !st.running){
                const uci = st.status.best.uci;
                const fromFenBefore = currentFen;
                const nextFen2 = window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(currentFen, uci, {castleSafety:true}) : null;
                if (nextFen2 && !/^\{"error"/.test(nextFen2)){
                  currentFen = nextFen2; addMove(uci); refreshLegal(); renderBoard(); refreshFenDisplay();
                  lastAppliedFromFen = fromFenBefore;
                  logActivity(`Applied engine move immediately: ${uci}`,'ok');
                }
              } else {
                updateRunStateLabel(true);
              }
            }
          } catch{}
          updateRunStateLabel(true);
        } else if (window.EngineBridge && window.EngineBridge.chooseBestMove){
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
            const nextFen2 = window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(currentFen, u, {castleSafety:true}) : null;
            if (nextFen2 && !/^\{"error"/.test(nextFen2)){
              currentFen = nextFen2; addMove(u); refreshLegal(); renderBoard(); refreshFenDisplay();
               try { updateQuietRule(u); } catch {}
              if (typeof obj.best.score === 'number'){ const pawns = (obj.best.score/100).toFixed(5); $('#score').text((obj.best.score>=0?'+':'') + pawns); }
            } else { logActivity('Engine move application failed', 'err'); }
            updateRunStateLabel(false);
          } else if (obj && obj.error){ logActivity(`Engine error: ${obj.error}`,'err'); }
          else if (obj && obj.candidates && obj.candidates.length===0){ logActivity('Engine reports no candidate moves', 'warn'); }
          else { logActivity('Engine returned no decision or parse failed', 'warn'); }
        }
      }
    } catch(e){}
  });

  $('#loadFen').on('click', () => {
    const fen = $('#ioText').val().trim();
    if (!fen) { alert('Paste a FEN into the textbox first.'); return; }
    currentFen = fen;
    refreshLegal(); renderBoard(); addMove('Loaded FEN');
    quietHalfPlies = 0; selfPlayActive = false;
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
             try { updateQuietRule(u); } catch {}
            if (typeof obj.best.score === 'number'){ const pawns = (obj.best.score/100).toFixed(5); $('#score').text((obj.best.score>=0?'+':'') + pawns); }
          } else { logActivity('Engine move application failed', 'err'); }
        } else if (obj && obj.error){ logActivity(`Engine error: ${obj.error}`,'err'); }
        else if (obj && obj.candidates && obj.candidates.length===0){ logActivity('Engine reports no candidate moves', 'warn'); }
        else { logActivity('Engine returned no decision or parse failed', 'warn'); }
      }
    } catch(e){}
  });

  // --- Inline FEN utilities (flip + load & move) ---
  function flipFenString(fen){
    try {
      const parts = (fen||'').trim().split(/\s+/);
      if (parts.length < 6) return fen;
      const placement = parts[0], side = parts[1], cast = parts[2], ep = parts[3], half = parts[4], full = parts[5];
      // Expand placement
      const ranks = placement.split('/'); if (ranks.length !== 8) return fen;
      const squares = new Array(64).fill('.');
      for (let r=0;r<8;r++){
        let file=0;
        for (const ch of ranks[r]){
          if (/^[1-8]$/.test(ch)){ const n=parseInt(ch,10); for(let k=0;k<n;k++){ squares[r*8+file]='.'; file++; } }
          else { squares[r*8+file]=ch; file++; }
        }
        if (file!==8) return fen;
      }
      const out = new Array(64).fill('.');
      for (let i=0;i<64;i++){
        let p = squares[i]; const j = 63 - i;
        if (p!=='.'){
          const upper = p.toUpperCase(); const lower = p.toLowerCase();
          p = (p===upper) ? lower : upper;
        }
        out[j] = p;
      }
      // Compress back
      const rows=[];
      for (let r=0;r<8;r++){
        let row=''; let empty=0;
        for (let c=0;c<8;c++){
          const p = out[r*8+c];
          if (p==='.'){ empty++; }
          else { if (empty){ row += String(empty); empty=0; } row += p; }
        }
        if (empty) row += String(empty);
        rows.push(row);
      }
      const newPlacement = rows.join('/');
      const newSide = (side==='w') ? 'b' : 'w';
      // Flip castling flags KQkq by colors
      const has = {K:false,Q:false,k:false,q:false}; for (const ch of (cast||'')){ if (has.hasOwnProperty(ch)) has[ch]=true; }
      const newCast = (has.k?'K':'') + (has.q?'Q':'') + (has.K?'k':'') + (has.Q?'q':'');
      const castOut = newCast || '-';
      // Flip ep square (a1<->h8)
      let epOut = '-';
      if (ep && ep.length===2 && /^[a-h][1-8]$/.test(ep)){
        const f = ep.charCodeAt(0)-97, r = ep.charCodeAt(1)-49;
        const nf = 7-f, nr = 7-r;
        epOut = String.fromCharCode(97+nf) + String.fromCharCode(49+nr);
      }
      return `${newPlacement} ${newSide} ${castOut} ${epOut} ${half} ${full}`;
    } catch { return fen; }
  }

  $('#btnFlipFenBoard').on('click', () => {
    const box = $('#fenInputBoard');
    if (!box.length) return;
    const fen = (box.val()||'').trim();
    if (!fen){ alert('Paste a FEN into the textbox first.'); return; }
    const flipped = flipFenString(fen);
    box.val(flipped);
    logActivity('Flipped FEN into textbox');
  });

  $('#btnLoadFenBoard').on('click', () => {
    const box = $('#fenInputBoard');
    if (!box.length) return;
    const fen = (box.val()||'').trim();
    if (!fen){ alert('Paste a FEN into the textbox first.'); return; }
    // Load onto board
    currentFen = fen;
    refreshLegal(); renderBoard(); addMove('Loaded FEN');
    quietHalfPlies = 0; selfPlayActive = false;
    refreshEvalScore(); refreshFenDisplay();
    logActivity('Loaded FEN from inline textbox');
    // Set side dropdown to opposite of side-to-move so it's engine's turn
    try {
      const stm = (currentFen.split(' ')[1]||'w');
      const engineShouldPlay = (stm==='w') ? 'black' : 'white';
      $('#sideSelect').val(engineShouldPlay);
    } catch {}
    // Kick off immediate engine decision using choose_best_move path
    try {
      if (!window.EngineBridge || !window.EngineBridge.chooseBestMove){ logActivity('Engine unavailable for chooseBestMove','err'); return; }
      const lineCfg = window.EngineEvalConfig && window.EngineEvalConfig.toLineEvalOptions ? window.EngineEvalConfig.toLineEvalOptions() : {};
      const depthVal = Number($('#depth').val()||1); lineCfg.searchDepth = depthVal;
      logActivity(`Engine turn: requesting best move (Depth=${depthVal})…`);
      const t0 = performance.now();
      const res = window.EngineBridge.chooseBestMove(currentFen, lineCfg);
      const obj = res ? JSON.parse(res) : null;
      const t1 = performance.now();
      if (obj && obj.best && obj.best.uci){
        const u = obj.best.uci;
        const nodesInfo = (typeof obj.nodesTotal === 'number') ? `, nodes=${obj.nodesTotal}` : (typeof obj.best.nodes === 'number') ? `, nodes=${obj.best.nodes}` : '';
        const pliesInfo = (typeof obj.best.actualPlies === 'number') ? `, plies=${obj.best.actualPlies}` : '';
        const depthInfo = (typeof obj.depth === 'number') ? `, depthUsed=${obj.depth}` : '';
        logActivity(`Engine chose: ${u} (score=${typeof obj.best.score==='number'?obj.best.score:'n/a'} cp) in ${(t1-t0).toFixed(1)} ms${nodesInfo}${pliesInfo}${depthInfo}`, 'ok');
        if ($('#showPv').is(':checked') && Array.isArray(obj.best.pv) && obj.best.pv.length){ logActivity(`PV: ${obj.best.pv.join(' ')}`); }
        const nextFen2 = window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(currentFen, u, {castleSafety:true}) : null;
        if (nextFen2 && !/^\{"error"/.test(nextFen2)){
          currentFen = nextFen2; addMove(u); refreshLegal(); renderBoard(); refreshFenDisplay();
             try { updateQuietRule(u); } catch {}
          if (typeof obj.best.score === 'number'){ const pawns = (obj.best.score/100).toFixed(5); $('#score').text((obj.best.score>=0?'+':'') + pawns); }
        } else { logActivity('Engine move application failed', 'err'); }
      } else if (obj && obj.error){ logActivity(`Engine error: ${obj.error}`,'err'); }
      else if (obj && obj.candidates && obj.candidates.length===0){ logActivity('Engine reports no candidate moves', 'warn'); }
      else { logActivity('Engine returned no decision or parse failed', 'warn'); }
    } catch(e){ logActivity('Exception during engine move after loading FEN','err'); }
  });

  // End Game: stop current searching and pause engine automation
  $('#endGame').on('click', () => {
    try { if (window.EngineBridge && window.EngineBridge.cancelSearch) window.EngineBridge.cancelSearch(); } catch {}
    enginePaused = true;
    selfPlayActive = false;
    lastRequestedFen = null; lastAppliedFromFen = null;
    logActivity('End Game: cancel requested; waiting for search to stop');
    // Poll until search truly idle
    const waitStop = setInterval(()=>{
      try {
        const stJson = window.EngineBridge && window.EngineBridge.getSearchStatus ? window.EngineBridge.getSearchStatus() : null;
        if (!stJson){ clearInterval(waitStop); updateRunStateLabel(false); return; }
        let st=null; try { st = JSON.parse(stJson); } catch {}
        if (st && st.running){ return; }
        clearInterval(waitStop);
        logActivity('End Game: search fully stopped');
        updateRunStateLabel(false); // reflect paused state
      } catch { clearInterval(waitStop); updateRunStateLabel(false); }
    }, 100);
  });

  // Engine move timer (also drives observe mode); log only on state changes and once per FEN
  let lastHaveMoves = null;
  let lastEngineTurn = null;
  let lastRequestedFen = null;
  let engineUnavailableNotified = false;
  function updateRunStateLabel(running){
    try {
      const el = $('#searchState');
      if (!el.length) return;
      // Remove prior state classes
      el.removeClass('search-running search-idle search-paused');
      if (enginePaused){
        el.text('paused');
        el.addClass('search-paused');
        return;
      }
      if (running){
        el.text('running');
        el.addClass('search-running');
      } else {
        el.text('idle');
        el.addClass('search-idle');
      }
    } catch {}
  }
  const POLL_MS = 200; // faster polling to reduce perceived delay
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

    const asyncOK = !!(window.EngineBridge && typeof window.EngineBridge.supportsAsync==='function' && window.EngineBridge.supportsAsync());
    if (!engineReady || (!asyncOK && (!window.EngineBridge || !window.EngineBridge.chooseBestMove))){
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
      try {
        const lineCfg = window.EngineEvalConfig && window.EngineEvalConfig.toLineEvalOptions ? window.EngineEvalConfig.toLineEvalOptions() : {};
        const depthVal = Number($('#depth').val()||1); lineCfg.searchDepth = depthVal;
        if (asyncOK){
          if (enginePaused) return;
          if (lastRequestedFen !== currentFen){
            window.EngineBridge.startSearch(currentFen, lineCfg);
            lastRequestedFen = currentFen;
            lastAppliedFromFen = null;
            logActivity(`Engine turn: started async search (Depth=${depthVal})…`);
            updateRunStateLabel(true);
          }
          const statusJson = window.EngineBridge.getSearchStatus();
          if (statusJson){
            let st=null; try { st = JSON.parse(statusJson); } catch{}
            updateRunStateLabel(!!(st && st.running));
            if (st && st.status && st.status.best && st.status.best.uci && !st.running && lastAppliedFromFen !== currentFen){
              logActivity(`Search done: best=${st.status.best.uci} (score=${typeof st.status.best.score==='number'?st.status.best.score:'n/a'})`);
              const uci = st.status.best.uci;
              const move = legalCache.find(m=>m.uci===uci) || legalCache.find(m=> (m.from+m.to)===uci.slice(0,4));
              const fromFenBefore = currentFen;
              if (move){
                selectedSq = move.from; onCellClick(move.to,'');
                lastAppliedFromFen = fromFenBefore;
              } else {
                // Fallback: apply via engine directly (handles promo suffix etc.)
                const nextFen = window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(currentFen, uci, {castleSafety:true}) : null;
                if (nextFen && !/^\{"error"/.test(nextFen)){
                  currentFen = nextFen; addMove(uci); refreshLegal(); renderBoard(); refreshFenDisplay();
                   try { updateQuietRule(uci); } catch {}
                  lastAppliedFromFen = fromFenBefore;
                  logActivity(`Applied engine move directly: ${uci}`,'ok');
                } else {
                  logActivity(`Engine best move not found/applicable: ${uci}`,'warn');
                }
              }
              if (typeof st.status.best.score === 'number'){
                const pawns = (st.status.best.score/100).toFixed(5);
                $('#score').text((st.status.best.score>=0?'+':'') + pawns);
              }
               // Self-play draw rule check
               if (selfPlayActive && quietHalfPlies >= 10){
                 logActivity('Draw (dev 5-move rule triggered during async search loop)','ok');
                 enginePaused = true; selfPlayActive=false; updateRunStateLabel(false);
               }
            }
          }
        } else {
          if (lastRequestedFen === currentFen) return; // only once per FEN
          lastRequestedFen = currentFen;
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
            updateRunStateLabel(false); // synchronous path; treat as idle after response
            const move = legalCache.find(m=>m.uci===uci) || legalCache.find(m=> (m.from+m.to)===uci.slice(0,4));
            if (move){ selectedSq = move.from; onCellClick(move.to,''); }
            if (typeof obj.best.score === 'number'){
              const pawns = (obj.best.score/100).toFixed(5);
              $('#score').text((obj.best.score>=0?'+':'') + pawns);
            }
             if (selfPlayActive && quietHalfPlies >= 10){
               logActivity('Draw (dev 5-move rule triggered during sync loop)','ok');
               enginePaused = true; selfPlayActive=false; updateRunStateLabel(false);
             }
          } else if (obj && obj.error){
            logActivity(`Engine error: ${obj.error}`,'err');
          } else if (obj && obj.candidates && obj.candidates.length===0){
            logActivity('Engine reports no candidate moves', 'warn');
          } else {
            logActivity('Engine returned no decision or parse failed', 'warn');
          }
        }
      } catch (e){ logActivity(`Engine error: ${e&&e.message?e.message:'unknown'}`, 'err'); }
    }
    else {
      updateRunStateLabel(false);
    }
  }, 2000);

   // Quiet rule updater: resets on capture or pawn move; increments otherwise; promotion counts as pawn move.
   function updateQuietRule(uci){
     try {
       if (!uci || uci.length < 4) return;
       const stm = currentFen.split(' ')[1]; // After move application this is next side; we need previous stm.
       // Reconstruct previous side by flipping.
       const prevStm = (stm==='w') ? 'b' : 'w';
       const boardBefore = parseBoardArray(lastAppliedFromFen || currentFen); // approximate: if lastAppliedFromFen set we use that as before state
       const from = uci.slice(0,2), to = uci.slice(2,4);
       const piece = getPieceAt(boardBefore, from);
       const target = getPieceAt(boardBefore, to);
       const isPawn = piece && piece.toLowerCase()==='p';
       const isCapture = target && target !== '.' && ((prevStm==='w' && target>='a' && target<='z') || (prevStm==='b' && target>='A' && target<='Z'));
       const isPromotion = isPawn && (to.endsWith('8') || to.endsWith('1')) && uci.length===5;
       if (isPawn || isCapture || isPromotion){ quietHalfPlies = 0; }
       else { quietHalfPlies++; }
     } catch {}
   }

   // Self-Play button: forces observe mode and runs until draw rule or game end.
   $('#btnSelfPlay').on('click', () => {
     if (!engineReady){ alert('Engine not ready'); return; }
     $('#sideSelect').val('observe');
     selfPlayActive = true; enginePaused = false; quietHalfPlies = 0;
     logActivity('Self-Play started (dev 5-move draw rule active)');
     // Kick engine if starting side is white and observe will allow engine move
     lastRequestedFen = null; lastAppliedFromFen = null;
   });

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
