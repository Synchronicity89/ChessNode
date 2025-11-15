#!/usr/bin/env node
// Minimal static file server with optional COOP/COEP headers.
// Usage: node simple-static-server.js <port> <root>
const http = require('http');
const fs = require('fs');
const path = require('path');

const port = parseInt(process.argv[2] || '8080', 10);
const root = path.resolve(process.argv[3] || 'manual_test_env/web');
const withCOOP = process.env.COOP === '1';

const mime = {
  '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.mjs':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.wasm':'application/wasm', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
  '.txt':'text/plain; charset=utf-8'
};

const srv = http.createServer((req, res) => {
  try {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let p = path.join(root, url);
    if (p.endsWith('/')) p = path.join(p, 'index.html');
    if (!p.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.stat(p, (err, st) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      if (st.isDirectory()) {
        const idx = path.join(p, 'index.html');
        fs.stat(idx, (e2, st2) => {
          if (e2 || !st2.isFile()){ res.writeHead(403); return res.end('Forbidden'); }
          streamFile(idx, res);
        });
      } else {
        streamFile(p, res);
      }
    });
  } catch (e) {
    res.writeHead(500); res.end('Server error');
  }
});

function streamFile(filePath, res){
  const ext = path.extname(filePath).toLowerCase();
  const type = mime[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
  if (withCOOP){
    headers['Cross-Origin-Opener-Policy'] = 'same-origin';
    headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
  }
  res.writeHead(200, headers);
  const rs = fs.createReadStream(filePath);
  rs.on('error', () => { try { res.writeHead(500); } catch{} res.end('Read error'); });
  rs.pipe(res);
}

srl = srv.listen(port, '127.0.0.1', () => {
  console.log(`Static server on http://127.0.0.1:${port}`);
  console.log(`Root: ${root}`);
  if (withCOOP) console.log('COOP/COEP: enabled'); else console.log('COOP/COEP: disabled');
});

process.on('SIGINT', () => { try { srv.close(); } catch{} process.exit(0); });
