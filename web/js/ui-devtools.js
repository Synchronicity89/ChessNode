// Developer tools placeholder logic.
(function(){
  const controlsEl = $('#controls');
  const aiPromptEl = $('#aiPrompt');
  const OWNER = 'Synchronicity89';
  const REPO = 'ChessNode';

  function addCheckbox(id,label){
    const wrap = $('<div class="chk">');
    const box = $('<input type="checkbox">').attr('id', id).prop('checked', true);
    const lab = $('<label>').attr('for', id).text(label);
    wrap.append(box, lab);
    controlsEl.append(wrap);
  }

  // Example feature toggles to illustrate modularity.
  addCheckbox('feature-iterative','Iterative Deepening');
  addCheckbox('feature-tt','Transposition Table');
  addCheckbox('feature-null','Null Move Pruning');
  addCheckbox('feature-lmr','Late Move Reductions');
  addCheckbox('feature-aspiration','Aspiration Windows');

  $('#sendPrompt').on('click', () => {
    const text = aiPromptEl.val().trim();
    if(!text){
      alert('Enter a prompt describing the component or change.');
      return;
    }
    console.log('[AI REQUEST]', text);
    // TODO: integrate with AI backend or local generation pipeline.
    alert('Stub: AI request captured. ("' + text + '")');
    aiPromptEl.val('');
  });

  function openIssue(title, kind) {
    const text = (aiPromptEl.val() || '').trim();
    const body = `Automated request from engine-dev UI (GitHub Pages)\n\n` +
      `Kind: ${kind}\n\n` +
      `User Instructions:\n\n` +
      '```\n' + text + '\n```' +
      `\n\nAcceptance Criteria:\n- Provide C++17 code under engine/src and engine/include\n- Add/update tests in engine/tests (deterministic)\n- Keep cross-platform and WASM-compatible\n- Do not commit build outputs\n`;
    const url = `https://github.com/${OWNER}/${REPO}/issues/new?` +
      `title=${encodeURIComponent(title)}` +
      `&body=${encodeURIComponent(body)}` +
      `&labels=${encodeURIComponent('ai-request')}`;
    window.open(url, '_blank');
  }

  $('#addEval').on('click', () => openIssue('AI: Add Evaluation Module', 'evaluation'));
  $('#modifySearch').on('click', () => openIssue('AI: Modify Search Strategy', 'search'));
  $('#genTests').on('click', () => openIssue('AI: Generate Unit Tests for Selected Module', 'tests'));
})();
