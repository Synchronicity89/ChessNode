// Detect hosting environment and disable unsupported controls.
(function(){
  const HOST_INFO = {
    hostname: window.location.hostname,
    href: window.location.href,
    isGithubPages: /\.github\.io$/i.test(window.location.hostname),
  };

  // Capability probes (dynamic): try to fetch wasm head and see if same-origin writes possible.
  async function detectCapabilities(){
    const caps = { wasm:false, localWrite:false };
    try {
      const res = await fetch('wasm/engine.js', { method:'HEAD' });
      caps.wasm = res.ok;
    } catch(e){ caps.wasm = false; }
    // localWrite heuristic: attempt to set localStorage and cookie
    try {
      const key = 'capTest_'+Date.now();
      localStorage.setItem(key,'1');
      localStorage.removeItem(key);
      document.cookie = 'capTest=1;path=/';
      caps.localWrite = true;
    } catch(e){ caps.localWrite = false; }
    return caps;
  }

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
    }
    // Elements annotated with data-pages-incompatible should be disabled on GitHub Pages.
    if (HOST_INFO.isGithubPages){
      document.querySelectorAll('[data-pages-incompatible]').forEach(el=>disableElement(el,'Unavailable on this hosted build'));
      const msgs = [];
      if (!caps.wasm) msgs.push('WASM engine not found');
      if (document.querySelector('[data-pages-incompatible][disabled]')) msgs.push('some controls are disabled on static hosting');
      if (msgs.length) explainOnce('Limited features: ' + msgs.join('; ') + '.');
    }
  }

  window.addEventListener('DOMContentLoaded', async () => {
    const caps = await detectCapabilities();
    applyPolicy(caps);
  });
})();
