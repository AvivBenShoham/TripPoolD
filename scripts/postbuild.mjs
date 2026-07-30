/**
 * SPA fallback for static hosts without rewrite rules (GitHub Pages).
 *
 * Pages serves `404.html` for any path it cannot find on disk. Making that a copy of
 * index.html means a deep link like /TripPoolD/friends still boots the app, and React
 * Router picks the route up from location.pathname. The response carries a 404 status,
 * which browsers ignore for rendering — it only matters to crawlers, and this app is
 * marked noindex anyway.
 */
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(process.cwd(), 'dist');
const index = resolve(dist, 'index.html');
const fallback = resolve(dist, '404.html');

if (!existsSync(index)) {
  console.error('postbuild: dist/index.html is missing — did the build run?');
  process.exit(1);
}

copyFileSync(index, fallback);
console.log('postbuild: wrote dist/404.html (SPA fallback)');
