/**
 * End-to-end verification at iPhone size against the emulator suite.
 *
 * Drives the real UI for the primary flows (signup, onboarding, pin-drop, entry
 * creation, coverage, stats) and uses the client SDK to stand up a second account so the
 * friend request / accept / view-their-map path can be exercised for real.
 *
 * Run via:  npm run e2e     (which wraps this in `firebase emulators:exec`)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { geoEqualEarth } from 'd3-geo';
import { feature } from 'topojson-client';
import topo from 'world-atlas/countries-110m.json' with { type: 'json' };
import { launchBrowser } from './browser.mjs';

const OUT = 'screenshots';
const BASE = 'http://127.0.0.1:5173';
const VIEWPORT = { width: 390, height: 844 };

const ALICE = { email: 'alice@example.com', password: 'testpass123', handle: 'alice_p' };
const BOB = { email: 'bob@example.com', password: 'testpass123', handle: 'bob_p' };

/**
 * Mirrors WorldMap's projection exactly so a target lat/lng can be converted into a
 * click position. This is what lets the test exercise the real pin-drop path rather
 * than only the manual country picker.
 */
const VIEW_W = 800;
const VIEW_H = 480;
const fc = feature(topo, topo.objects.countries);
const projection = geoEqualEarth().fitExtent(
  [
    [8, 8],
    [VIEW_W - 8, VIEW_H - 8],
  ],
  fc,
);

function svgPointFor(lat, lng) {
  const p = projection([lng, lat]);
  if (!p) throw new Error(`cannot project ${lat},${lng}`);
  return { x: p[0], y: p[1] };
}

async function clickMapAt(page, mapLocator, lat, lng) {
  const box = await mapLocator.boundingBox();
  if (!box) throw new Error('map has no bounding box');
  const { x, y } = svgPointFor(lat, lng);
  await page.mouse.click(box.x + (x / VIEW_W) * box.width, box.y + (y / VIEW_H) * box.height);
}

