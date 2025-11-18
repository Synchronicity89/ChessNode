// Simple Express-based engine server with graceful shutdown (CommonJS).
// Loads a persistent native engine addon once; each request reuses it.

const express = require('express');
const os = require('os');
const process = require('process');
const path = require('path');
const engine = require('./native-wrapper.js');

const PORT = process.env.PORT ? parseInt(process.env.PORT,10) : 8080;

// --- Express setup ---
const app = express();
app.use(express.json({ limit: '1mb' }));

// Static site hosting: serve files from ../web
const WEB_ROOT = path.join(__dirname, '..', 'web');
app.use(express.static(WEB_ROOT));
app.get('/', (_req, res) => {
  res.sendFile(path.join(WEB_ROOT, 'index.html'));
});

// Health
app.get('/engine/health', (_req, res) => {
  res.json({ status: 'ok', hostname: os.hostname(), pid: process.pid });
});

// Choose best move
app.post('/engine/choose', async (req, res) => {
  const { fen, depth = 3 } = req.body || {};
  if (!fen) return res.status(400).json({ error: 'Missing fen' });
  try {
    const t0 = Date.now();
    const move = engine.chooseMove(fen, depth);
    const t1 = Date.now();
    return res.json({ move, pv: [], score: null, nodes: engine.getLastNodes ? engine.getLastNodes() : undefined, timeMs: t1 - t0 });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// Perft
app.post('/engine/perft', async (req, res) => {
  const { fen, depth } = req.body || {};
  if (!fen || depth == null) return res.status(400).json({ error: 'Missing fen/depth' });
  try {
    const nodes = engine.perft(fen, depth);
    return res.json({ nodes: nodes.toString() });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// Legal moves
app.post('/engine/legal', async (req, res) => {
  const { fen } = req.body || {};
  if (!fen) return res.status(400).json({ error: 'Missing fen' });
  try {
    const moves = engine.legalMoves(fen);
    return res.json({ moves });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// Graceful shutdown helpers
let server; const connections = new Set();
function setupGracefulShutdown() {
  server.on('connection', (socket) => { connections.add(socket); socket.on('close', () => connections.delete(socket)); });
  function shutdown(signal) {
    console.log(`\n[server] Received ${signal}, shutting down...`);
    server.close(() => { console.log('[server] Closed HTTP server'); process.exit(0); });
    setTimeout(() => { connections.forEach((s) => { try { s.destroy(); } catch {} }); }, 2000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

server = app.listen(PORT, () => {
  console.log(`[server] Listening on port ${PORT} (pid=${process.pid})`);
  setupGracefulShutdown();
});
