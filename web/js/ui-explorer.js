// Position Descendants Explorer: fast pseudo move generator + N+1 filter (browser-only)
(function(){
  const parentList = $('#parentList');
  const childList = $('#childList');
  const statusEl = $('#exploreStatus');
  const boardEl = $('#visBoard');
  const metaEl = $('#visMeta');

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

  // Pseudo move generation --------------------------------------------------
  function addMove(moves, from, to, promo){ moves.push({from, to, promo:promo||null}); }
  function genPawn(pos, r, c, white, moves){
    const dir = white? -1: +1;
    const startRank = white? 6: 1;
    const lastRank = white? 0: 7;
    const one = {r:r+dir, c};
    if (inBounds(one.r,one.c) && pos.board[one.r][one.c]==='.'){
      if (one.r===lastRank){ ['q','r','b','n'].forEach(p=>addMove(moves,{r,c},one,p)); }
      else addMove(moves,{r,c},one);
      const two = {r:r+2*dir, c};
      if (r===startRank && pos.board[two.r][two.c]==='.'){
        addMove(moves,{r,c},two);
      }
    }
    // captures
    for (const dc of [-1,+1]){
      const t={r:r+dir,c:c+dc};
      if (!inBounds(t.r,t.c)) continue;
      const target = pos.board[t.r][t.c];
      if (target!=='.' && (white? isBlack(target): isWhite(target))){
        if (t.r===lastRank){ ['q','r','b','n'].forEach(p=>addMove(moves,{r,c},t,p)); }
        else addMove(moves,{r,c},t);
      }
    }
    // en passant
    if (pos.ep && pos.ep!=='-'){
      const epRC = algebraicToRC(pos.ep);
      if (epRC && epRC.r===r+dir && Math.abs(epRC.c-c)===1){
        addMove(moves,{r,c},{r:epRC.r, c:epRC.c});
      }
    }
  }
  function genLeaper(pos, r, c, white, moves, deltas){
    for (const d of deltas){
      const t={r:r+d[0], c:c+d[1]};
      if (!inBounds(t.r,t.c)) continue;
      const target = pos.board[t.r][t.c];
      if (target==='.' || (white? isBlack(target): isWhite(target))) addMove(moves,{r,c},t);
    }
  }
  function genSlider(pos, r, c, white, moves, deltas){
    for (const d of deltas){
      let tr=r+ d[0], tc=c+ d[1];
      while (inBounds(tr,tc)){
        const target = pos.board[tr][tc];
        if (target==='.') { addMove(moves,{r,c},{r:tr,c:tc}); }
        else { if (white? isBlack(target): isWhite(target)) addMove(moves,{r,c},{r:tr,c:tc}); break; }
        tr+=d[0]; tc+=d[1];
      }
    }
  }
  function genKing(pos, r, c, white, moves){
    genLeaper(pos,r,c,white,moves,[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]);
    // include castling squares (no legality checks for now)
    if (white && pos.castling && /K/.test(pos.castling)) addMove(moves,{r,c},{r:7,c:6});
    if (white && pos.castling && /Q/.test(pos.castling)) addMove(moves,{r,c},{r:7,c:2});
    if (!white && pos.castling && /k/.test(pos.castling)) addMove(moves,{r,c},{r:0,c:6});
    if (!white && pos.castling && /q/.test(pos.castling)) addMove(moves,{r,c},{r:0,c:2});
  }
  function genPseudoMoves(pos){
    const moves=[]; const white = sideIsWhite(pos.stm);
    for (let r=0;r<8;r++) for (let c=0;c<8;c++){
      const ch = pos.board[r][c]; if (ch==='.') continue;
      if (white && !isWhite(ch)) continue; if (!white && !isBlack(ch)) continue;
      switch (ch.toLowerCase()){
        case 'p': genPawn(pos,r,c,white,moves); break;
        case 'n': genLeaper(pos,r,c,white,moves,[[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]]); break;
        case 'b': genSlider(pos,r,c,white,moves,[[1,1],[1,-1],[-1,1],[-1,-1]]); break;
        case 'r': genSlider(pos,r,c,white,moves,[[1,0],[-1,0],[0,1],[0,-1]]); break;
        case 'q': genSlider(pos,r,c,white,moves,[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]); break;
        case 'k': genKing(pos,r,c,white,moves); break;
      }
    }
    return moves;
  }

  // Apply move (pseudo): updates board, stm, castling, ep, clocks ----------------
  function applyMove(pos, mv){
    const np = clonePos(pos);
    const from = mv.from, to = mv.to; const piece = np.board[from.r][from.c];
    const white = isWhite(piece);
    // Handle en passant capture
    const isPawn = piece.toLowerCase()==='p';
    const epNow = np.ep && np.ep!=='-' ? algebraicToRC(np.ep) : null;
    if (isPawn && epNow && to.r===epNow.r && to.c===epNow.c && np.board[to.r][to.c]==='.'){
      // capture pawn behind target square
      const capR = white? to.r+1 : to.r-1;
      np.board[capR][to.c]='.';
    }
    // Move rook on castling
    if (piece.toLowerCase()==='k' && Math.abs(to.c-from.c)===2){
      // white short/long or black
      if (white && to.c===6){ np.board[7][5]=np.board[7][7]; np.board[7][7]='.'; }
      if (white && to.c===2){ np.board[7][3]=np.board[7][0]; np.board[7][0]='.'; }
      if (!white && to.c===6){ np.board[0][5]=np.board[0][7]; np.board[0][7]='.'; }
      if (!white && to.c===2){ np.board[0][3]=np.board[0][0]; np.board[0][0]='.'; }
    }
    // Update castling rights if king/rook moved or captured
    function removeCastling(flags){ if (!np.castling||np.castling==='-') return;
      let s=np.castling; for (const f of flags) s=s.replace(f,''); np.castling = s||'-'; }
    if (piece==='K') removeCastling(['K','Q']);
    if (piece==='k') removeCastling(['k','q']);
    if (piece==='R' && from.r===7 && from.c===0) removeCastling(['Q']);
    if (piece==='R' && from.r===7 && from.c===7) removeCastling(['K']);
    if (piece==='r' && from.r===0 && from.c===0) removeCastling(['q']);
    if (piece==='r' && from.r===0 && from.c===7) removeCastling(['k']);
    const captured = np.board[to.r][to.c];

    // Move piece
    np.board[to.r][to.c] = mv.promo ? (white? mv.promo.toUpperCase(): mv.promo.toLowerCase()) : piece;
    np.board[from.r][from.c] = '.';

    // Pawn double step -> set ep square
    np.ep = '-';
    if (isPawn && Math.abs(to.r-from.r)===2){
      const midR = (to.r+from.r)/2; np.ep = rcToAlgebraic(midR, from.c);
    }

    // Clocks and stm
    np.half = (isPawn || captured!=='.') ? 0 : (np.half||0)+1;
    if (!white) np.full = (np.full||1)+1; // black moved
    np.stm = white? 'b':'w';

    return np;
  }

  // N+1 filter: reward/flag moves based on king presence at depth N+1 ----------
  function nPlus1Filter(pos){
    // Simple signals: missing opponent king => mate; missing own king => illegal/losing
    let hasWK=false, hasBK=false;
    for (let r=0;r<8;r++) for (let c=0;c<8;c++){
      const ch=pos.board[r][c]; if (ch==='K') hasWK=true; if (ch==='k') hasBK=true;
    }
    if (!hasWK && hasBK) return { tag: 'own-king-missing' };
    if (!hasBK && hasWK) return { tag: 'opponent-king-missing' };
    if (!hasWK && !hasBK) return { tag: 'both-kings-missing' };
    return { tag: 'ok' };
  }

  // Explore -----------------------------------------------------------------
  function explore(rootFen, depth, enableN1){
    const root = parseFEN(rootFen);
    const tree = { root: rootFen, depth, nodes: [] };
    const parents = [{ fen: rootFen, pos: root, depth:0 }];
    for (let d=0; d<depth; d++){
      const next=[];
      for (const p of parents){
        const moves = genPseudoMoves(p.pos);
        for (const mv of moves){
          const child = applyMove(p.pos, mv);
          const fen = toFEN(child);
          const node = { parent: p.fen, fen, d:d+1 };
          if (enableN1 && d===depth-1){
            // N+1 shallow check
            const moves2 = genPseudoMoves(child);
            // Evaluate a first child if any, else evaluate current position
            const target = moves2.length? applyMove(child,moves2[0]) : child;
            node.n1 = nPlus1Filter(target).tag;
          }
          tree.nodes.push(node);
          next.push({ fen, pos: child, depth: d+1 });
        }
      }
      if (!next.length) break;
      parents.splice(0, parents.length, ...next);
    }
    return tree;
  }

  // UI wiring ---------------------------------------------------------------
  function listParents(tree){
    parentList.empty();
    const seen = new Set();
    for (const n of tree.nodes){
      if (n.d===0) continue;
      if (!seen.has(n.parent)){
        seen.add(n.parent);
        const li=$('<li>').text(n.parent.substring(0,80)).css('cursor','pointer');
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

  $('#runExplore').on('click', ()=>{
    try{
      const fen = $('#rootFen').val().trim();
      const depth = Math.max(1, Math.min(8, Number($('#plyDepth').val()||1)));
      const enableN1 = $('#enableNplus1').is(':checked');
      statusEl.text('Running...');
      setTimeout(()=>{
        const t0 = performance.now();
        const tree = explore(fen, depth, enableN1);
        const t1 = performance.now();
        statusEl.text(`Nodes: ${tree.nodes.length} in ${(t1-t0).toFixed(1)} ms`);
        listParents(tree);
        $('#exportTree').off('click').on('click', ()=>{
          $('#treeOut').val(JSON.stringify(tree));
        });
      }, 10);
    }catch(e){ statusEl.text('Error: '+e.message); }
  });

})();