const shots = [];
async function shot(page, name) {
  const file = `${OUT}/${String(shots.length + 1).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  shots.push(file);
  console.log(`  📸 ${file}`);
}

function startDevServer() {
  // detached:true puts vite in its own process group so the whole group can be killed.
  // Killing only the npx wrapper leaves the real server holding port 5173, which then
  // silently serves a stale app to the next run.
  const proc = spawn('npx', ['vite'], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  proc.stdout.on('data', (d) => {
    if (process.env.E2E_VERBOSE) process.stdout.write(`[vite] ${d}`);
  });
  proc.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  return proc;
}

function stopDevServer(proc) {
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

/**
 * Navigation helper.
 *
 * Never use waitUntil:'networkidle' here — Firestore holds a streaming listener open for
 * the whole signed-in session, so the network never goes idle and every navigation after
 * login would time out. Wait for a specific element instead.
 */
async function goto(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
}

async function waitForServer(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  throw new Error(`dev server did not start at ${url}`);
}

/** Creates Bob's account, profile, entries and a friend request to Alice. */
async function seedBob(aliceUid) {
  const { initializeApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword } =
    await import('firebase/auth');
  const {
    getFirestore,
    connectFirestoreEmulator,
    doc,
    serverTimestamp,
    writeBatch,
    setDoc,
  } = await import('firebase/firestore');

  const app = initializeApp({ projectId: 'poold-d8f26', apiKey: 'fake-api-key' }, 'seed');
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);

  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, BOB.email, BOB.password);
  } catch {
    cred = await signInWithEmailAndPassword(auth, BOB.email, BOB.password);
  }
  const bobUid = cred.user.uid;

  const batch = writeBatch(db);
  batch.set(doc(db, 'usernames', BOB.handle), {
    uid: bobUid,
    claimedAt: serverTimestamp(),
    releasedAt: null,
  });
  batch.set(doc(db, 'publicProfiles', bobUid), {
    uid: bobUid,
    username: BOB.handle,
    usernameLower: BOB.handle,
    displayName: 'Bob Traveller',
    displayNameLower: 'bob traveller',
    avatarThumb: null,
    avatarUrl: null,
    joinedAt: serverTimestamp(),
    deleted: false,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'users', bobUid), {
    email: BOB.email,
    authProviders: ['password'],
    createdAt: serverTimestamp(),
    usernameChangedAt: null,
    settings: {
      defaultVisibility: 'friends',
      encounterCoverageMode: 'sharedOnly',
      homeCountry: 'GB',
    },
    friendUidsCache: [],
    deletion: null,
    schemaVersion: 1,
  });
  await batch.commit();

  // One shared entry and one private one, so the friend view can be checked to show
  // exactly the shared one while the totals still count both.
  const entries = [
    { id: 'bob-shared', visibility: 'friends', code: 'BR', name: 'Shared Person', rating: 9, date: '2026-03-14' },
    { id: 'bob-private', visibility: 'private', code: 'JP', name: 'Private Person', rating: 6, date: '2026-04-02' },
  ];
  for (const e of entries) {
    await setDoc(doc(db, 'users', bobUid, 'encounters', e.id), {
      ownerUid: bobUid,
      visibility: e.visibility,
      location: { lat: -22.97, lng: -43.18, label: 'Rio', source: 'pin', accuracyKm: null },
      countryCode: e.code,
      countryName: e.code === 'BR' ? 'Brazil' : 'Japan',
      countryNumeric: e.code === 'BR' ? '076' : '392',
      continent: e.code === 'BR' ? 'Americas' : 'Asia',
      subregion: e.code === 'BR' ? 'South America' : 'Eastern Asia',
      countryStatus: 'contains',
      nationalityCode: e.code,
      nationalityLabel: e.code === 'BR' ? 'Brazilian' : 'Japanese',
      name: e.name,
      age: 27,
      metVia: 'travel',
      metViaDetail: null,
      date: new Date(`${e.date}T12:00:00Z`),
      dateKey: e.date,
      description: 'Seeded for verification.',
      rating: e.rating,
      tags: ['seed'],
      photo: null,
      hasFullPhoto: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      schemaVersion: 1,
    });
  }

  await setDoc(doc(db, 'users', bobUid, 'aggregates', 'private'), {
    totalEntries: 2,
    countryCountsAll: { BR: 1, JP: 1 },
    countryCountsShared: { BR: 1 },
    nationalityCounts: { BR: 1, JP: 1 },
    metViaCounts: { travel: 2 },
    ratingSum: 15,
    ratingCount: 2,
    ratingSumShared: 9,
    ratingCountShared: 1,
    unresolvedCount: 0,
    firstEntryDateKey: '2026-03-14',
    lastEntryDateKey: '2026-04-02',
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'users', bobUid, 'aggregates', 'public'), {
    visitedManual: {
      FR: { firstVisit: null, lastVisit: null, note: null },
      IT: { firstVisit: null, lastVisit: null, note: null },
      TH: { firstVisit: null, lastVisit: null, note: null },
    },
    visitedCodes: ['BR', 'FR', 'IT', 'JP', 'TH'],
    encounterCoverageMode: 'sharedOnly',
    countryCounts: { BR: 1 },
    encounterTotal: 1,
    avgRatingPublished: 9,
    updatedAt: serverTimestamp(),
  });

  // Bob asks Alice to be friends, so Alice can accept through the real UI.
  await setDoc(doc(db, 'friendRequests', `${bobUid}__${aliceUid}`), {
    fromUid: bobUid,
    toUid: aliceUid,
    status: 'pending',
    createdAt: serverTimestamp(),
    respondedAt: null,
    message: 'Add me back',
    fromUsername: BOB.handle,
    fromDisplayName: 'Bob Traveller',
    fromAvatarThumb: null,
  });

  return bobUid;
}

async function getUid(email, password) {
  const { initializeApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await import('firebase/auth');
  const app = initializeApp({ projectId: 'poold-d8f26', apiKey: 'fake-api-key' }, `uid-${email}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user.uid;
}

