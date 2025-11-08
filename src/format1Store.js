'use strict';

// format1Store.js
// Disk-backed, mmap-style append-only store for Format 1 lookup table.
// - Positions are identified by canonical 4-field FEN (board side castling ep)
// - We assign a sequential index (uint64 starting at 1) to each unique FEN
// - Storage layout:
//   baseDir/
//     positions.bin         fixed-size records [index:8][fenOffset:8]
//     fen.blob              append-only blob: [len:4][fenBytes]
//     index/00..ff.bin      bucketed index by sha1 first byte; records [sha1:20][index:8]
//     progress.json         stats and checkpoints
// - API: init(baseDir), addFen(fen4) -> { index, isNew }, getFenByIndex(index) -> fen4
// - Crash safety: writes are fsync'ed on index append and fen append; progress.json updated periodically

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function sha1(buf) { return crypto.createHash('sha1').update(buf).digest(); }

class Format1Store {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.posFile = path.join(baseDir, 'positions.bin');
    this.fenBlob = path.join(baseDir, 'fen.blob');
    this.indexDir = path.join(baseDir, 'index');
    this.progressFile = path.join(baseDir, 'progress.json');
    ensureDir(baseDir);
    ensureDir(this.indexDir);
    if (!fs.existsSync(this.posFile)) fs.writeFileSync(this.posFile, Buffer.alloc(0));
    if (!fs.existsSync(this.fenBlob)) fs.writeFileSync(this.fenBlob, Buffer.alloc(0));
    // progress.json tracks nextIndex and fenBlobSize
    if (!fs.existsSync(this.progressFile)) {
      const stats = fs.statSync(this.fenBlob);
      const nextIndex = Math.floor(fs.statSync(this.posFile).size / 16) + 1; // 16 bytes per record
      fs.writeFileSync(this.progressFile, JSON.stringify({ nextIndex, fenBlobSize: stats.size }));
    }
    const p = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
    this.nextIndex = p.nextIndex || 1;
    this.fenBlobSize = p.fenBlobSize || 0;
    // in-run dedup Bloom-ish Set (sha1 hex); keeps memory bounded by flushing per batch
    this.sessionHashes = new Set();
  }

  saveProgress() {
    fs.writeFileSync(this.progressFile, JSON.stringify({ nextIndex: this.nextIndex, fenBlobSize: this.fenBlobSize }));
  }

  // Bucket file path for sha1 (first byte determines file)
  bucketPath(digest) {
    const hex = digest.toString('hex');
    const b = hex.slice(0, 2);
    return path.join(this.indexDir, `${b}.bin`);
  }

  // Check if fen sha1 exists in its bucket; returns index or 0
  findIndexBySha1(digest) {
    const bucket = this.bucketPath(digest);
    if (!fs.existsSync(bucket)) return 0n;
    const fd = fs.openSync(bucket, 'r');
    try {
      const stat = fs.fstatSync(fd);
      const recSize = 28; // 20 sha1 + 8 index
      const buf = Buffer.allocUnsafe(Math.min(stat.size, 1_048_576)); // 1MB chunk
      let offset = 0;
      while (offset < stat.size) {
        const toRead = Math.min(buf.length, stat.size - offset);
        fs.readSync(fd, buf, 0, toRead, offset);
        for (let i = 0; i < toRead; i += recSize) {
          if (i + recSize > toRead) break;
          let match = true;
          for (let j = 0; j < 20; j++) if (buf[i + j] !== digest[j]) { match = false; break; }
          if (match) {
            const idx = buf.readBigUInt64LE(i + 20);
            return idx;
          }
        }
        offset += toRead;
      }
      return 0n;
    } finally {
      fs.closeSync(fd);
    }
  }

  // Append digest->index to bucket
  appendIndexRecord(digest, index) {
    const bucket = this.bucketPath(digest);
    const fd = fs.openSync(bucket, 'a');
    try {
      const rec = Buffer.alloc(28);
      digest.copy(rec, 0);
      rec.writeBigUInt64LE(BigInt(index), 20);
      fs.writeSync(fd, rec);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  // Append fen string to blob, return offset
  appendFen(fen4) {
    const fd = fs.openSync(this.fenBlob, 'a');
    try {
      const data = Buffer.from(fen4, 'utf8');
      const hdr = Buffer.alloc(4);
      hdr.writeUInt32LE(data.length, 0);
      const offset = this.fenBlobSize;
      fs.writeSync(fd, hdr);
      fs.writeSync(fd, data);
      this.fenBlobSize += 4 + data.length;
      fs.fsyncSync(fd);
      this.saveProgress();
      return offset;
    } finally {
      fs.closeSync(fd);
    }
  }

  // Read fen string by blob offset
  readFen(offset) {
    const fd = fs.openSync(this.fenBlob, 'r');
    try {
      const hdr = Buffer.alloc(4);
      fs.readSync(fd, hdr, 0, 4, offset);
      const len = hdr.readUInt32LE(0);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset + 4);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  }

  // Append [index, fenOffset] to positions.bin
  appendPosition(index, fenOffset) {
    const fd = fs.openSync(this.posFile, 'a');
    try {
      const rec = Buffer.alloc(16);
      rec.writeBigUInt64LE(BigInt(index), 0);
      rec.writeBigUInt64LE(BigInt(fenOffset), 8);
      fs.writeSync(fd, rec);
      fs.fsyncSync(fd);
      this.saveProgress();
    } finally {
      fs.closeSync(fd);
    }
  }

  // Public API: add FEN, return index; dedup via sha1 bucket index
  addFen(fen4) {
    const fen = fen4.trim();
    const digest = sha1(Buffer.from(fen, 'utf8'));
    const keyHex = digest.toString('hex');
    // Fast session-level dedup
    if (this.sessionHashes.has(keyHex)) {
      const idx = this.findIndexBySha1(digest);
      return { index: Number(idx), isNew: false };
    }
    let idx = this.findIndexBySha1(digest);
    if (idx !== 0n) {
      this.sessionHashes.add(keyHex);
      return { index: Number(idx), isNew: false };
    }
    const index = this.nextIndex++;
    const fenOffset = this.appendFen(fen);
    this.appendIndexRecord(digest, index);
    this.appendPosition(index, fenOffset);
    this.sessionHashes.add(keyHex);
    return { index, isNew: true };
  }

  // Public API: find index by FEN without adding
  findIndexByFen(fen4) {
    const fen = fen4.trim();
    const digest = sha1(Buffer.from(fen, 'utf8'));
    const idx = this.findIndexBySha1(digest);
    return Number(idx);
  }

  // Retrieve fen by index via positions.bin -> fen.blob
  getFenByIndex(index) {
    const pos = (index - 1) * 16;
    const fd = fs.openSync(this.posFile, 'r');
    try {
      const rec = Buffer.alloc(16);
      const bytes = fs.readSync(fd, rec, 0, 16, pos);
      if (bytes !== 16) throw new Error('Index out of range');
      const idx = Number(rec.readBigUInt64LE(0));
      if (idx !== index) throw new Error('Corrupt positions.bin');
      const off = Number(rec.readBigUInt64LE(8));
      return this.readFen(off);
    } finally {
      fs.closeSync(fd);
    }
  }
}

module.exports = { Format1Store };
