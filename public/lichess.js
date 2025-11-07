const logEl = document.getElementById('log');
function log(msg) {
  const div = document.createElement('div');
  div.textContent = msg;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

const form = document.getElementById('dlForm');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = document.getElementById('token').value.trim();
  const username = document.getElementById('username').value.trim();
  const max = parseInt(document.getElementById('max').value, 10) || undefined;
  const minRatingVal = document.getElementById('minRating').value;
  const minRating = minRatingVal ? parseInt(minRatingVal, 10) : undefined;
  const rated = document.getElementById('rated').value === 'true';
  const perfType = document.getElementById('perfType').value || undefined;

  log('Starting download...');
  try {
    const res = await fetch('/api/lichess/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token || undefined, username, max, rated, perfType, minRating }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Request failed');
    log('Done.');
    log('Games: ' + data.games);
    log('Positions (unique): ' + data.positions);
    if (typeof data.globalAdded === 'number') {
      log('New positions added to global DB: ' + data.globalAdded);
    }
    if (data.stats) {
      const s = data.stats;
      log(`Skipped (variant): ${s.variantSkip || 0}`);
      log(`Skipped (non-initial FEN): ${s.nonInitialFENSkip || 0}`);
      log(`Parse failures: ${s.parseFail || 0}`);
      log(`Games with 0 moves: ${s.emptyMoves || 0}`);
      log(`Illegal on replay: ${s.illegalReplay || 0}`);
    }
    log('PGN cache: ' + data.pgnPath);
    log('Positions DB: ' + data.outPath);
  } catch (err) {
    log('Error: ' + err.message);
  }
});
