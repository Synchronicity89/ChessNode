// server.js
// Express server to serve a browser UI and proxy to the local UCI engine
'use strict';

const express = require('express');
const path = require('path');
const { UciClient } = require('./uciClient');

const PORT = process.env.PORT || 3000;

async function main() {
  const app = express();
  app.use(express.json());

  // Static files
  const publicDir = path.resolve(__dirname, '..', 'public');
  app.use(express.static(publicDir));

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
