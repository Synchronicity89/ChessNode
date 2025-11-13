// Engine configuration manager: static, works on GitHub Pages.
(function(){
  const KEY = 'engineConfig.v1';
  const $status = () => $('#configStatus');

  function defaults() {
    return {
      version: 1,
      search: {
        maxDepth: 6,
        timeMs: 3000,
        aspWindow: 75,
        nullMove: true,
        lmr: true,
        futility: true,
        randomness: 0,
        stopOnMate: true,
        mode: 'best', // 'best' | 'drawish' | 'explore'
        drawWeights: { repetition: 30, simplify: 20, safety: 10 }
      }
    };
  }

  function readForm() {
    const f = document.getElementById('engineConfigForm');
    if (!f) return null;
    return {
      version: 1,
      search: {
        maxDepth: Number(f.maxDepth.value || 12),
        timeMs: Number(f.timeMs.value || 0),
        aspWindow: Number(f.aspWindow.value || 0),
        nullMove: !!f.nullMove.checked,
        lmr: !!f.lmr.checked,
        futility: !!f.futility.checked,
        randomness: Number(f.randomPct.value || 0),
        stopOnMate: !!f.stopOnMate.checked,
        mode: String(f.mode.value || 'best'),
        drawWeights: {
          repetition: Number(f.drawRepetition.value || 0),
          simplify: Number(f.drawSimplify.value || 0),
          safety: Number(f.drawSafety.value || 0)
        }
      }
    };
  }

  function writeForm(cfg) {
    const f = document.getElementById('engineConfigForm');
    if (!f) return;
    const c = cfg || defaults();
    f.maxDepth.value = c.search.maxDepth;
    f.timeMs.value = c.search.timeMs;
    f.aspWindow.value = c.search.aspWindow;
    f.nullMove.checked = !!c.search.nullMove;
    f.lmr.checked = !!c.search.lmr;
    f.futility.checked = !!c.search.futility;
    f.randomPct.value = c.search.randomness;
    f.stopOnMate.checked = !!c.search.stopOnMate;
    f.mode.value = c.search.mode || 'best';
    f.drawRepetition.value = c.search.drawWeights?.repetition ?? 0;
    f.drawSimplify.value = c.search.drawWeights?.simplify ?? 0;
    f.drawSafety.value = c.search.drawWeights?.safety ?? 0;
  }

  function save(cfg) {
    try {
      const text = JSON.stringify(cfg || readForm());
      document.cookie = `${KEY}=${encodeURIComponent(text)}; path=/; max-age=${60*60*24*365*5}`;
      try { localStorage.setItem(KEY, text); } catch {}
      $status().text('Saved configuration.');
    } catch (e) {
      $status().text('Failed to save configuration.');
    }
  }

  function load() {
    // prefer localStorage
    let text = null;
    try { text = localStorage.getItem(KEY); } catch {}
    if (!text) {
      const m = document.cookie.match(new RegExp('(?:^|; )'+KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')+'=([^;]*)'));
      if (m) text = decodeURIComponent(m[1]);
    }
    if (!text) return defaults();
    try {
      const obj = JSON.parse(text);
      return obj && obj.version === 1 ? obj : defaults();
    } catch { return defaults(); }
  }

  function exportText(cfg) {
    try {
      const text = JSON.stringify(cfg || readForm());
      $('#configText').val(text);
      $status().text('Exported configuration to text area.');
    } catch (e) { $status().text('Export failed.'); }
  }

  function importText() {
    const text = $('#configText').val();
    if (!text) { $status().text('Nothing to import.'); return; }
    try {
      const obj = JSON.parse(text);
      if (!obj || obj.version !== 1) throw new Error('version mismatch');
      writeForm(obj);
      save(obj);
      $status().text('Imported configuration.');
    } catch (e) { $status().text('Import failed: invalid text.'); }
  }

  function clearCfg() {
    try { localStorage.removeItem(KEY); } catch {}
    document.cookie = `${KEY}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    writeForm(defaults());
    $status().text('Cleared configuration.');
  }

  function applyDefaultsIfMissing() {
    if (!document.getElementById('engineConfigForm')) return;
    const cfg = load();
    writeForm(cfg);
  }

  // Expose for Play UI to reuse
  window.EngineConfig = {
    KEY,
    defaults,
    load,
    save,
  };

  // Wire events on config page
  $(function(){
    applyDefaultsIfMissing();
    $('#saveConfig').on('click', () => save());
    $('#loadConfig').on('click', () => { writeForm(load()); $status().text('Loaded configuration.'); });
    $('#clearConfig').on('click', clearCfg);
    $('#exportConfig').on('click', () => exportText());
    $('#importConfig').on('click', importText);
  });
})();
