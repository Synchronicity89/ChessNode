'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Format1Store } = require('../format1Store');

// Test that depth1 enumeration produces exactly 20 unique child positions from start
// We invoke the generator with MAX_DEPTH=1 and then inspect the store.

describe('format1 generator depth1', () => {
  const dataDir = path.join(__dirname, '..', '..', 'data', 'format1');
  beforeAll(() => {
    // Clean store directory for a deterministic test
    if (fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    // Run the generator script once with MAX_DEPTH=1 to limit to first ply
    execSync('node ./src/generate_format1.js', {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, MAX_DEPTH: '1' },
      stdio: 'ignore'
    });
  });
  test('start position plus 20 children', () => {
    const store = new Format1Store(dataDir);
    // nextIndex - 1 = unique positions stored
    const unique = store.nextIndex - 1;
    // start position + 20 legal white first moves
    expect(unique).toBe(21);
  });
});
