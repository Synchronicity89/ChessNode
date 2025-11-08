// dbAdapter.js
// Minimal adapter interface for opening/game DB and lookup table.
// - provides findPosition(fen) -> { found: bool, subformat, index }
// - loadOnDemand(url) -> downloads and caches to disk (simple fetch)
// Implementation uses only node built-in modules (https, fs)

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { Format1Store } = require('./format1Store');

const CACHE_DIR = path.join(__dirname, 'db_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function fetchToCache(url, nameHint) {
  const fileName = nameHint ? `${hashKey(url)}_${nameHint}` : hashKey(url);
  const out = path.join(CACHE_DIR, fileName);
  if (fs.existsSync(out)) return out;
  return new Promise((resolve, reject) => {
    const f = fs.createWriteStream(out);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('Bad status ' + res.statusCode));
        return;
      }
      res.pipe(f);
      f.on('finish', () => {
        f.close();
        resolve(out);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Small in-memory map for demonstration (not scaled)
const smallOpeningMap = new Map(); // fen -> index
let format1Store = null;

function addToOpeningDB(fen, index) {
  smallOpeningMap.set(fen, index);
}

function findPosition(fen) {
  const cf = fen.trim();
  if (smallOpeningMap.has(cf)) {
    return { found: true, subformat: 0, index: smallOpeningMap.get(cf) };
  }
  // Try persistent Format1 store
  try {
    if (!format1Store) {
      const baseDir = path.join(__dirname, '..', 'data', 'format1');
      format1Store = new Format1Store(baseDir);
    }
    const idx = format1Store.findIndexByFen(cf);
    if (idx && idx > 0) return { found: true, subformat: 0, index: idx };
  } catch (e) {
    // ignore and fall through
  }
  return { found: false };
}

module.exports = {
  fetchToCache,
  addToOpeningDB,
  findPosition,
  CACHE_DIR
};
