// server.js
// Express server to serve a browser UI and proxy to the local UCI engine
'use strict';

const express = require('express');
const path = require('path');
const { UciClient } = require('./uciClient');
const { getLichessToken } = require('./secrets');
const { downloadAndIndex } = require('./lichessDownloader');

const PORT = process.env.PORT || 3000;

async function main() {
  const app = express();
  app.use(express.json());

  // Static files
  const publicDir = path.resolve(__dirname, '..', 'public');
  app.use(express.static(publicDir));
  // Serve vendor assets locally to avoid CDN issues
  const vendorMap = [
    { route: '/vendor/jquery.js', file: require.resolve('jquery/dist/jquery.min.js') },
    // ESM build for browser usage
    { route: '/vendor/chess-esm.js', file: require.resolve('chess.js/dist/esm/chess.js') },
    { route: '/vendor/chessboard.js', file: require.resolve('@chrisoakman/chessboardjs/dist/chessboard-1.0.0.min.js') },
    { route: '/vendor/chessboard.css', file: require.resolve('@chrisoakman/chessboardjs/dist/chessboard-1.0.0.min.css') },
  ];
  for (const v of vendorMap) {
    app.get(v.route, (req, res) => res.sendFile(v.file));
  }

  // Create a single engine instance for now
  const engine = new UciClient();
  await engine.init();

  app.post('/api/engine/new', async (req, res) => {
    try {
      await engine.newGame();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  app.post('/api/engine/move', async (req, res) => {
    try {
      const { fen } = req.body || {};
      if (!fen) return res.status(400).json({ ok: false, error: 'missing fen' });
      await engine.setPositionFen(fen);
      const bestmove = await engine.go();
      res.json({ ok: true, bestmove });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // Lichess downloader UI
  app.get('/lichess', (req, res) => {
    res.sendFile(path.resolve(publicDir, 'lichess.html'));
  });

  app.post('/api/lichess/download', async (req, res) => {
    try {
      const { token, username, max, rated, perfType, minRating } = req.body || {};
      const tok = token && token.trim() ? token.trim() : getLichessToken();
      if (!tok) return res.status(400).json({ ok: false, error: 'Missing token: provide in body or API_KEYS/Lichess/API_token.json' });
      if (!username) return res.status(400).json({ ok: false, error: 'username is required' });
      const result = await downloadAndIndex({ token: tok, username, max, rated, perfType, minRating });
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  const server = app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });

  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await engine.quit();
    server.close(() => process.exit(0));
  });
}

main().catch((e) => {
  console.error('Failed to start server:', e);
  process.exit(1);
});
