// Engine bridge: loads wasm/engine.js if present, exposes C exports, and notifies readiness.

const EngineBridge = (() => {
  let wasmAvailable = false;
  let wasmReady = false;
  let Module = null; // Emscripten module when loaded

  async function detectWasm() {
    // Avoid HEAD probes that spam console/network. We'll try to load engine.js directly below.
    return 'emscripten-js';
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
        // Cache-bust engine.js to ensure latest build is loaded in the browser
        const bust = Date.now();
        try {
          await loadScript('wasm/engine.js?v=' + bust);
        } catch (e) {
          // Fallback without cache buster
          await loadScript('wasm/engine.js');
        }
        if (typeof window.EngineModule === 'function') {
          Module = await window.EngineModule();
          wasmReady = true;
          //console.log('[EngineBridge] Emscripten module loaded.');
        } else if (typeof window.Module !== 'undefined' && window.Module.ready) {
          Module = await window.Module.ready; // best-effort fallback
          wasmReady = true;
          //console.log('[EngineBridge] Emscripten Module (global) loaded.');
        } else {
          // Leave wasmReady=false; engine not available.
        }
      } catch (e) {
        // Silently ignore; engine not available.
      }
    } else {
      // No engine module found.
    }
    wasmAvailable = !!Module;
    try {
      window.dispatchEvent(new CustomEvent('engine-bridge-ready', { detail: { wasmReady, wasmAvailable, mode, Module } }));
    } catch {}
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
        if (fn) return fn(fen || '');
      } catch (e) {}
    }
    return null; // engine not available
  }

  function evaluateFENOptions(fen, options){
    if (wasmReady && Module && Module.cwrap) {
      try {
        const fn = Module.cwrap('evaluate_fen_opts', 'number', ['string','string']);
        const opt = options ? JSON.stringify(options) : null;
        if (fn) return fn(fen||'', opt);
      } catch(e){}
    }
    return null;
  }

  function generateDescendants(fen, depth, nplus1, options){
    // WASM path: prefer configurable entry if available
    if (wasmReady && Module && Module.cwrap) {
      try {
        const fnExt = Module.cwrap('generate_descendants_opts', 'string', ['string','number','number','string']);
        if (fnExt) return fnExt(fen, depth|0, nplus1?1:0, options ? JSON.stringify(options) : null);
      } catch(e){ /* try basic */ }
      try {
        const fn = Module.cwrap('generate_descendants', 'string', ['string','number','number']);
        if (fn) return fn(fen, depth|0, nplus1?1:0);
      } catch(e){ /* fall through */ }
    }
    return null; // JS fallback handled in caller
  }

  function listLegalMoves(fen, fromSq, options){
    if (wasmReady && Module && Module.cwrap){
      try {
        const fn = Module.cwrap('list_legal_moves','string',['string','string','string']);
        const opt = options ? JSON.stringify(options) : null;
        return fn(fen||'', fromSq||null, opt);
      } catch(e){}
    }
    return null;
  }

  function applyMoveIfLegal(fen, uci, options){
    if (wasmReady && Module && Module.cwrap){
      try {
        const fn = Module.cwrap('apply_move_if_legal','string',['string','string','string']);
        const opt = options ? JSON.stringify(options) : null;
        return fn(fen||'', uci||'', opt);
      } catch(e){}
    }
    return null;
  }

  function evaluateMoveLine(fen, moves, options){
    if (wasmReady && Module && Module.cwrap){
      try {
        const fn = Module.cwrap('evaluate_move_line','string',['string','string','string']);
        const opt = options ? JSON.stringify(options) : null;
        const movesJson = JSON.stringify(moves || []);
        return fn(fen||'', movesJson, opt);
      } catch(e){}
    }
    return null;
  }

  function chooseBestMove(fen, options){
    if (wasmReady && Module && Module.cwrap){
      try {
        const fn = Module.cwrap('choose_best_move','string',['string','string']);
        const opt = options ? JSON.stringify(options) : null;
        return fn(fen||'', opt);
      } catch(e){}
    }
    return null;
  }

  function scoreChildren(fen, options){
    if (wasmReady && Module && Module.cwrap){
      try {
        const fn = Module.cwrap('score_children','string',['string','string']);
        const opt = options ? JSON.stringify(options) : null;
        return fn(fen||'', opt);
      } catch(e){}
    }
    return null;
  }

  return { init, getVersion, evaluateFEN, evaluateFENOptions, evaluateMoveLine, generateDescendants, listLegalMoves, applyMoveIfLegal, chooseBestMove, scoreChildren };
})();

// Expose bridge on window for pages/scripts that reference window.EngineBridge
try { window.EngineBridge = EngineBridge; } catch {}

window.addEventListener('DOMContentLoaded', () => {
  EngineBridge.init();
});
