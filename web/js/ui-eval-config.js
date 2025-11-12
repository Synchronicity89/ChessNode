// Evaluation configuration manager (independent of engine search config)
(function(){
  const KEY = 'engineEval.v1';

  function defaults(){
    return {
      version: 2,
      // Opponent model
      opponentPlyDepth: 4,
      tradePlyDepthEquivalent: 0.5,
      // Risk model
      plyDepthRisk: {
        type: 'exponential',
        kAt2x: 100,
        slope: 5,
        midpointMultiplier: 1.0,
        riskPow: 1.0,
        gainScale: 1.0,
        lossScale: 1.0,
        blendAlpha: 1.0,
        riskOffset: 0,
        riskCap: null
      },
      // Base evaluation (existing)
      weights: { p:100, n:300, b:300, r:500, q:900, k:0 },
      terms: { material: true, tempo: false },
      tempo: 10,
      // Board geometry
      centerPiecePlacementReward: 50,
      endGameKingCenterMagnet: 15,
      // Development
      rankAttackFactor: 1.1,
      developmentIncentive: 10,
      developmentGamma: 1.0,
      developmentOffset: 0,
      developmentCap: null,
      notJustEmptySquaresThreatReward: true,
      // King values
      kingEngineValue: 7000,
      kingOpponentValue: 5000,
      // Endgamishness mapping
      endgamishness: {
        form: 'linear',
        pieceWeightMinor: 3,
        pieceWeightRook: 5,
        pieceWeightQueen: 9,
        T: 31,
        L: 6,
        min: 0,
        max: 1,
        slope: 5,
        midpoint: 1.0
      },
      // Mixing weights
      mix: {
        weightCenter: 1.0,
        weightKingCenter: 1.0,
        weightDevelopment: 1.0,
        weightRisk: 1.0,
        totalOffset: 0,
        totalCap: null
      }
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

  function validate(partial){
    const d = defaults();
    const c = Object.assign({}, d, partial || {});
    // Basic clamps/sanitization for critical fields
    c.opponentPlyDepth = Math.max(0, Math.min(64, Number(c.opponentPlyDepth||d.opponentPlyDepth)));
    c.tradePlyDepthEquivalent = Math.max(0, Math.min(1, Number(c.tradePlyDepthEquivalent||d.tradePlyDepthEquivalent)));
    c.plyDepthRisk = Object.assign({}, d.plyDepthRisk, c.plyDepthRisk||{});
    c.plyDepthRisk.kAt2x = Math.max(1, Number(c.plyDepthRisk.kAt2x||d.plyDepthRisk.kAt2x));
    c.plyDepthRisk.slope = Number(c.plyDepthRisk.slope||d.plyDepthRisk.slope);
    c.plyDepthRisk.midpointMultiplier = Number(c.plyDepthRisk.midpointMultiplier||d.plyDepthRisk.midpointMultiplier);
    c.plyDepthRisk.riskPow = Math.max(0, Number(c.plyDepthRisk.riskPow||d.plyDepthRisk.riskPow));
    c.plyDepthRisk.gainScale = Math.max(0, Number(c.plyDepthRisk.gainScale||d.plyDepthRisk.gainScale));
    c.plyDepthRisk.lossScale = Math.max(0, Number(c.plyDepthRisk.lossScale||d.plyDepthRisk.lossScale));
    c.plyDepthRisk.blendAlpha = Math.max(0, Math.min(1, Number(c.plyDepthRisk.blendAlpha||d.plyDepthRisk.blendAlpha)));
    c.centerPiecePlacementReward = Number(c.centerPiecePlacementReward||d.centerPiecePlacementReward);
    c.endGameKingCenterMagnet = Number(c.endGameKingCenterMagnet||d.endGameKingCenterMagnet);
    c.rankAttackFactor = Number(c.rankAttackFactor||d.rankAttackFactor);
    c.developmentIncentive = Number(c.developmentIncentive||d.developmentIncentive);
    c.developmentGamma = Number(c.developmentGamma||d.developmentGamma);
    c.kingEngineValue = Number(c.kingEngineValue||d.kingEngineValue);
    c.kingOpponentValue = Number(c.kingOpponentValue||d.kingOpponentValue);
    c.mix = Object.assign({}, d.mix, c.mix||{});
    return c;
  }

  function save(cfg){
    const c = validate(cfg || readFromDom());
    const text = JSON.stringify(c);
    document.cookie = `${KEY}=${encodeURIComponent(text)}; path=/; max-age=${60*60*24*365*5}`;
    try { localStorage.setItem(KEY, text); } catch {}
    return c;
  }

  function applyToDom(cfg){
    const c = cfg || defaults();
    const $ = window.jQuery;
    // Opponent model
    $('#opp_ply_depth').val(c.opponentPlyDepth);
    $('#trade_ply_eq').val(c.tradePlyDepthEquivalent);
    // Base eval
    $('#w_p').val(c.weights.p);
    $('#w_n').val(c.weights.n);
    $('#w_b').val(c.weights.b);
    $('#w_r').val(c.weights.r);
    $('#w_q').val(c.weights.q);
    $('#w_k').val(c.weights.k);
    $('#t_material').prop('checked', !!c.terms.material);
    $('#t_tempo').prop('checked', !!c.terms.tempo);
    $('#tempo_cp').val(c.tempo);
    // Risk model
    $('#risk_type').val(c.plyDepthRisk.type);
    $('#risk_k2x').val(c.plyDepthRisk.kAt2x);
    $('#risk_slope').val(c.plyDepthRisk.slope);
    $('#risk_mid').val(c.plyDepthRisk.midpointMultiplier);
    $('#risk_pow').val(c.plyDepthRisk.riskPow);
    $('#gain_scale').val(c.plyDepthRisk.gainScale);
    $('#loss_scale').val(c.plyDepthRisk.lossScale);
    $('#blend_alpha').val(c.plyDepthRisk.blendAlpha);
    // Geometry
    $('#center_reward').val(c.centerPiecePlacementReward);
    $('#king_center_mag').val(c.endGameKingCenterMagnet);
    // Development
    $('#rank_attack_factor').val(c.rankAttackFactor);
    $('#dev_incentive').val(c.developmentIncentive);
    $('#threat_occupied').prop('checked', !!c.notJustEmptySquaresThreatReward);
    // Advanced
    $('#dev_gamma').val(c.developmentGamma);
    $('#endg_pow').val(c.endgamishnessPow || 1.0);
    $('#kc_imp_pow').val(c.kingCenterImprovementPow || 1.0);
    $('#mix_w_center').val(c.mix.weightCenter);
    $('#mix_w_kcenter').val(c.mix.weightKingCenter);
    $('#mix_w_dev').val(c.mix.weightDevelopment);
    $('#mix_w_risk').val(c.mix.weightRisk);
  }

  function readFromDom(){
    const $ = window.jQuery;
    return {
      version: 2,
      opponentPlyDepth: Number($('#opp_ply_depth').val()||4),
      tradePlyDepthEquivalent: Number($('#trade_ply_eq').val()||0.5),
      plyDepthRisk: {
        type: String($('#risk_type').val()||'exponential'),
        kAt2x: Number($('#risk_k2x').val()||100),
        slope: Number($('#risk_slope').val()||5),
        midpointMultiplier: Number($('#risk_mid').val()||1.0),
        riskPow: Number($('#risk_pow').val()||1.0),
        gainScale: Number($('#gain_scale').val()||1.0),
        lossScale: Number($('#loss_scale').val()||1.0),
        blendAlpha: Number($('#blend_alpha').val()||1.0),
        riskOffset: 0,
        riskCap: null
      },
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
      tempo: Number($('#tempo_cp').val()||10),
      centerPiecePlacementReward: Number($('#center_reward').val()||50),
      endGameKingCenterMagnet: Number($('#king_center_mag').val()||15),
      rankAttackFactor: Number($('#rank_attack_factor').val()||1.1),
      developmentIncentive: Number($('#dev_incentive').val()||10),
      notJustEmptySquaresThreatReward: !!$('#threat_occupied').prop('checked'),
      developmentGamma: Number($('#dev_gamma').val()||1.0),
      endgamishnessPow: Number($('#endg_pow').val()||1.0),
      kingCenterImprovementPow: Number($('#kc_imp_pow').val()||1.0),
      kingEngineValue: Number($('#king_engine_cp').val()||7000),
      kingOpponentValue: Number($('#king_opponent_cp').val()||5000),
      endgamishness: {
        form: 'linear',
        pieceWeightMinor: 3,
        pieceWeightRook: 5,
        pieceWeightQueen: 9,
        T: 31,
        L: 6,
        min: 0,
        max: 1,
        slope: 5,
        midpoint: 1.0
      },
      mix: {
        weightCenter: Number($('#mix_w_center').val()||1.0),
        weightKingCenter: Number($('#mix_w_kcenter').val()||1.0),
        weightDevelopment: Number($('#mix_w_dev').val()||1.0),
        weightRisk: Number($('#mix_w_risk').val()||1.0),
        totalOffset: 0,
        totalCap: null
      }
    };
  }

  function toEngineOptions(cfg){
    const c = cfg || load();
    // For now, only pass through the base terms used by C++ evaluation.
    return {
      weights: c.weights,
      terms: c.terms,
      tempo: c.tempo
    };
  }

  // Expose
  function toLineEvalOptions(cfg){
    // Return full v2 config for UI-driven line evaluation logic
    return validate(cfg || load());
  }

  window.EngineEvalConfig = { defaults, load, save, applyToDom, readFromDom, toEngineOptions, toLineEvalOptions };

  // Initialize on DOM ready when controls exist
  jQuery(function(){
    if (document.getElementById('evalControls')){
      // Back-compat migration: if old version, merge over defaults
      let cfg = load();
      if (!cfg || typeof cfg.version !== 'number' || cfg.version < 2){
        cfg = Object.assign({}, defaults(), cfg || {});
      }
      applyToDom(cfg);
      jQuery('#saveEval').on('click', ()=> save());
      jQuery('#applyEval').on('click', ()=> applyToDom(load()));
    }
  });
})();
