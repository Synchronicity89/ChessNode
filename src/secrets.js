// secrets.js
// Load API tokens from API_KEYS folder
'use strict';

const fs = require('fs');
const path = require('path');

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function getLichessToken() {
  const p = path.resolve(__dirname, '..', 'API_KEYS', 'Lichess', 'API_token.json');
  const j = readJsonSafe(p);
  return j && typeof j.token === 'string' && j.token.trim() ? j.token.trim() : null;
}

module.exports = { getLichessToken };
