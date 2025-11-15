// Position Descendants Explorer: fast pseudo move generator + N+1 filter (browser-only)
(function(){
  const parentList = $('#parentList');
  const childList = $('#childList');
  const statusEl = $('#exploreStatus');
  const boardEl = $('#visBoard');
  const metaEl = $('#visMeta');
  const perfEl = $('#perfDetails');
  const scoresPanel = $('#scoresPanel');
  const engineInfoEl = $('#engineInfo');
  let selectedParentFen = null; // track currently selected parent for scoring

  // Board utils -------------------------------------------------------------
  function parseFEN(fen){
    const parts = (fen||'').trim().split(/\s+/);
    if (parts.length < 4) throw new Error('Bad FEN');
    const boardPart = parts[0];
    const stm = parts[1];
    const castling = parts[2];
    const ep = parts[3];
    const half = parts[4] ? parseInt(parts[4],10) : 0;
    const full = parts[5] ? parseInt(parts[5],10) : 1;
    const rows = boardPart.split('/');
    if (rows.length !== 8) throw new Error('Bad FEN rows');
    const board = Array.from({length:8},()=>Array(8).fill('.'));
    for (let r=0;r<8;r++){
      let c=0;
      for (const ch of rows[r]){
        if (/[1-8]/.test(ch)) c += parseInt(ch,10);
        else { board[r][c]=ch; c++; }
      }
      if (c!==8) throw new Error('Bad FEN row width');
    }
    return {board, stm, castling, ep, half, full};
  }
  function clonePos(pos){
    return {
      board: pos.board.map(row=>row.slice()),
      stm: pos.stm,
      castling: pos.castling,
      ep: pos.ep,
      half: pos.half,
      full: pos.full,
    };
  }
  function inBounds(r,c){ return r>=0 && r<8 && c>=0 && c<8; }
  function isWhite(ch){ return ch>='A' && ch<='Z'; }
  function isBlack(ch){ return ch>='a' && ch<='z'; }
  function sideIsWhite(stm){ return stm==='w'; }

  function toFEN(pos){
    const rows = [];
    for (let r=0;r<8;r++){
      let run=0; let row='';
      for (let c=0;c<8;c++){
        const ch = pos.board[r][c];
        if (ch==='.') run++; else { if (run){row+=String(run); run=0;} row+=ch; }
      }
      if (run) row+=String(run);
      rows.push(row);
    }
    const boardPart = rows.join('/');
    return `${boardPart} ${pos.stm} ${pos.castling||'-'} ${pos.ep||'-'} ${pos.half||0} ${pos.full||1}`;
  }

  // Visualization -----------------------------------------------------------
  const PIECE = {
    'P':'♙','N':'♘','B':'♗','R':'♖','Q':'♕','K':'♔',
    'p':'♟','n':'♞','b':'♝','r':'♜','q':'♛','k':'♚'
  };
  function renderBoard(pos){
    const ep = pos.ep && pos.ep !== '-' ? pos.ep : null;
    const epRC = ep? algebraicToRC(ep): null;
    const table = $('<table>').css({borderCollapse:'collapse', width:'100%', height:'100%'});
    for (let r=0;r<8;r++){
      const tr=$('<tr>');
      for (let c=0;c<8;c++){
        const td=$('<td>');
        const dark = (r+c)%2===1;
        td.css({border:'1px solid #999', textAlign:'center', fontSize:'22px', background: dark? '#b58863' : '#f0d9b5'});
        const ch = pos.board[r][c];
        td.text(PIECE[ch]||'');
        if (epRC && epRC.r===r && epRC.c===c){ td.css('outline','3px solid #2c7'); }
        tr.append(td);
      }
      table.append(tr);
    }
    boardEl.empty().append(table);
    metaEl.html(`Side: <b>${pos.stm}</b><br>Castling: <b>${pos.castling||'-'}</b><br>En Passant: <b>${pos.ep||'-'}</b><br>Halfmove: ${pos.half||0} Fullmove: ${pos.full||1}`);
  }
  function algebraicToRC(sq){
    if (!sq || sq==='-' || sq.length!==2) return null;
    const file = sq.charCodeAt(0)-97; // a=0
    const rank = 8 - (sq.charCodeAt(1)-48); // '1'..'8'
    if (file<0||file>7||rank<0||rank>7) return null;
    return {r:rank,c:file};
  }
  function rcToAlgebraic(r,c){ return String.fromCharCode(97+c) + String(8-r); }

  // All chess engine business logic removed from JS; generation now exclusively in C++.

  // UI wiring ---------------------------------------------------------------
  function listParents(tree){
    parentList.empty();
    if (!tree || !Array.isArray(tree.nodes)){
      const fallbackRoot = $('#rootFen').val().trim();
      const li=$('<li>').text('[root] ' + fallbackRoot.substring(0,80)).css('cursor','pointer');
      li.on('click', ()=>{ selectParent({nodes:[], root:fallbackRoot}, fallbackRoot); });
      parentList.append(li);
      return;
    }
    if (!tree.root){ tree.root = $('#rootFen').val().trim(); }
    const seen = new Set();
    const includeRoot = !!cfg.includeRootInList;
    if (includeRoot){
      seen.add(tree.root);
      const li=$('<li>').text('[root] ' + tree.root.substring(0,80)).css('cursor','pointer');
      li.on('click', ()=>{ selectParent(tree, tree.root); });
      parentList.append(li);
    }
    let any=false;
    for (const n of tree.nodes){
      if (!n || n.parent===undefined) continue;
      if (!includeRoot && n.parent === tree.root) continue;
      if (!seen.has(n.parent)){
        seen.add(n.parent);
        const label = (n.parent === tree.root ? '[root] ' : '') + String(n.parent).substring(0,80);
        const li=$('<li>').text(label).css('cursor','pointer');
        li.on('click', ()=>{ selectParent(tree, n.parent); });
        parentList.append(li); any=true;
      }
    }
    if (!any){
      if (!includeRoot){
        // Provide root fallback entry
        const li=$('<li>').text('[root] ' + tree.root.substring(0,80)).css('cursor','pointer');
        li.on('click', ()=>{ selectParent(tree, tree.root); });
        parentList.append(li);
      }
      parentList.append($('<li>').text('No parents (generator stub)'));
    }
  }
  function selectParent(tree, fen){
    childList.empty();
    selectedParentFen = fen;
    renderBoard(parseFEN(fen));
    for (const n of tree.nodes){
      if (n.parent===fen){
        const text = n.fen + (n.n1? `  [N+1: ${n.n1}]` : '');
        const li=$('<li>').text(text).css('cursor','pointer');
        li.on('click', ()=>{ renderBoard(parseFEN(n.fen)); });
        childList.append(li);
      }
    }
    if (!childList.children().length) childList.append($('<li>').text('No children.'));
  }

  function loadConfigDefaults(){
    const def = {
      includeCastling: true,
      includeEnPassant: true,
      promotions: 'qrbn',
      capPerParent: 200,
      uniquePerPly: false,
      includeRootInList: false,
      castleSafety: true
    };
    try {
      const saved = localStorage.getItem('descConfig');
      if (saved) return Object.assign(def, JSON.parse(saved));
    } catch(e){}
    return def;
  }
  const cfg = loadConfigDefaults();

  // Inject simple config controls (lightweight; future: separate panel)
  const extra = $(
    '<div class="extra-desc-cfg" style="margin:8px 0 12px; display:flex; flex-wrap:wrap; gap:12px; font-size:12px;">'
    + '<label>Castling <input id="cfgCastling" type="checkbox" '+(cfg.includeCastling?'checked':'')+'></label>'
    + '<label>Castle Safety <input id="cfgCastleSafety" type="checkbox" '+(cfg.castleSafety?'checked':'')+'></label>'
    + '<label>En Passant <input id="cfgEnPassant" type="checkbox" '+(cfg.includeEnPassant?'checked':'')+'></label>'
    + '<label>Promotions <input id="cfgPromotions" type="text" value="'+cfg.promotions+'" size="5" placeholder="qrbn"></label>'
    + '<label>Cap/Parent <input id="cfgCapPerParent" type="number" min="0" value="'+cfg.capPerParent+'" style="width:70px"></label>'
    + '<label>Unique/Ply <input id="cfgUnique" type="checkbox" '+(cfg.uniquePerPly?'checked':'')+'></label>'
    + '<label>Include Root <input id="cfgIncludeRoot" type="checkbox" '+(cfg.includeRootInList?'checked':'')+'></label>'
    + '</div>'
  );
  $('.desc-config').after(extra);

  function readOptions(){
    const o = {
      includeCastling: $('#cfgCastling').is(':checked'),
      castleSafety: $('#cfgCastleSafety').is(':checked'),
      includeEnPassant: $('#cfgEnPassant').is(':checked'),
      promotions: ($('#cfgPromotions').val()||'qrbn').trim(),
      capPerParent: Math.max(0, parseInt($('#cfgCapPerParent').val()||'0',10)),
      uniquePerPly: $('#cfgUnique').is(':checked'),
      includeRootInList: $('#cfgIncludeRoot').is(':checked')
    };
    localStorage.setItem('descConfig', JSON.stringify(o));
    return o;
  }

  $('#runExplore').on('click', ()=>{
    try{
      const fen = $('#rootFen').val().trim();
      const depth = Number($('#plyDepth').val()||1);
      let enableN1 = $('#enableNplus1').is(':checked');
      statusEl.text('Running...');
      setTimeout(()=>{
        // Require WASM engine; no JS fallback
        const options = readOptions();
        // No GUI guardrails: do not auto-disable features based on depth
        if (window.EngineBridge && window.EngineBridge.generateDescendants) {
          const t0 = performance.now();
          const json = window.EngineBridge.generateDescendants(fen, depth, !!enableN1, options);
          const tree = typeof json === 'string' ? JSON.parse(json) : json;
          const t1 = performance.now();
          statusEl.text(`Nodes: ${tree.nodes.length} in ${(tree.perf?.elapsedMs ?? (t1-t0)).toFixed(1)} ms`);
          if (perfEl && tree.perf) {
            const b = (tree.perf.ply||[]).map(s=>`Ply ${s.ply}: ${s.generated}`).join(' | ');
            perfEl.text(`Generated: ${tree.perf.totalNodes} | ${b}`);
          }
          $('#exportTree').off('click').on('click', ()=>{
            tree.config = options; // inject config for export visibility
            $('#treeOut').val(JSON.stringify(tree));
          });
          // Update in-memory cfg to reflect most recent settings for list rendering
          Object.assign(cfg, options);
          listParents(tree);
        } else {
          statusEl.css('color','#b00020').text('Engine unavailable: WASM not loaded; GUI disabled.');
          return;
        }
      }, 10);
    }catch(e){ statusEl.text('Error: '+e.message); }
  });

  // --- Line scoring (uses engine WASM primitives + UI eval config, no production code changes) ---
  // Utilities copied from play UI for scoring parity
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
  function isUpper(ch){ return !!ch && ch>='A' && ch<='Z'; }
  function isLower(ch){ return !!ch && ch>='a' && ch<='z'; }
  function manhattanToCenterRC(r,c){ const centers=[[3,3],[3,4],[4,3],[4,4]]; let best=99; for (const [rr,cc] of centers){ const d=Math.abs(rr-r)+Math.abs(cc-c); if (d<best) best=d; } return best===99?0:best; }
  function locateKingRC(grid, white){ const target = white?'K':'k'; for (let r=0;r<8;r++) for (let c=0;c<8;c++){ if (grid[r][c]===target) return {r,c}; } return null; }
  function countOpponentStrength(grid, opponentIsWhite){ let n=0,b=0,r=0,q=0; for (let r0=0;r0<8;r0++) for (let c0=0;c0<8;c0++){ const ch = grid[r0][c0]; if (!ch || ch==='.') continue; if (opponentIsWhite?isUpper(ch):isLower(ch)){ const lc = ch.toLowerCase(); if (lc==='n') n++; else if (lc==='b') b++; else if (lc==='r') r++; else if (lc==='q') q++; } } return 3*(n+b)+5*r+9*q; }
  function endgamishness(grid, opponentIsWhite){ const T=31, L=6; const S = countOpponentStrength(grid, opponentIsWhite); let x = (T - S) / Math.max(1, (T - L)); if (x<0) x=0; if (x>1) x=1; return x; }
  function countOwnInCenter(grid, rootWhite){ const centers=[[3,3],[3,4],[4,3],[4,4]]; let cnt=0; for (const [r,c] of centers){ const ch=grid[r][c]; if (ch && ch!=='.' && ((rootWhite && isUpper(ch)) || (!rootWhite && isLower(ch)))) cnt++; } return cnt; }

  // --- Development / forward control helpers (opponent-half control) ---
  function inB(r,c){ return r>=0 && r<8 && c>=0 && c<8; }
  function addRayControls(grid, ctrl, r,c, dr,dc){
    let i=r+dr, j=c+dc;
    while (inB(i,j)){
      ctrl[i][j] = true;
      if (grid[i][j] !== '.') break; // stop at first blocker
      i += dr; j += dc;
    }
  }
  function computeControls(grid, sideWhite){
    const ctrl = Array.from({length:8}, ()=>Array(8).fill(false));
    for (let r=0;r<8;r++){
      for (let c=0;c<8;c++){
        const ch = grid[r][c]; if (ch==='.') continue;
        const own = sideWhite ? isUpper(ch) : isLower(ch); if (!own) continue;
        const lc = ch.toLowerCase();
        if (lc==='p'){
          const dr = sideWhite ? -1 : +1;
          if (inB(r+dr, c-1)) ctrl[r+dr][c-1] = true;
          if (inB(r+dr, c+1)) ctrl[r+dr][c+1] = true;
        } else if (lc==='n'){
          const K = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
          for (const d of K){ const i=r+d[0], j=c+d[1]; if (inB(i,j)) ctrl[i][j] = true; }
        } else if (lc==='k'){
          for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++){
            if (!dr && !dc) continue; const i=r+dr, j=c+dc; if (inB(i,j)) ctrl[i][j]=true;
          }
        }
        if (lc==='b' || lc==='q'){
          addRayControls(grid, ctrl, r,c, -1,-1); addRayControls(grid, ctrl, r,c, -1,1);
          addRayControls(grid, ctrl, r,c, 1,-1);  addRayControls(grid, ctrl, r,c, 1,1);
        }
        if (lc==='r' || lc==='q'){
          addRayControls(grid, ctrl, r,c, -1,0); addRayControls(grid, ctrl, r,c, 1,0);
          addRayControls(grid, ctrl, r,c, 0,-1); addRayControls(grid, ctrl, r,c, 0,1);
        }
      }
    }
    return ctrl;
  }
  function developmentControlScore(grid, engineWhite, devIncentive, rankAttackFactor, countThreatOccupied){
    const ctrl = computeControls(grid, engineWhite);
    let sum = 0.0;
    for (let r=0;r<8;r++){
      for (let c=0;c<8;c++){
        const inOppHalf = engineWhite ? (r<=3) : (r>=4);
        if (!inOppHalf) continue;
        if (!ctrl[r][c]) continue;
        if (!countThreatOccupied && grid[r][c] !== '.') continue;
        const rdepth = engineWhite ? Math.max(1, Math.min(4, 4 - r))
                                   : Math.max(1, Math.min(4, r - 3));
        sum += devIncentive * Math.pow(rankAttackFactor, rdepth);
      }
    }
    return sum;
  }

  function fenCastlingRights(fen){ const parts=(fen||'').trim().split(/\s+/); return parts.length>=3? (parts[2]||'-'):'-'; }

  function computeRootRef(fen, evalCfg){
    const stm = (fen||'').split(' ')[1]||'w';
    const rootWhite = (stm==='w');
    const grid = parseBoardArray(fen);
    const startCenter = countOwnInCenter(grid, rootWhite);
    const kk = locateKingRC(grid, rootWhite);
    const startKMan = kk ? manhattanToCenterRC(kk.r, kk.c) : 0;
    const kkOpp = locateKingRC(grid, !rootWhite);
    const startKR = kk ? kk.r : -1, startKC = kk ? kk.c : -1;
    const oppStartKR = kkOpp ? kkOpp.r : -1, oppStartKC = kkOpp ? kkOpp.c : -1;
    const startRights = fenCastlingRights(fen);
    const devIncentive = Number((evalCfg && evalCfg.developmentIncentive) || 0);
    const rankAttackFactor = Number((evalCfg && evalCfg.rankAttackFactor) || 1.0);
    const countThreatOccupied = !!(evalCfg && evalCfg.notJustEmptySquaresThreatReward);
    const startDevScore = developmentControlScore(grid, rootWhite, devIncentive, rankAttackFactor, countThreatOccupied);
    return { rootWhite, startCenter, startKMan, startDevScore, startKR, startKC, oppStartKR, oppStartKC, startRights };
  }

  function combinedScore(fen, rootRef, evalCfg){
    // Base eval from engine (material/tempo etc.)
    const opts = window.EngineEvalConfig ? window.EngineEvalConfig.toEngineOptions(evalCfg) : null;
    const base = (window.EngineBridge && window.EngineBridge.evaluateFENOptions && opts) ? window.EngineBridge.evaluateFENOptions(fen, opts) : 0;
    const grid = parseBoardArray(fen);
    const endg = endgamishness(grid, !rootRef.rootWhite);
    const endCenter = countOwnInCenter(grid, rootRef.rootWhite);
    const centerDelta = endCenter - rootRef.startCenter;
    const kk = locateKingRC(grid, rootRef.rootWhite);
    const kMan = kk ? manhattanToCenterRC(kk.r, kk.c) : 0;
    const kingImp = Math.max(0, rootRef.startKMan - kMan);
    const centerReward = Number((evalCfg && evalCfg.centerPiecePlacementReward) || 0);
    const kingMagnet = Number((evalCfg && evalCfg.endGameKingCenterMagnet) || 0);
    const geom = centerReward * centerDelta + kingMagnet * kingImp * endg;
    // Development control delta since root
    const devIncentive = Number((evalCfg && evalCfg.developmentIncentive) || 0);
    const rankAttackFactor = Number((evalCfg && evalCfg.rankAttackFactor) || 1.0);
    const countThreatOccupied = !!(evalCfg && evalCfg.notJustEmptySquaresThreatReward);
    const devNow = developmentControlScore(grid, rootRef.rootWhite, devIncentive, rankAttackFactor, countThreatOccupied);
    const devDelta = devNow - (rootRef.startDevScore||0);

    // Castling/King terms (engine-centric, white-centric reporting)
    const castleK = Number((evalCfg && evalCfg.castleKingSideReward) || 0);
    const castleQ = Number((evalCfg && evalCfg.castleQueenSideReward) || 0);
    const kingNon = Number((evalCfg && evalCfg.kingNonCastleMovePenalty) || 0);
    let castleTerm = 0.0;
    if (castleK || castleQ || kingNon){
      const rightsNow = fenCastlingRights(fen) || '-';
      function isCastledK(white){
        const k = locateKingRC(grid, white); if (!k) return false;
        if (white){ if (k.r!==7 || k.c!==6) return false; return grid[7][5]==='R'; }
        else { if (k.r!==0 || k.c!==6) return false; return grid[0][5]==='r'; }
      }
      function isCastledQ(white){
        const k = locateKingRC(grid, white); if (!k) return false;
        if (white){ if (k.r!==7 || k.c!==2) return false; return grid[7][3]==='R'; }
        else { if (k.r!==0 || k.c!==2) return false; return grid[0][3]==='r'; }
      }
      function kingMovedNonCastle(white, startR, startC){ const homeR = white?7:0, homeC=4; if (startR!==homeR || startC!==homeC) return false; const k=locateKingRC(grid, white); if (!k) return false; if (k.r===homeR && k.c===homeC) return false; if ((k.r===(white?7:0)) && (k.c===6 || k.c===2)) return false; return true; }
      function hadRight(white, kside){ const flag = white? (kside?'K':'Q') : (kside?'k':'q'); return (rootRef.startRights||'').indexOf(flag) !== -1; }
      function hasRightNow(white, kside){ const flag = white? (kside?'K':'Q') : (kside?'k':'q'); return (rightsNow||'').indexOf(flag) !== -1; }
      // Engine side
      if (isCastledK(rootRef.rootWhite)) castleTerm += castleK;
      if (isCastledQ(rootRef.rootWhite)) castleTerm += castleQ;
      if (kingNon>0 && kingMovedNonCastle(rootRef.rootWhite, rootRef.startKR, rootRef.startKC)) castleTerm -= kingNon;
      if (hadRight(rootRef.rootWhite, true) && !hasRightNow(rootRef.rootWhite, true)){
        if (!isCastledK(rootRef.rootWhite) && !kingMovedNonCastle(rootRef.rootWhite, rootRef.startKR, rootRef.startKC)) castleTerm -= castleK;
      }
      if (hadRight(rootRef.rootWhite, false) && !hasRightNow(rootRef.rootWhite, false)){
        if (!isCastledQ(rootRef.rootWhite) && !kingMovedNonCastle(rootRef.rootWhite, rootRef.startKR, rootRef.startKC)) castleTerm -= castleQ;
      }
      // Opponent inverted
      if (isCastledK(!rootRef.rootWhite)) castleTerm -= castleK;
      if (isCastledQ(!rootRef.rootWhite)) castleTerm -= castleQ;
      if (kingNon>0 && kingMovedNonCastle(!rootRef.rootWhite, rootRef.oppStartKR, rootRef.oppStartKC)) castleTerm += kingNon;
      if (hadRight(!rootRef.rootWhite, true) && !hasRightNow(!rootRef.rootWhite, true)){
        if (!isCastledK(!rootRef.rootWhite) && !kingMovedNonCastle(!rootRef.rootWhite, rootRef.oppStartKR, rootRef.oppStartKC)) castleTerm += castleK;
      }
      if (hadRight(!rootRef.rootWhite, false) && !hasRightNow(!rootRef.rootWhite, false)){
        if (!isCastledQ(!rootRef.rootWhite) && !kingMovedNonCastle(!rootRef.rootWhite, rootRef.oppStartKR, rootRef.oppStartKC)) castleTerm += castleQ;
      }
    }
    const engineSideLocal = rootRef.rootWhite ? +1 : -1;
    // Convert engine-centric terms (geom, devDelta, castleTerm) to white-centric using engine side
    return base + engineSideLocal * (geom + devDelta + castleTerm);
  }

  async function listLegalMovesEngine(fen, options){
    const json = window.EngineBridge && window.EngineBridge.listLegalMoves ? window.EngineBridge.listLegalMoves(fen, null, options||null) : null;
    if (!json) return [];
    let obj = null; try { obj = JSON.parse(json); } catch {}
    const arr = obj && Array.isArray(obj.moves) ? obj.moves : [];
    // Map to UCIs only
    return arr.map(m=>m.uci || (m.from+m.to));
  }

  function applyMoveEngine(fen, uci, options){
    return window.EngineBridge && window.EngineBridge.applyMoveIfLegal ? window.EngineBridge.applyMoveIfLegal(fen, uci, options||null) : null;
  }

  async function scoreLinesForParent(parentFen, depth){
    scoresPanel.empty();
    if (!parentFen){ scoresPanel.text('Select a parent first.'); return; }
    const evalCfg = (window.EngineEvalConfig && window.EngineEvalConfig.toLineEvalOptions) ? window.EngineEvalConfig.toLineEvalOptions() : null;
    const engineOpts = (window.EngineEvalConfig && window.EngineEvalConfig.toEngineOptions) ? window.EngineEvalConfig.toEngineOptions(evalCfg) : {};
    engineOpts.searchDepth = depth|0;
    if (!(window.EngineBridge && window.EngineBridge.scoreChildren)){
      scoresPanel.css('color','#b00020').text('Engine unavailable: WASM not loaded; GUI disabled.');
      return;
    }
    if (!(window.EngineBridge && typeof window.EngineBridge.supportsScoreChildren==='function' && window.EngineBridge.supportsScoreChildren())){
      scoresPanel.css('color','#b00020').text('Engine build lacks score_children export. Rebuild with that symbol exported or use chooseBestMove per child.');
      return;
    }
    const json = window.EngineBridge.scoreChildren(parentFen, engineOpts);
    if (!json){ scoresPanel.text('No data from engine.'); return; }
    let obj=null; try { obj = JSON.parse(json); } catch(e1){
      // Attempt a lenient fix for trailing commas: remove any ,] and ,}
      let fixed = json.replace(/,\s*([\]\}])/g, '$1');
      try { obj = JSON.parse(fixed); }
      catch(e2){
        scoresPanel.html(`<div style="color:#b00020">JSON parse error: ${e1.message}</div><pre>${json.replace(/</g,'&lt;')}</pre>`); return;
      }
    }
    const results = [];
    const parentNodes = (typeof obj.nodes === 'number') ? obj.nodes : null;
    for (const ch of (obj.children||[])){
      results.push({ uci: ch.uci, best: ch.agg|0, imm: ch.imm|0, pv: Array.isArray(ch.pv)? ch.pv.slice(): [], nodes: (ch.nodes|0), actualPlies: (ch.actualPlies|0), continuationReasons: Array.isArray(ch.continuationReasons)? ch.continuationReasons.slice(): [], dbg: ch.dbg||null });
    }
    const elapsed = 0;

    // Pretty print
    const pre = $('<pre>');
    pre.append(`Parent: ${parentFen}\nDepth: ${depth}  (elapsed ${elapsed} ms${parentNodes!==null?`, nodes=${parentNodes}`:''})\n`);
    for (const r of results){
      pre.append(`\nChild ${r.uci}: best=${Math.round(r.best)} cp (imm=${Math.round(r.imm)} cp)`);
      if (typeof r.nodes === 'number') pre.append(` [nodes=${r.nodes}]`);
      if (typeof r.actualPlies === 'number' && r.actualPlies>0) pre.append(` [plies=${r.actualPlies}]`);
      pre.append(`\n`);
      if (r.pv && r.pv.length){ pre.append(`  PV: ${r.pv.join(' ')}\n`); }
      if (r.continuationReasons && r.continuationReasons.length){ pre.append(`  ext: ${r.continuationReasons.join(', ')}\n`); }
      if (r.dbg){ pre.append(`  dbg: base=${r.dbg.base|0}, centerΔ=${r.dbg.centerDelta|0}, kingImp=${r.dbg.kingImp|0}\n`); }
    }
    scoresPanel.empty().append(pre);
  }

  $('#scoreLines').on('click', ()=>{
    const depth = Number($('#plyDepth').val()||1);
    const fen = selectedParentFen || ($('#rootFen').val().trim());
    scoreLinesForParent(fen, depth);
  });

  // Show engine version/status when ready
  jQuery(function(){
    try {
      const updateInfo = ()=>{
        if (window.EngineBridge && typeof window.EngineBridge.getVersion === 'function'){
          const v = window.EngineBridge.getVersion();
          if (engineInfoEl && engineInfoEl.length){ engineInfoEl.text('Engine: ' + v); }
        }
      };
      window.addEventListener('engine-bridge-ready', updateInfo, { once: true });
      // In case it was ready before DOM, do a late update
      setTimeout(updateInfo, 500);
    } catch {}
  });

})();