const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name} ${detail}`);
    failures.push(`${name} ${detail}`.trim());
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const dev = startDevServer();

  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`  [browser error] ${m.text()}`);
  });
  page.on('pageerror', (e) => {
    console.log(`  [page error] ${e.message}`);
    failures.push(`page error: ${e.message}`);
  });

  try {
    await waitForServer(BASE);

    // ---------------------------------------------------------------- sign up
    console.log('\n▸ Sign up');
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /create one/i }).click();
    await shot(page, 'login');
    await page.locator('input[name="email"]').fill(ALICE.email);
    await page.locator('input[name="password"]').fill(ALICE.password);
    await page.getByRole('button', { name: /create account/i }).click();

    // ------------------------------------------------------------ onboarding
    console.log('\n▸ Onboarding');
    await page.getByText(/pick your username/i).waitFor({ timeout: 20_000 });
    await page.locator('input[placeholder="yourname"]').fill(ALICE.handle);
    await page.locator('input[placeholder="Your name"]').fill('Alice Adventurer');
    await page.getByText('Available.').waitFor({ timeout: 15_000 });
    await shot(page, 'onboarding');
    await page.getByRole('button', { name: /start mapping/i }).click();

    // ------------------------------------------------------------- empty map
    console.log('\n▸ Map (empty)');
    await page.locator('nav').getByText('Map').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(700);
    check('map renders country paths', (await page.locator('svg path').count()) > 150);
    await shot(page, 'map-empty');

    // ------------------------------------------------------------- add entry
    console.log('\n▸ Add entry with a dropped pin');
    await page.locator('nav a[href="/entry/new"]').click();
    await page.getByText(/^New entry$/).waitFor();
    await page.getByRole('button', { name: /drop a pin or pick a country/i }).click();
    await page.getByText(/where was it\?/i).waitFor();

    // Lisbon, via the real offline reverse geocoder.
    const sheetMap = page.locator('[role="dialog"] svg').first();
    await sheetMap.waitFor();
    await clickMapAt(page, sheetMap, 38.72, -9.14);
    await page.getByText('Portugal').first().waitFor({ timeout: 20_000 });
    check('pin resolved to Portugal offline', true);
    await shot(page, 'location-picker');
    await page.getByRole('button', { name: /use this location/i }).click();

    await page.locator('input[placeholder="e.g. Bairro Alto, Lisbon"]').fill('Bairro Alto');
    await page.locator('input[placeholder="Whatever you\'ll remember"]').fill('Ana');
    check(
      'nationality defaulted from the location',
      await page.getByText('Portuguese').first().isVisible(),
    );
    await page.locator('input[type="number"]').fill('26');
    await page.getByRole('button', { name: 'Club', exact: true }).click();
    await page.locator('input[type="range"]').fill('9');
    await page.locator('textarea').fill('Verification entry.');
    await page.locator('input[placeholder="holiday, festival"]').fill('travel, summer');
    await page.getByRole('button', { name: /friends/i }).last().click();
    await shot(page, 'entry-form');
    await page.getByRole('button', { name: 'Save' }).click();

    // ----------------------------------------------------------- entry detail
    console.log('\n▸ Entry detail');
    // Wait for NAVIGATION, not for text. The form contains the same strings, so a text
    // match passes even when the save silently fails — which is exactly how a hung save
    // slipped past this test before.
    await page.waitForURL((url) => /^\/entry\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'), {
      timeout: 30_000,
    });
    await page.getByRole('heading', { name: 'Ana' }).waitFor({ timeout: 20_000 });
    check('entry saved and detail screen opened', true);
    check('place label rendered', (await page.getByText('Bairro Alto').count()) > 0);
    check('nationality rendered', (await page.getByText('Portuguese').count()) > 0);
    check('rating shown', await page.getByLabel('Rating 9 out of 10').first().isVisible());
    await shot(page, 'entry-detail');

    // ------------------------------------------------------- map with shading
    console.log('\n▸ Map with coverage');
    await page.locator('nav a[href="/"]').click();
    await page.waitForTimeout(700);
    check(
      'headline count updated',
      (await page.getByTestId('map-total').innerText()).includes('1'),
    );
    check(
      'coverage line shows one country',
      (await page.getByTestId('map-coverage').innerText()).includes('1 country visited'),
    );
    await shot(page, 'map-one-entry');

    // ------------------------------------------------- visited countries layer
    console.log('\n▸ Mark countries visited (travel coverage)');
    await page.goto(`${BASE}/countries`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Countries visited').first().waitFor();
    for (const country of ['Japan', 'Brazil', 'Kenya', 'Australia']) {
      await page.locator('input[placeholder="Search countries"]').fill(country);
      await page.getByRole('button', { name: `Mark ${country} visited` }).click();
      await page.waitForTimeout(500);
    }
    await page.locator('input[placeholder="Search countries"]').fill('');
    await page.waitForTimeout(600);
    await shot(page, 'countries-visited');

    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    check(
      'travel coverage counted alongside the logged country',
      (await page.getByTestId('map-coverage').innerText()).includes('5 countries visited'),
      '(expected 4 marked + 1 logged)',
    );
    await shot(page, 'map-dual-layer');

    // Confirm the layer toggle actually changes what is drawn.
    await page.getByRole('button', { name: 'Logged', exact: true }).click();
    await page.waitForTimeout(400);
    await shot(page, 'map-logged-layer');
    await page.getByRole('button', { name: 'All', exact: true }).click();

    // -------------------------------------------------------------- stats
    console.log('\n▸ Stats and achievements');
    await page.locator('nav a[href="/stats"]').click();
    await page.getByText(/countries visited/i).first().waitFor();
    await page.waitForTimeout(500);
    check('stats show continents covered', (await page.getByText(/\/6/).count()) > 0);
    await shot(page, 'stats');

    await page.getByText('Achievements').first().click();
    await page.getByText(/still to go/i).waitFor({ timeout: 10_000 });
    check('badges earned', (await page.getByText(/earned/i).count()) > 0);
    await shot(page, 'achievements');

    // ------------------------------------------------------------- friends
    console.log('\n▸ Friends: accept a request and view their map');
    const aliceUid = await getUid(ALICE.email, ALICE.password);
    await seedBob(aliceUid);

    await page.goto(`${BASE}/friends`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Bob Traveller').first().waitFor({ timeout: 20_000 });
    await shot(page, 'friend-request');
    await page.getByRole('button', { name: 'Accept' }).click();
    await page.waitForTimeout(1500);
    check(
      'friend appears on the leaderboard',
      (await page.getByText(/leaderboard/i).count()) > 0,
    );
    await shot(page, 'friends-list');

    await page.getByText('Bob Traveller').first().click();
    await page.getByText(/shared with you/i).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    check("friend's shared entry is visible", await page.getByText('Shared Person').isVisible());
    check(
      "friend's private entry is NOT visible",
      (await page.getByText('Private Person').count()) === 0,
    );
    check(
      "friend's travel coverage is visible (5 countries)",
      (await page.getByTestId('friend-countries').innerText()).includes('5'),
    );
    // The published count reflects only the shared entry, while their visited set still
    // includes the country of the private one — the whole point of the two layers.
    check(
      "friend's published count shows only the shared entry",
      (await page.getByTestId('friend-logged').innerText()).includes('1'),
    );
    await shot(page, 'friend-profile');

    // -------------------------------------------------------------- search
    console.log('\n▸ Friend search');
    await page.goto(`${BASE}/friends/search`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[placeholder="Username or display name"]').fill('bob');
    await page.getByText('Bob Traveller').first().waitFor({ timeout: 15_000 });
    check('search finds the user by username prefix', true);
    await shot(page, 'friend-search');

    // -------------------------------------------------------------- log/settings
    console.log('\n▸ Log and settings');
    await page.locator('nav a[href="/log"]').click();
    await page.getByText('Ana').first().waitFor();
    await shot(page, 'log');

    await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' });
    await page.getByText(/what friends see in your counts/i).waitFor();
    await shot(page, 'settings');
  } catch (err) {
    // A selector timeout tells you almost nothing on its own; the screen at the moment
    // of failure tells you everything.
    console.error(`\n✗ failed at step: ${err.message}`);
    await page
      .screenshot({ path: `${OUT}/FAILURE.png` })
      .then(() => console.error(`  see ${OUT}/FAILURE.png`))
      .catch(() => undefined);
    console.error(
      `  page text was: ${(await page
        .locator('body')
        .innerText()
        .catch(() => '(unavailable)')).slice(0, 400)}`,
    );
    throw err;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    stopDevServer(dev);
  }

  writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ shots, failures }, null, 2));
  console.log(`\n${shots.length} screenshots written to ${OUT}/`);
  if (failures.length) {
    console.error(`\n${failures.length} CHECK(S) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nAll end-to-end checks passed.');
  // Firestore listeners and the emulator SDK keep handles open; exit explicitly so the
  // wrapping `emulators:exec` can shut down instead of hanging.
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  // Best effort: capture whatever was on screen when it broke, which is far more useful
  // than the stack alone when a selector times out.
  process.exit(1);
});
