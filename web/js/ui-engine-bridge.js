// Minimal engine bridge placeholder.
// Attempts to detect presence of wasm/engine.wasm and logs mode.

const EngineBridge = (() => {
  let wasmAvailable = false;
  let wasmReady = false;
  let Module = null; // Emscripten module when loaded

  async function detectWasm() {
    try {
      // Prefer emscripten JS glue (engine.js), which will load the wasm for us
      const jsHead = await fetch('wasm/engine.js', { method: 'HEAD' });
      if (jsHead.ok) {
        wasmAvailable = true;
        return 'emscripten-js';
      }
      // Fallback check: raw wasm present (not typically used without glue)
      const res = await fetch('wasm/engine.wasm', { method: 'HEAD' });
      wasmAvailable = res.ok;
      return wasmAvailable ? 'raw-wasm' : 'none';
    } catch (e) {
      wasmAvailable = false;
      return 'none';
    }
  }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }

  async function init() {
    const mode = await detectWasm();
    if (mode === 'emscripten-js') {
      try {
        await loadScript('wasm/engine.js');
        if (typeof window.EngineModule === 'function') {
          Module = await window.EngineModule();
          wasmReady = true;
          console.log('[EngineBridge] Emscripten module loaded.');
        } else if (typeof window.Module !== 'undefined' && window.Module.ready) {
          Module = await window.Module.ready; // best-effort fallback
          wasmReady = true;
          console.log('[EngineBridge] Emscripten Module (global) loaded.');
        } else {
          console.warn('[EngineBridge] engine.js present but no EngineModule factory found. Falling back to JS stub.');
        }
      } catch (e) {
        console.warn('[EngineBridge] Failed to load engine.js; using JS stub.', e);
      }
    } else if (mode === 'raw-wasm') {
      console.log('[EngineBridge] engine.wasm detected without JS glue; using JS stub.');
    } else {
      console.log('[EngineBridge] No engine module found. Running in JS-only placeholder mode.');
    }
  }

  function getVersion() {
    if (wasmReady && Module) {
      try {
        const fn = Module.cwrap ? Module.cwrap('engine_version', 'number', []) : null;
        if (fn) return 'wasm:' + fn();
      } catch (e) {
        // fall through to stub
      }
    }
    return 'js:stub-1';
  }

  function evaluateFEN(fen) {
    if (wasmReady && Module && Module.cwrap) {
      try {
        const fn = Module.cwrap('evaluate_fen', 'number', ['string']);
        if (fn) {
          return fn(fen || '');
        }
      } catch (e) {
        // fallback to JS
      }
    }
    // JS fallback: material-only eval matching C++ placeholder.
    const vals = { p:100, n:300, b:300, r:500, q:900 };
    if (!fen) return 0;
    const board = fen.split(' ')[0] || '';
    let score = 0;
    for (const c of board) {
      if (c === '/' || /[1-8]/.test(c)) continue;
      const lower = c.toLowerCase();
      const v = vals[lower] || 0;
      if (c === lower) score -= v; else score += v; // lowercase => black
    }
    return score;
  }

  return { init, getVersion, evaluateFEN };
})();

window.addEventListener('DOMContentLoaded', () => {
  EngineBridge.init();
});
