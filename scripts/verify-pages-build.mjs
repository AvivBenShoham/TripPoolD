/**
 * Verifies the GitHub Pages build the way Pages actually serves it.
 *
 * `vite preview` is not a faithful check: it has its own SPA fallback, so it would happily
 * serve deep links even if `404.html` were missing. This serves `dist/` under the real
 * sub-path with Pages' behaviour — unknown paths get `404.html` with a 404 status — and
 * then loads it in a browser to confirm the bundle boots and routes.
 *
 *   BASE_PATH=/TripPoolD/ npm run build && node scripts/verify-pages-build.mjs
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { launchBrowser } from './browser.mjs';

const BASE = process.env.BASE_PATH ?? '/TripPoolD/';
const PORT = 4173;
const DIST = resolve(process.cwd(), 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  // Anything outside the project sub-path is simply not this site.
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404).end('not found');
    return;
  }

  const rel = normalize(url.pathname.slice(BASE.length)) || 'index.html';
  const target = join(DIST, rel);
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(await readFile(target));
  } catch {
    // Exactly what GitHub Pages does for an unknown path.
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(DIST, '404.html')));
  }
});

const failures = [];
function check(name, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failures.push(name);
}

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const failed = [];
page.on('requestfailed', (r) => failed.push(r.url()));
page.on('response', (r) => {
  // A missing asset under the sub-path is the classic base-path mistake.
  if (r.status() >= 400 && /\.(js|css|png|svg|webmanifest)$/.test(new URL(r.url()).pathname)) {
    failed.push(`${r.status()} ${r.url()}`);
  }
});

try {
  console.log(`\n▸ Serving dist/ at http://127.0.0.1:${PORT}${BASE}`);
  await page.goto(`http://127.0.0.1:${PORT}${BASE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  check('no asset failed to load under the sub-path', failed.length === 0, failed.join(', '));
  check('app mounted', (await page.locator('#root *').count()) > 0);

  const manifest = await page.request.get(`http://127.0.0.1:${PORT}${BASE}manifest.webmanifest`);
  check('manifest served', manifest.ok());
  const manifestJson = await manifest.json();
  check(
    'manifest uses relative urls so it resolves under any base',
    manifestJson.start_url === '.' && manifestJson.icons.every((i) => i.src.startsWith('./')),
  );

  // The deep-link case: Pages has no rewrites, so this must come back via 404.html and
  // still boot the app rather than showing a bare error page.
  const deep = await page.goto(`http://127.0.0.1:${PORT}${BASE}stats`, {
    waitUntil: 'domcontentloaded',
  });
  check('deep link served through the 404.html fallback', deep?.status() === 404);
  await page.waitForTimeout(2500);
  check('app boots on a deep link', (await page.locator('#root *').count()) > 0);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`\n${failures.length} Pages-build check(s) failed.`);
  process.exit(1);
}
console.log('\nPages build verified.');
process.exit(0);
