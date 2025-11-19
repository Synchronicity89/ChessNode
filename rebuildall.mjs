#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const script = join(__dirname, 'rebuild-all.ps1');

const args = process.argv.slice(2);
const psArgs = ['-NoProfile','-ExecutionPolicy','Bypass','-File', script, ...args];
const child = spawn('powershell', psArgs, { stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 0));
