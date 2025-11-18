#!/usr/bin/env node
/*
  Kill any process listening on a given TCP port (Windows-first).
  Usage: node scripts/kill-port.js 8080
  If PORT env is set, it is used when no CLI arg is provided.
*/

const { exec } = require('child_process');

function sh(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function main() {
  const argPort = process.argv[2] && String(process.argv[2]).trim();
  const port = argPort || process.env.PORT || '8080';
  if (!/^[0-9]+$/.test(port)) {
    console.error(`[kill-port] Invalid port: ${port}`);
    process.exit(1);
  }

  // Windows path: use netstat to find LISTENING entries on the port
  // Example line:
  //  TCP    0.0.0.0:8080           0.0.0.0:0              LISTENING       12345
  const { stdout } = await sh('netstat -ano -p tcp');
  const lines = stdout.split(/\r?\n/).filter((l) => l.includes(`:${port}`) && /LISTENING/i.test(l));
  const pids = new Set();
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (/^\d+$/.test(pid)) pids.add(pid);
  }

  if (pids.size === 0) {
    console.log(`[kill-port] No LISTENING process found on port ${port}`);
    return;
  }

  console.log(`[kill-port] Killing ${pids.size} process(es) on port ${port}: ${[...pids].join(', ')}`);
  for (const pid of pids) {
    // Force kill process and its children; ignore errors if already exited
    // /T: terminate child processes, /F: force
    // Use cmd to ensure built-in is available in npm/cmd context
    const { error } = await sh(`taskkill /PID ${pid} /F /T`);
    if (error) {
      // Best-effort; keep going
      console.warn(`[kill-port] Warning: failed to kill PID ${pid} (${error.message})`);
    }
  }
}

main().catch((e) => {
  console.error('[kill-port] Unexpected error:', e);
  process.exit(1);
});
