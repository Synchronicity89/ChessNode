// uciClient.js
// Wrap the local UCI engine (node src/uciEngine.js) and expose a small async API
'use strict';

const { spawn } = require('child_process');
const path = require('path');

class UciClient {
  constructor() {
    this.proc = null;
    this.buffer = '';
    this.ready = false;
    this.pending = [];
    this.awaiters = [];
  }

  async init() {
    if (this.proc) return;
    const enginePath = path.resolve(__dirname, 'uciEngine.js');
    this.proc = spawn(process.execPath, [enginePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this._onData(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => {
      // keep for debug if needed
      // console.error('[ENGINE STDERR]', chunk);
    });

    // Wait for uciok
    await this._sendAndWait('uci', (line) => line.includes('uciok'));
    await this._sendAndWait('isready', (line) => line.includes('readyok'));
    await this._send('ucinewgame');
  }

  async newGame() {
    await this._send('ucinewgame');
    await this._sendAndWait('isready', (l) => l.includes('readyok'));
  }

  async setPositionFen(fen) {
    const cmd = `position fen ${fen}`;
    await this._send(cmd);
  }

  async go() {
    const resp = await this._sendAndWait('go', (line) => line.startsWith('bestmove '));
    const m = resp.match(/^bestmove\s+(\S+)/);
    return m ? m[1] : '0000';
  }

  async quit() {
    if (!this.proc) return;
    try {
      await this._send('quit');
    } catch (e) {
      // ignore errors during shutdown
    }
    this.proc.kill();
    this.proc = null;
  }

  _onData(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop(); // keep last partial
    for (const line of lines) {
      // Resolve any awaiters that match
      for (const aw of [...this.awaiters]) {
        if (aw.predicate(line)) {
          aw.resolve(line);
        }
      }
    }
  }

  async _send(cmd) {
    if (!this.proc) throw new Error('Engine not initialized');
    this.proc.stdin.write(cmd + '\n');
  }

  _sendAndWait(cmd, predicate) {
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve: (line) => {
          // remove self
          const idx = this.awaiters.indexOf(waiter);
          if (idx >= 0) this.awaiters.splice(idx, 1);
          resolve(line);
        },
      };
      this.awaiters.push(waiter);
      try {
        this._send(cmd);
      } catch (e) {
        reject(e);
      }
      // add a timeout safeguard
      setTimeout(() => {
        const idx = this.awaiters.indexOf(waiter);
        if (idx >= 0) this.awaiters.splice(idx, 1);
        reject(new Error(`Timeout waiting for response to: ${cmd}`));
      }, 8000);
    });
  }
}

module.exports = { UciClient };
