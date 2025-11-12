// Placeholder board implementation: maintains simple move list only.
(function(){
  const moveListEl = $('#moveList');
  const boardHost = $('#board');
  let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let ply = 1;
  let selectedSq = null; // algebraic like 'e2'
  let legalCache = []; // cached legal moves for current position
  let cfg = (window.EngineConfig && window.EngineConfig.load()) || null;
  let evalCfg = (window.EngineEvalConfig && window.EngineEvalConfig.load()) || null;
  const engineModeEl = () => $('#engineMode');

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

  function refreshEvalScore(){
    if (!window.EngineBridge) { $('#score').text('engine-unavailable'); return; }
    evalCfg = (window.EngineEvalConfig && window.EngineEvalConfig.load()) || evalCfg;
    const opts = evalCfg ? window.EngineEvalConfig.toEngineOptions(evalCfg) : null;
    let cp = null;
    if (window.EngineBridge.evaluateFENOptions && opts){
      cp = window.EngineBridge.evaluateFENOptions(currentFen, opts);
    } else if (window.EngineBridge.evaluateFEN){
      cp = window.EngineBridge.evaluateFEN(currentFen);
    }
    if (cp===null || cp===undefined){ $('#score').text('engine-unavailable'); return; }
    const pawns = (cp/100).toFixed(3);
    $('#score').text((cp>=0?'+':'') + pawns);
  }

  function maybeAppendPromotion(uci, fromAlg, toAlg){
    // If a pawn move reaches last rank and no promo char, append 'q'
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

  // Helpers for line-based scoring
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
  function manhattanToCenter(alg){
    if (!alg) return 0; const rc = algToRC(alg); if (!rc) return 0;
    const centers = ['d4','e4','d5','e5'].map(algToRC);
    let best = 99; for (const c of centers){ if (!c) continue; const d = Math.abs(c.r - rc.r) + Math.abs(c.c - rc.c); if (d<best) best=d; }
    return best===99?0:best;
  }
  function locateKing(boardGrid, side){
    const target = side==='w' ? 'K' : 'k';
    for (let r=0;r<8;r++) for (let c=0;c<8;c++){ if (boardGrid[r][c]===target){ return rcToAlg(r,c); } }
    return null;
  }
  function countOpponentStrength(boardGrid, opponentSide){
    // S = 3*(N+B) + 5*R + 9*Q for opponent
    let n=0,b=0,r=0,q=0; const isOpp = opponentSide==='w'?isUpper:isLower;
    for (let r0=0;r0<8;r0++) for (let c0=0;c0<8;c0++){
      const ch = boardGrid[r0][c0]; if (!ch || ch==='.' ) continue;
      if (isOpp(ch)){
        const lc = ch.toLowerCase();
        if (lc==='n') n++; else if (lc==='b') b++; else if (lc==='r') r++; else if (lc==='q') q++;
      }
    }
    return 3*(n+b) + 5*r + 9*q;
  }
  function endgamishFactor(boardGrid, opponentSide, cfg){
    const S = countOpponentStrength(boardGrid, opponentSide);
    const T = (cfg?.endgamishness?.T) ?? 31; const L = (cfg?.endgamishness?.L) ?? 6;
    let x = (T - S) / Math.max(1e-9, (T - L)); x = Math.max(0, Math.min(1, x));
    if ((cfg?.endgamishness?.form||'linear') === 'logistic'){
      const slope = cfg?.endgamishness?.slope ?? 5; const mid = cfg?.endgamishness?.midpoint ?? 1.0;
      const dOver = (S===0?0:(S / Math.max(1e-9, T)));
      const z = (dOver/(mid)) - 1; x = 1/(1+Math.exp(slope*z));
    }
    const min = cfg?.endgamishness?.min ?? 0; const max = cfg?.endgamishness?.max ?? 1;
    x = Math.max(min, Math.min(max, x));
    const pow = cfg?.endgamishnessPow ?? 1.0;
    return Math.pow(x, pow);
  }
  function isCaptureMove(uci, boardGrid, stm){
    if (!uci || uci.length<4) return false; const dst = uci.slice(2,4);
    const piece = getPieceAt(boardGrid, dst);
    if (piece && piece!=='.'){
      // destination occupied by someone
      return (stm==='w' && isLower(piece)) || (stm==='b' && isUpper(piece));
    }
    // crude en passant detection omitted
    return false;
  }
  function plyEquivalentForMove(uci, boardGrid, tradeEq, stm){
    return isCaptureMove(uci, boardGrid, stm) ? (tradeEq||0.5) : 1.0;
  }
  function riskAtDepth(dEq, D, riskCfg){
    const type = (riskCfg?.type)||'exponential';
    const x = Math.max(0, (dEq/Math.max(1e-9, D||0.0001)) - 1);
    let r;
    if (type==='logistic'){
      const slope = riskCfg?.slope ?? 5; const m = riskCfg?.midpointMultiplier ?? 1.0;
      r = 1/(1+Math.exp(slope*((dEq/(Math.max(1e-9, m*(D||0.0001)))) - 1)));
    } else {
      const k = Math.max(1.000001, riskCfg?.kAt2x ?? 100);
      r = Math.exp(-Math.log(k)*x);
    }
    const p = riskCfg?.riskPow ?? 1.0; return Math.pow(r, p);
  }

  function chooseEngineMove(mode){
    if (!legalCache || !legalCache.length) return null;
    if (mode === 'greedy1'){
      // Evaluate each legal move with risk-aware and geometry terms; pick best for side to move.
      const stm = (currentFen.split(' ')[1]||'w');
      let cfg2 = (window.EngineEvalConfig && window.EngineEvalConfig.toLineEvalOptions && window.EngineEvalConfig.toLineEvalOptions()) || null;
      evalCfg = (window.EngineEvalConfig && window.EngineEvalConfig.load()) || evalCfg;
      const baseOpts = evalCfg ? window.EngineEvalConfig.toEngineOptions(evalCfg) : null;
      // Current base eval for potentialGain baseline
      const baseEval = (window.EngineBridge.evaluateFENOptions && baseOpts) ? window.EngineBridge.evaluateFENOptions(currentFen, baseOpts) : (window.EngineBridge.evaluateFEN? window.EngineBridge.evaluateFEN(currentFen):0);
      const boardNow = parseBoardArray(currentFen);
      let best = null; let bestScore = null;
      for (const m of legalCache){
        let uci = m.uci || (m.from+m.to);
        uci = maybeAppendPromotion(uci, m.from, m.to);
        const nextFen = window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(currentFen, uci, {castleSafety:true}) : null;
        if (!nextFen || /^\{"error"/.test(nextFen)) continue;
        const nextEval = (window.EngineBridge.evaluateFENOptions && baseOpts) ? window.EngineBridge.evaluateFENOptions(nextFen, baseOpts) : (window.EngineBridge.evaluateFEN? window.EngineBridge.evaluateFEN(nextFen):null);
        if (nextEval===null || nextEval===undefined) continue;
        const potentialGain = (nextEval - (baseEval||0));
        // Opponent reply sampling
        let potentialLoss = 0;
        try {
          const oppMovesJson = window.EngineBridge.listLegalMoves ? window.EngineBridge.listLegalMoves(nextFen, null, {castleSafety:true}) : null;
          const oppMoves = oppMovesJson ? (JSON.parse(oppMovesJson).moves||[]) : [];
          // Sample up to 12 opponent moves for speed
          const sample = oppMoves.slice(0, 12);
          let worstEval = nextEval;
          for (const om of sample){
            const n2 = window.EngineBridge.applyMoveIfLegal(nextFen, om.uci, {castleSafety:true});
            if (!n2 || /^\{"error"/.test(n2)) continue;
            const ev2 = (window.EngineBridge.evaluateFENOptions && baseOpts) ? window.EngineBridge.evaluateFENOptions(n2, baseOpts) : (window.EngineBridge.evaluateFEN? window.EngineBridge.evaluateFEN(n2):null);
            if (ev2===null || ev2===undefined) continue;
            if (stm==='w'){ if (ev2 < worstEval) worstEval = ev2; }
            else { if (ev2 > worstEval) worstEval = ev2; }
          }
          if (stm==='w') potentialLoss = Math.max(0, nextEval - worstEval); else potentialLoss = Math.max(0, worstEval - nextEval);
        } catch {}
        // Ply-equivalent depth: our move + one reply
        const p1 = plyEquivalentForMove(uci, boardNow, cfg2?.tradePlyDepthEquivalent, stm);
        const dEq = p1 + 1.0;
        const risk = riskAtDepth(dEq, cfg2?.opponentPlyDepth||4, cfg2?.plyDepthRisk);
        const gainScale = cfg2?.plyDepthRisk?.gainScale ?? 1.0;
        const lossScale = cfg2?.plyDepthRisk?.lossScale ?? 1.0;
        const blendAlpha = cfg2?.plyDepthRisk?.blendAlpha ?? 1.0;
        const lineRiskBonus = (gainScale*potentialGain*(1 - risk)) - ((1 - blendAlpha)*lossScale*potentialLoss*risk);
        // Geometry rewards
        const boardNext = parseBoardArray(nextFen);
        const centers = ['d4','e4','d5','e5'];
        const engineIsUpper = (stm==='w');
        let startCount=0, endCount=0; for (const sq of centers){
          const ch0 = getPieceAt(boardNow, sq), ch1 = getPieceAt(boardNext, sq);
          if (engineIsUpper){ if (isUpper(ch0)) startCount++; if (isUpper(ch1)) endCount++; }
          else { if (isLower(ch0)) startCount++; if (isLower(ch1)) endCount++; }
        }
        const netCenter = (endCount - startCount);
        const centerReward = (cfg2?.centerPiecePlacementReward||0) * netCenter * (cfg2?.mix?.weightCenter ?? 1.0);
        // King center reward with endgamishness
        const engineKingStart = locateKing(boardNow, stm);
        const engineKingEnd = locateKing(boardNext, stm);
        const improv = Math.max(0, manhattanToCenter(engineKingStart) - manhattanToCenter(engineKingEnd));
        const endg = endgamishFactor(boardNext, (stm==='w'?'b':'w'), cfg2);
        const kPow = cfg2?.kingCenterImprovementPow ?? 1.0;
        const kingCenterReward = (cfg2?.endGameKingCenterMagnet||0) * Math.pow(improv, kPow) * endg * (cfg2?.mix?.weightKingCenter ?? 1.0);
        // Combine
        const combined = nextEval + centerReward + kingCenterReward + (lineRiskBonus * (cfg2?.mix?.weightRisk ?? 1.0));
        if (best===null){ best = m; bestScore = combined; continue; }
        if ((stm==='w' && combined>bestScore) || (stm==='b' && combined<bestScore)){
          best = m; bestScore = combined;
        }
      }
      return best || null;
    }
    // Default/random
    const idx = Math.floor(Math.random()*legalCache.length);
    return legalCache[idx];
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
        refreshEvalScore();
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
    refreshEvalScore();
  });

  $('#loadFen').on('click', () => {
    const fen = $('#ioText').val().trim();
    if (!fen) { alert('Paste a FEN into the textbox first.'); return; }
    currentFen = fen;
    const score = EngineBridge.evaluateFEN(fen);
    $('#score').text(score===null? 'engine-unavailable' : ((score>=0?'+':'')+Math.round(score/100)) );
    refreshLegal(); renderBoard(); addMove('Loaded FEN');
    refreshEvalScore();
  });

  // Self-play observe mode placeholder (still random, not engine logic)
  setInterval(() => {
    const side = $('#sideSelect').val();
    if (side === 'observe' && legalCache.length){
      const mv = chooseEngineMove(engineModeEl().val());
      selectedSq = mv.from; onCellClick(mv.to,'');
    }
    // If human vs engine: pick random reply for the engine side (weak baseline)
    if ((side === 'white' || side === 'black') && legalCache.length){
      const stm = currentFen.split(' ')[1];
      const humanSide = side === 'white' ? 'w' : 'b';
      if (stm !== humanSide){
        const mv = chooseEngineMove(engineModeEl().val());
        selectedSq = mv.from; onCellClick(mv.to,'');
      }
    }
  }, 6000);

  $(function(){
    if (cfg?.search?.maxDepth) $('#depth').val(String(cfg.search.maxDepth));
    refreshLegal(); renderBoard(); addMove('Game start');
    refreshEvalScore();
  });
})();
