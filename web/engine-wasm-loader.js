// Loader stub for future native WASM engine compiled from C++ bitboard core.
// Dynamically loads `web/wasm/engine-native.wasm` if present and exposes a
// minimal API compatible with existing EngineBridge usage.

(function(global){
  'use strict';
  // Hierarchy (browser): Native WASM > JS bitboard > legacy
  // Server-native process remains outside this loader.
  const wasmPath = 'wasm/engine-native.wasm';
  let wasmInstance = null;
  let memory = null;
  let exports = null;
  let ready = false;
  let textEncoder = new TextEncoder();
  let textDecoder = new TextDecoder();

  function allocCString(str) {
    if (!exports || !memory || !exports.malloc) return 0;
    const bytes = textEncoder.encode(str + '\0');
    const ptr = exports.malloc(bytes.length);
    if (!ptr) return 0;
    const memU8 = new Uint8Array(memory.buffer, ptr, bytes.length);
    memU8.set(bytes);
    return ptr;
  }
  function readCString(ptr) {
    if (!ptr || !memory) return '';
    const memU8 = new Uint8Array(memory.buffer);
    let end = ptr;
    while (end < memU8.length && memU8[end] !== 0) end++;
    return textDecoder.decode(memU8.subarray(ptr, end));
  }

  async function loadNative() {
    if (ready) return exports;
    try {
      const resp = await fetch(wasmPath, { cache: 'no-store' });
      if (!resp.ok) throw new Error('native wasm not found');
      const bytes = await resp.arrayBuffer();
      const mod = await WebAssembly.instantiate(bytes, {
        env: {
          // Minimal stubs; extend if engine uses them
          puts: (p) => { try { console.log('[native]', readCString(p)); } catch {} },
          abort: () => { throw new Error('WASM abort'); }
        }
      });
      wasmInstance = mod.instance;
      exports = wasmInstance.exports;
      memory = exports.memory || null;
      if (!memory) throw new Error('memory export missing');
      ready = true;
      if (global.EngineBridge) {
        global.EngineBridge.nativeReady = true;
        global.EngineBridge.nativeExports = exports;
      }
      console.log('[engine-wasm-loader] native engine loaded');
      return exports;
    } catch (e) {
      console.warn('[engine-wasm-loader] failed to load native wasm:', e.message);
      return null;
    }
  }

  async function nativeChooseBestMove(fen, depth) {
    if (!fen) return null;
    const exp = await loadNative();
    if (!exp) return null;
    const fn = exp.engine_choose;
    if (typeof fn !== 'function') { console.warn('engine_choose export missing'); return null; }
    const ptrFen = allocCString(fen);
    if (!ptrFen) return null;
    // engine_choose returns a pointer to a static buffer (char*)
    const retPtr = fn(ptrFen, depth|0);
    const move = readCString(retPtr);
    return move || null;
  }

  async function nativePerft(fen, depth) {
    const exp = await loadNative();
    if (!exp) return 0n;
    const fn = exp.engine_perft;
    if (typeof fn !== 'function') return 0n;
    const ptrFen = allocCString(fen);
    if (!ptrFen) return 0n;
    const nodes = fn(ptrFen, depth|0);
    // engine_perft returns 64-bit? Here assumed unsigned long long fits JS Number; cast to BigInt if needed.
    return BigInt(nodes);
  }

  // Integrate with existing EngineBridge chooseBestMove if present
  function patchBridge() {
    if (!global.EngineBridge) return;
    if (global.EngineBridge._nativeWrapped) return;
    const original = global.EngineBridge.chooseBestMove;
    global.EngineBridge.chooseBestMove = function(fen, optionsJson) {
      // If native loaded and depth small, delegate for speed; else fallback
      if (ready && exports && exports.engine_choose) {
        let depth = 1;
        try { if (optionsJson) { const opts = JSON.parse(optionsJson); depth = (opts.searchDepth||opts.depth||1)|0; } } catch {}
        return JSON.stringify({
          native: true,
            best: { uci: (global.EngineBridge.nativeLast = null), score: null },
            depth,
            move: null,
            perft: null,
            result: (async () => {
              const mv = await nativeChooseBestMove(fen, depth);
              global.EngineBridge.nativeLast = mv;
              return mv;
            })()
        });
      }
      return original.call(global.EngineBridge, fen, optionsJson);
    };
    global.EngineBridge.nativePerft = nativePerft;
    global.EngineBridge._nativeWrapped = true;
  }

  if (typeof window !== 'undefined') {
    // Attempt immediate load; non-fatal if missing
    loadNative().then(()=>patchBridge()).catch(()=>{});
    patchBridge();
  }

  global.NativeEngineLoader = { loadNative, nativeChooseBestMove, nativePerft, ready: () => ready };
})(typeof window !== 'undefined' ? window : globalThis);
