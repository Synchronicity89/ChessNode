// cheatStore.js
// Simple append-only cheat store. Each entry: length (4 bytes) + payload bytes.
// Returns an increasing 48-bit index offset for retrieval. Stored under db_cache/cheat.blob
'use strict';
const fs = require('fs');
const path = require('path');
const db = require('./dbAdapter');

const CHEAT_FILE = path.join(db.CACHE_DIR, 'cheat.blob');
const CHEAT_INDEX = path.join(db.CACHE_DIR, 'cheat.index');

function ensureFiles() {
  if (!fs.existsSync(CHEAT_FILE)) fs.writeFileSync(CHEAT_FILE, '');
  if (!fs.existsSync(CHEAT_INDEX)) fs.writeFileSync(CHEAT_INDEX, JSON.stringify({ nextOffset: 0 }));
}

function loadIndex() {
  ensureFiles();
  return JSON.parse(fs.readFileSync(CHEAT_INDEX, 'utf8'));
}

function saveIndex(idx) {
  fs.writeFileSync(CHEAT_INDEX, JSON.stringify(idx));
}

function storeBlob(buf) {
  const idx = loadIndex();
  const offset = idx.nextOffset;
  const fd = fs.openSync(CHEAT_FILE, 'a');
  // write length (4 bytes) then content
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(buf.length, 0);
  fs.writeSync(fd, lenBuf);
  fs.writeSync(fd, buf);
  fs.closeSync(fd);
  idx.nextOffset += 4 + buf.length;
  saveIndex(idx);
  return offset; // use offset as index
}

function loadBlob(offset) {
  const fd = fs.openSync(CHEAT_FILE, 'r');
  const lenBuf = Buffer.alloc(4);
  fs.readSync(fd, lenBuf, 0, 4, offset);
  const len = lenBuf.readUInt32BE(0);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, offset + 4);
  fs.closeSync(fd);
  return buf;
}

module.exports = { storeBlob, loadBlob };
