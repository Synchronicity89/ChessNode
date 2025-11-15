// Engine bridge: loads wasm/engine.js if present, exposes C exports, and notifies readiness.

const EngineBridge = (() => {
  let wasmAvailable = false;
  let wasmReady = false;
  let Module = null; // Emscripten module when loaded
  // Cached function pointers and capability flags
  let fn_start_search = null, fn_cancel_search = null, fn_get_search_status = null;
  let fn_score_children = null;
  let fn_set_seed = null;
  let hasAsync = false;
  let hasScoreChildren = false;

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
      const bust = Date.now();
      const canUseThreads = !!(self && self.crossOriginIsolated);
      // If not cross-origin isolated, skip pthreads candidates to avoid load failures
      const candidates = canUseThreads ? [
        'wasm/engine_pthreads.js?v='+bust,
        'wasm/engine_pthreads.js',
        'wasm/engine.js?v='+bust,
        'wasm/engine.js'
      ] : [
        'wasm/engine.js?v='+bust,
        'wasm/engine.js'
      ];
      for (const url of candidates){
        try {
          await loadScript(url);
          if (typeof window.EngineModulePthreads === 'function') {
            Module = await window.EngineModulePthreads(); wasmReady=true; break;
          } else if (typeof window.EngineModule === 'function') {
            Module = await window.EngineModule(); wasmReady=true; break;
          } else if (typeof window.Module !== 'undefined' && window.Module.ready){
            Module = await window.Module.ready; wasmReady=true; break;
          }
        } catch(e){ /* try next */ }
      }
    }
    wasmAvailable = !!Module;
    // Probe exported functions once and cache pointers for capability detection
    if (wasmReady && Module && Module.cwrap){
      try { fn_start_search = Module.cwrap('start_search','string',['string','string']); } catch(e) { fn_start_search = null; }
      try { fn_cancel_search = Module.cwrap('cancel_search','void',[]); } catch(e) { fn_cancel_search = null; }
      try { fn_get_search_status = Module.cwrap('get_search_status','string',[]); } catch(e) { fn_get_search_status = null; }
      try { fn_score_children = Module.cwrap('score_children','string',['string','string']); } catch(e) { fn_score_children = null; }
      try { fn_set_seed = Module.cwrap('set_engine_random_seed','void',['number']); } catch(e) { fn_set_seed = null; }
      hasAsync = !!(fn_start_search && fn_get_search_status);
      hasScoreChildren = !!fn_score_children;
    }
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
    if (wasmReady && fn_score_children){
      try { const opt = options ? JSON.stringify(options) : null; return fn_score_children(fen||'', opt); } catch(e){}
    }
    return null;
  }

  // Async search control wrappers (optional engine exports)
  function startSearch(fen, options){
    if (wasmReady && fn_start_search){
      try { const opt = options ? JSON.stringify(options) : null; return fn_start_search(fen||'', opt); } catch(e){}
    }
    return null;
  }
  function cancelSearch(){
    if (wasmReady && fn_cancel_search){ try { fn_cancel_search(); return true; } catch(e){} }
    return false;
  }
  function getSearchStatus(){
    if (wasmReady && fn_get_search_status){ try { return fn_get_search_status(); } catch(e){} }
    return null;
  }

  function setRandomSeed(seed){
    if (wasmReady && fn_set_seed){ try { fn_set_seed(seed|0); return true; } catch(e){} }
    return false;
  }

  function supportsAsync(){ return !!hasAsync; }
  function supportsScoreChildren(){ return !!hasScoreChildren; }

  return { init, getVersion, evaluateFEN, evaluateFENOptions, evaluateMoveLine, generateDescendants, listLegalMoves, applyMoveIfLegal, chooseBestMove, scoreChildren, startSearch, cancelSearch, getSearchStatus, supportsAsync, supportsScoreChildren, setRandomSeed };
})();

// Expose bridge on window for pages/scripts that reference window.EngineBridge
try { window.EngineBridge = EngineBridge; } catch {}

window.addEventListener('DOMContentLoaded', () => {
  EngineBridge.init();
});
