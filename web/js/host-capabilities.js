// Detect hosting environment and disable unsupported controls WITHOUT network 404 spam.
(function(){
  const HOST_INFO = {
    hostname: window.location.hostname,
    href: window.location.href,
    isGithubPages: /\.github\.io$/i.test(window.location.hostname),
  };

  // Capability detection strategy (no HEAD requests):
  // 1. Listen for 'engine-bridge-ready' event emitted by ui-engine-bridge.js.
  // 2. Fallback after a timeout if engine not reported.
  // 3. Local write capability tested via localStorage/cookie (fast, no network).
  function detectLocalWrite(){
    try {
      const key = 'capTest_'+Date.now();
      localStorage.setItem(key,'1');
      localStorage.removeItem(key);
      document.cookie = 'capTest=1;path=/';
      return true;
    } catch(e){ return false; }
  }

  let caps = { wasm:false, localWrite: detectLocalWrite(), decided:false };

  function finalizeCaps(){
    if (caps.decided) return caps; caps.decided = true; applyPolicy(caps); return caps;
  }

  window.addEventListener('engine-bridge-ready', (e)=>{
    if (e && e.detail) {
      caps.wasm = !!e.detail.wasmReady;
    }
    finalizeCaps();
  }, { once:true });

  // Fallback: if bridge never fires (script missing), decide after 1s.
  window.addEventListener('DOMContentLoaded', ()=>{
    setTimeout(()=>finalizeCaps(), 1000);
  });

  function explainOnce(msg){
    if (document.getElementById('hostCapabilityNotice')) return;
    const box = document.createElement('div');
    box.id = 'hostCapabilityNotice';
    box.style.cssText = 'background:#ffe5b4;color:#333;padding:8px 12px;margin:8px 0;border:1px solid #d28;';
    box.innerHTML = '<strong>Hosting Notice:</strong> ' + msg + ' (Detected host: '+HOST_INFO.hostname+')';
    const target = document.querySelector('header') || document.body;
    target.parentNode.insertBefore(box, target.nextSibling);
  }

  function disableElement(el, reason){
    el.setAttribute('disabled','disabled');
    el.classList.add('host-disabled');
    el.title = 'Disabled: '+reason;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'){
      el.value = ''; el.placeholder = 'Disabled: '+reason;
    }
  }

  function applyPolicy(caps){
    // Elements annotated with data-requires-wasm should be disabled if wasm missing.
    if (!caps.wasm){
      document.querySelectorAll('[data-requires-wasm]').forEach(el=>disableElement(el,'WASM engine not available here'));
      // Hard-disable the whole GUI and show an error overlay in red
      try {
        if (!document.getElementById('wasmErrorOverlay')){
          const ov = document.createElement('div');
          ov.id = 'wasmErrorOverlay';
          ov.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:99999;';
          const msg = document.createElement('div');
          msg.style.cssText = 'max-width:800px;margin:0 16px;padding:16px 20px;border:2px solid #b00020;background:#fff0f0;color:#b00020;font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:16px;line-height:1.5;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,0.3)';
          msg.innerHTML = '<strong>Engine Unavailable:</strong> The C++ chess engine (WASM) failed to load, so the GUI is disabled.<br>'+
                           'Please ensure the <code>wasm/engine.js</code> and associated WASM files are present and served, then reload.';
          ov.appendChild(msg);
          document.body.appendChild(ov);
          // Block all pointer/keyboard interaction beneath overlay
          document.body.style.pointerEvents = 'none';
          ov.style.pointerEvents = 'auto';
        }
      } catch {}
    }
    // Elements annotated with data-pages-incompatible should be disabled on GitHub Pages.
    if (HOST_INFO.isGithubPages){
      document.querySelectorAll('[data-pages-incompatible]').forEach(el=>disableElement(el,'Unavailable on this hosted build'));
      const msgs = [];
      if (!caps.wasm) msgs.push('WASM engine not found');
      if (document.querySelector('[data-pages-incompatible][disabled]')) msgs.push('some controls are disabled on static hosting');
      if (msgs.length) explainOnce('Limited features: ' + msgs.join('; ') + '.');
    }

    // Update engine status indicator if present
    try {
      const el = document.getElementById('engineStatus');
      if (el){
        if (caps.wasm){ el.textContent = 'ready'; el.classList.remove('bad'); el.classList.add('ok'); }
        else { el.textContent = 'unavailable'; el.classList.remove('ok'); el.classList.add('bad'); }
      }
    } catch {}
  }

  // (Policy application now triggered by finalizeCaps)
})();
