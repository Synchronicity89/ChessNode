import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import url from 'node:url';

export async function loadIndexHtml(options) {
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const htmlPath = path.resolve(__dirname, '..', 'index.html');
  let html = readFileSync(htmlPath, 'utf8');
  const useRealEngine = !!(options && options.realEngine);

  // In tests, always prevent external fetch of engine-bridge2.js by stripping the script tag.
  // We will inline/eval the engine code below if requested via realEngine=true.
  html = html.replace(/<script\s+src=["']engine-bridge2\.js["']><\/script>/i, '<script>/* engine bridge removed in tests */<\/script>');

  const query = (options && options.query) ? options.query : '';
  const dom = new JSDOM(html, {
    url: 'http://localhost/' + query,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    // Flag the environment so index.html can skip asset checks under JSDOM
    beforeParse(window) {
      window.JSDOM_TEST_ENV = true;
      // Disable verbose trace logging in tests to keep output readable
      window.TRACE_MOVES = false;
    }
  });

  // Wait for window load so inline script in index.html has run
  await new Promise((resolve) => {
    dom.window.addEventListener('load', () => resolve());
  });

  // If requested, inline the real JS engine (engine-bridge2.js) directly into the DOM
  // so tests use the same code as the page does in production (no WASM here).
  if (useRealEngine) {
    const enginePath = path.resolve(__dirname, '..', 'engine-bridge2.js');
    const engineSrc = readFileSync(enginePath, 'utf8');
    dom.window.eval(engineSrc);
  }

  return dom;
}
