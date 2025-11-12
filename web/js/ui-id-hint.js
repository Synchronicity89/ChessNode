// UI ID Hint: show element id on hover or context menu for quick code search.
(function(){
  const hint = document.createElement('div');
  hint.style.cssText = 'position:fixed;pointer-events:none;background:#222;color:#fff;font:11px monospace;padding:2px 5px;border-radius:3px;z-index:9999;opacity:0;transition:opacity .12s';
  document.body.appendChild(hint);

  function showId(e, target){
    if (!target || !target.id) { hide(); return; }
    hint.textContent = '#' + target.id;
    const x = e.clientX + 12, y = e.clientY + 12;
    hint.style.left = x + 'px';
    hint.style.top = y + 'px';
    hint.style.opacity = '1';
  }
  function hide(){ hint.style.opacity='0'; }

  document.addEventListener('mouseover', (e)=>{
    if (e.altKey) showId(e, e.target); else hide();
  });
  document.addEventListener('contextmenu', (e)=>{
    showId(e, e.target);
    setTimeout(hide, 1500);
  });
})();