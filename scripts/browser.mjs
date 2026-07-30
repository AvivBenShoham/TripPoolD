import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

/**
 * Launches the Chromium that is already installed in this environment.
 *
 * The pinned @playwright/test version may expect a different browser build number than
 * the one present, so the executable is located explicitly rather than downloaded.
 */
export function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return null;
  const candidates = readdirSync(root)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse()
    .map((d) => join(root, d, 'chrome-linux', 'chrome'))
    .filter((p) => existsSync(p));
  return candidates[0] ?? null;
}

export async function launchBrowser(options = {}) {
  const executablePath = findChromium();
  return chromium.launch({
    ...options,
    ...(executablePath ? { executablePath } : {}),
    // Everything under test is on 127.0.0.1 (dev server + emulators). Without this the
    // browser inherits the environment's HTTPS proxy and loopback requests fail with
    // ERR_TUNNEL_CONNECTION_FAILED.
    args: ['--no-proxy-server', ...(options.args ?? [])],
  });
}
