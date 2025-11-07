// server.js
// Express server to serve a browser UI and proxy to the local UCI engine
'use strict';

const express = require('express');
const path = require('path');
const { UciClient } = require('./uciClient');
const { getLichessToken } = require('./secrets');
const { downloadAndIndex } = require('./lichessDownloader');
const { OpeningBook } = require('./openingBook');

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
  const book = new OpeningBook();

  app.post('/api/engine/new', async (req, res) => {
    try {
      await engine.newGame();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  function ensureSix(f4) {
    const parts = f4.trim().split(/\s+/);
    return parts.length >= 6 ? f4 : `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]} 0 1`;
  }

  app.post('/api/engine/move', async (req, res) => {
    try {
      const { fen, mode } = req.body || {};
      if (!fen) return res.status(400).json({ ok: false, error: 'missing fen' });
      const modeEff = typeof mode === 'string' ? mode : 'prefer-db';
      let bookCandidates = null;
      let dbHits = null;

      // prefer-db or db-only
      if (modeEff !== 'engine-only' && modeEff !== 'prefer-book' && modeEff !== 'book-only') {
        const { Chess } = require('chess.js');
        const base = new Chess(ensureSix(fen));
        const legal = base.moves({ verbose: true });
        const pool = [];
        for (const m of legal) {
          const tmp = new Chess(ensureSix(fen));
          const made = tmp.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
          if (!made) continue;
          const toFen4 = tmp.fen().split(' ').slice(0, 4).join(' ');
          if (book.existsFen(toFen4)) pool.push(m.from + m.to + (m.promotion || ''));
        }
        dbHits = pool.length;
        if (pool.length > 0) {
          const dbPick = pool[Math.floor(Math.random() * pool.length)];
          return res.json({ ok: true, bestmove: dbPick, source: 'db', dbHits });
        }
        // if db-only, fall through to try book then engine for better UX
      }

      if (modeEff !== 'engine-only') {
        // Try opening book next
        const cands = book.getCandidatesForFen(fen) || [];
        bookCandidates = cands.length;
        const pickMode = process.env.BOOK_MODE === 'popular' ? 'popular' : 'weighted';
        if (cands.length > 0) {
          const uci = book.pickMoveForFen(fen, pickMode);
          if (uci) return res.json({ ok: true, bestmove: uci, source: 'book', bookCandidates });
        }
      }

      // Fallback to engine
      await engine.setPositionFen(fen);
      const bestmove = await engine.go();
      res.json({ ok: true, bestmove, source: 'engine', bookCandidates, dbHits });
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

  // Book/DB helper endpoints
  app.get('/api/book/position', (req, res) => {
    try {
      const fen = (req.query.fen || '').toString();
      if (!fen) return res.status(400).json({ ok: false, error: 'missing fen' });
      const exists = book.existsFen(fen);
      res.json({ ok: true, exists });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  app.post('/api/book/positions/exist', (req, res) => {
    try {
      const { fens } = req.body || {};
      if (!Array.isArray(fens)) return res.status(400).json({ ok: false, error: 'fens[] required' });
      const exists = {};
      for (const f of fens) {
        if (!f || typeof f !== 'string') continue;
        exists[f] = book.existsFen(f);
      }
      res.json({ ok: true, exists });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  app.get('/api/book/countermoves', (req, res) => {
    try {
      const fen = (req.query.fen || '').toString();
      if (!fen) return res.status(400).json({ ok: false, error: 'missing fen' });
      const candidates = book.getCandidatesForFen(fen);
      // Sort by count desc for readability
      candidates.sort((a, b) => (b.count || 0) - (a.count || 0));
      res.json({ ok: true, candidates });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
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
