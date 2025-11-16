import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import url from 'node:url';

export async function loadIndexHtml() {
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const htmlPath = path.resolve(__dirname, '..', 'index.html');
  const html = readFileSync(htmlPath, 'utf8');

  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true
  });

  // Wait for window load so inline script in index.html has run
  await new Promise((resolve) => {
    dom.window.addEventListener('load', () => resolve());
  });

  return dom;
}
