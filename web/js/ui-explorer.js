// Position Descendants Explorer: fast pseudo move generator + N+1 filter (browser-only)
(function(){
  const parentList = $('#parentList');
  const childList = $('#childList');
  const statusEl = $('#exploreStatus');
  const boardEl = $('#visBoard');
  const metaEl = $('#visMeta');
  const perfEl = $('#perfDetails');

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
    const seen = new Set();
    const includeRoot = !!cfg.includeRootInList;
    // Optionally place root first
    if (includeRoot) {
      seen.add(tree.root);
      const li=$('<li>').text('[root] ' + tree.root.substring(0,80)).css('cursor','pointer');
      li.on('click', ()=>{ selectParent(tree, tree.root); });
      parentList.append(li);
    }
    for (const n of tree.nodes){
      if (n.d===0) continue;
      if (!includeRoot && n.parent === tree.root) continue; // omit root unless requested
      if (!seen.has(n.parent)){
        seen.add(n.parent);
        const label = (n.parent === tree.root ? '[root] ' : '') + n.parent.substring(0,80);
        const li=$('<li>').text(label).css('cursor','pointer');
        li.on('click', ()=>{ selectParent(tree, n.parent); });
        parentList.append(li);
      }
    }
    if (!seen.size) parentList.append($('<li>').text('No parents (depth too small?)'));
  }
  function selectParent(tree, fen){
    childList.empty();
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
      capPerParent: 0,
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
      const depth = Math.max(1, Math.min(8, Number($('#plyDepth').val()||1)));
      const enableN1 = $('#enableNplus1').is(':checked');
      statusEl.text('Running...');
      setTimeout(()=>{
        // Prefer WASM implementation when available, else fallback to JS
        const options = readOptions();
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
          // Fallback stub (no engine available): produce empty tree with metadata only.
          const tree = { root: fen, depth, nodes: [], perf: { totalNodes:0, ply:[], elapsedMs:0 }, note: 'engine-unavailable' };
          statusEl.text('Engine unavailable (no WASM).');
          perfEl.text('No generation performed.');
          listParents(tree);
          $('#exportTree').off('click').on('click', ()=>{
            $('#treeOut').val(JSON.stringify(tree));
          });
        }
      }, 10);
    }catch(e){ statusEl.text('Error: '+e.message); }
  });

})();
