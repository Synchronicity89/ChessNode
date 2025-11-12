// Evaluation configuration manager (independent of engine search config)
(function(){
  const KEY = 'engineEval.v1';

  function defaults(){
    return {
      version: 1,
      weights: { p:100, n:300, b:300, r:500, q:900, k:0 },
      terms: { material: true, tempo: false },
      tempo: 10
    };
  }

  function load(){
    let text = null;
    try { text = localStorage.getItem(KEY); } catch {}
    if (!text) {
      const m = document.cookie.match(new RegExp('(?:^|; )'+KEY.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'=([^;]*)'));
      if (m) text = decodeURIComponent(m[1]);
    }
    if (!text) return defaults();
    try { const obj = JSON.parse(text); return (obj && obj.version===1) ? obj : defaults(); } catch { return defaults(); }
  }

  function save(cfg){
    const c = cfg || readFromDom();
    const text = JSON.stringify(c);
    document.cookie = `${KEY}=${encodeURIComponent(text)}; path=/; max-age=${60*60*24*365*5}`;
    try { localStorage.setItem(KEY, text); } catch {}
    return c;
  }

  function applyToDom(cfg){
    const c = cfg || defaults();
    const $ = window.jQuery;
    $('#w_p').val(c.weights.p);
    $('#w_n').val(c.weights.n);
    $('#w_b').val(c.weights.b);
    $('#w_r').val(c.weights.r);
    $('#w_q').val(c.weights.q);
    $('#w_k').val(c.weights.k);
    $('#t_material').prop('checked', !!c.terms.material);
    $('#t_tempo').prop('checked', !!c.terms.tempo);
    $('#tempo_cp').val(c.tempo);
  }

  function readFromDom(){
    const $ = window.jQuery;
    return {
      version: 1,
      weights: {
        p: Number($('#w_p').val()||100),
        n: Number($('#w_n').val()||300),
        b: Number($('#w_b').val()||300),
        r: Number($('#w_r').val()||500),
        q: Number($('#w_q').val()||900),
        k: Number($('#w_k').val()||0)
      },
      terms: {
        material: !!$('#t_material').prop('checked'),
        tempo: !!$('#t_tempo').prop('checked')
      },
      tempo: Number($('#tempo_cp').val()||10)
    };
  }

  function toEngineOptions(cfg){
    const c = cfg || load();
    return {
      weights: c.weights,
      terms: c.terms,
      tempo: c.tempo
    };
  }

  // Expose
  window.EngineEvalConfig = { defaults, load, save, applyToDom, readFromDom, toEngineOptions };

  // Initialize on DOM ready when controls exist
  jQuery(function(){
    if (document.getElementById('evalControls')){
      applyToDom(load());
      jQuery('#saveEval').on('click', ()=> save());
      jQuery('#applyEval').on('click', ()=> applyToDom(load()));
    }
  });
})();
