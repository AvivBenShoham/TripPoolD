/**
 * Seeds the emulator suite with two demo accounts and a mutual friendship, so the app has
 * something to look at during manual development.
 *
 *   npm run emu      # in one terminal
 *   npm run seed     # in another
 *   npm run dev      # then sign in as demo@example.com / testpass123
 *
 * Refuses to run against anything but the emulators — this writes plausible-looking
 * personal data and must never reach a real project.
 */
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_HOST = '127.0.0.1';
const FIRESTORE_PORT = 8080;
const PASSWORD = 'testpass123';

const app = initializeApp({ projectId: 'appdef-45ad0', apiKey: 'demo-key' }, 'seed');
const auth = getAuth(app);
connectAuthEmulator(auth, AUTH_EMULATOR, { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, FIRESTORE_HOST, FIRESTORE_PORT);

async function requireEmulator() {
  try {
    const res = await fetch(`${AUTH_EMULATOR}/`);
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    console.error(
      `No Auth emulator at ${AUTH_EMULATOR}. Start it first with \`npm run emu\`.\n` +
        'This script only ever writes to emulators, never to a real project.',
    );
    process.exit(1);
  }
}

async function ensureUser(email) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, PASSWORD);
    return cred.user.uid;
  } catch {
    const cred = await signInWithEmailAndPassword(auth, email, PASSWORD);
    return cred.user.uid;
  }
}

async function createIdentity(uid, handle, displayName, homeCountry) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'usernames', handle), {
    uid,
    claimedAt: serverTimestamp(),
    releasedAt: null,
  });
  batch.set(doc(db, 'publicProfiles', uid), {
    uid,
    username: handle,
    usernameLower: handle.toLowerCase(),
    displayName,
    displayNameLower: displayName.toLowerCase(),
    avatarThumb: null,
    avatarUrl: null,
    joinedAt: serverTimestamp(),
    deleted: false,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'users', uid), {
    email: `${handle}@example.com`,
    authProviders: ['password'],
    createdAt: serverTimestamp(),
    usernameChangedAt: null,
    settings: {
      defaultVisibility: 'private',
      encounterCoverageMode: 'sharedOnly',
      homeCountry,
    },
    friendUidsCache: [],
    deletion: null,
    schemaVersion: 1,
  });
  await batch.commit();
}

const COUNTRY_META = {
  PT: ['Portugal', '620', 'Europe', 'Southern Europe', 'Portuguese', 38.72, -9.14],
  ES: ['Spain', '724', 'Europe', 'Southern Europe', 'Spanish', 41.39, 2.17],
  BR: ['Brazil', '076', 'Americas', 'South America', 'Brazilian', -22.97, -43.18],
  JP: ['Japan', '392', 'Asia', 'Eastern Asia', 'Japanese', 35.68, 139.69],
  TH: ['Thailand', '764', 'Asia', 'South-Eastern Asia', 'Thai', 7.89, 98.39],
  MX: ['Mexico', '484', 'Americas', 'Central America', 'Mexican', 21.16, -86.85],
  GR: ['Greece', '300', 'Europe', 'Southern Europe', 'Greek', 37.45, 25.33],
};

async function addEntry(uid, id, spec) {
  const [countryName, numeric, continent, subregion, demonym, lat, lng] =
    COUNTRY_META[spec.code];
  await setDoc(doc(db, 'users', uid, 'encounters', id), {
    ownerUid: uid,
    visibility: spec.visibility,
    location: { lat, lng, label: spec.place, source: 'pin', accuracyKm: null },
    countryCode: spec.code,
    countryName,
    countryNumeric: numeric,
    continent,
    subregion,
    countryStatus: 'contains',
    nationalityCode: spec.nationality ?? spec.code,
    nationalityLabel: spec.nationality ? COUNTRY_META[spec.nationality][4] : demonym,
    name: spec.name,
    age: spec.age,
    metVia: spec.metVia,
    metViaDetail: null,
    date: new Date(`${spec.date}T12:00:00Z`),
    dateKey: spec.date,
    description: spec.description ?? '',
    rating: spec.rating,
    tags: spec.tags ?? [],
    photo: null,
    hasFullPhoto: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    schemaVersion: 1,
  });
}

/** Folds the seeded entries into the aggregate documents, exactly as the app would. */
async function writeAggregates(uid, entries, visitedManual, mode = 'sharedOnly') {
  const countryCountsAll = {};
  const countryCountsShared = {};
  const nationalityCounts = {};
  const metViaCounts = {};
  const published = {};
  let ratingSum = 0;
  let ratingCount = 0;
  let ratingSumShared = 0;
  let ratingCountShared = 0;
  let publishedTotal = 0;
  let publishedRatingSum = 0;
  let publishedRatingCount = 0;
  let first = null;
  let last = null;

  for (const e of entries) {
    countryCountsAll[e.code] = (countryCountsAll[e.code] ?? 0) + 1;
    const nat = e.nationality ?? e.code;
    nationalityCounts[nat] = (nationalityCounts[nat] ?? 0) + 1;
    metViaCounts[e.metVia] = (metViaCounts[e.metVia] ?? 0) + 1;
    ratingSum += e.rating;
    ratingCount += 1;
    if (e.visibility === 'friends') {
      countryCountsShared[e.code] = (countryCountsShared[e.code] ?? 0) + 1;
      ratingSumShared += e.rating;
      ratingCountShared += 1;
    }
    const contributes = mode === 'all' || (mode === 'sharedOnly' && e.visibility === 'friends');
    if (contributes) {
      published[e.code] = (published[e.code] ?? 0) + 1;
      publishedTotal += 1;
      publishedRatingSum += e.rating;
      publishedRatingCount += 1;
    }
    if (!first || e.date < first) first = e.date;
    if (!last || e.date > last) last = e.date;
  }

  await setDoc(doc(db, 'users', uid, 'aggregates', 'private'), {
    totalEntries: entries.length,
    countryCountsAll,
    countryCountsShared,
    nationalityCounts,
    metViaCounts,
    ratingSum,
    ratingCount,
    ratingSumShared,
    ratingCountShared,
    unresolvedCount: 0,
    firstEntryDateKey: first,
    lastEntryDateKey: last,
    updatedAt: serverTimestamp(),
  });

  const visited = new Set([...visitedManual, ...Object.keys(countryCountsAll)]);
  await setDoc(doc(db, 'users', uid, 'aggregates', 'public'), {
    visitedManual: Object.fromEntries(
      visitedManual.map((c) => [c, { firstVisit: null, lastVisit: null, note: null }]),
    ),
    visitedCodes: [...visited].sort(),
    encounterCoverageMode: mode,
    countryCounts: published,
    encounterTotal: publishedTotal,
    avgRatingPublished:
      publishedRatingCount === 0
        ? null
        : Math.round((publishedRatingSum / publishedRatingCount) * 10) / 10,
    updatedAt: serverTimestamp(),
  });
}

async function main() {
  await requireEmulator();

  console.log('Seeding demo account…');
  const demoUid = await ensureUser('demo@example.com');
  await createIdentity(demoUid, 'demo', 'Demo User', 'GB');

  const demoEntries = [
    { code: 'PT', place: 'Bairro Alto, Lisbon', name: 'Ana', age: 26, metVia: 'bar', rating: 9, date: '2026-05-02', visibility: 'friends', tags: ['travel'], description: 'Long night in Lisbon.' },
    { code: 'ES', place: 'Gothic Quarter', name: 'Lucia', age: 24, metVia: 'club', rating: 8, date: '2026-04-18', visibility: 'friends', tags: ['travel'] },
    { code: 'BR', place: 'Copacabana', name: 'Bea', age: 28, metVia: 'travel', rating: 10, date: '2026-02-11', visibility: 'private', tags: ['holiday'] },
    { code: 'JP', place: 'Shibuya', name: 'Yui', age: 27, metVia: 'dating_app', rating: 7, date: '2025-11-30', visibility: 'private' },
    { code: 'TH', place: 'Patong', name: 'Mai', age: 25, metVia: 'bar', rating: 6, date: '2025-09-04', visibility: 'friends' },
    { code: 'GR', place: 'Mykonos', name: 'Elena', age: 23, metVia: 'friends', rating: 9, date: '2025-07-21', visibility: 'friends', nationality: 'ES' },
  ];
  for (const [i, e] of demoEntries.entries()) await addEntry(demoUid, `demo-${i}`, e);
  await writeAggregates(demoUid, demoEntries, ['FR', 'IT', 'DE', 'NL', 'MA', 'US']);
  await signOut(auth);

  console.log('Seeding friend account…');
  const friendUid = await ensureUser('sam@example.com');
  await createIdentity(friendUid, 'sam', 'Sam Wanderer', 'US');
  const samEntries = [
    { code: 'MX', place: 'Tulum', name: 'Sofia', age: 26, metVia: 'travel', rating: 8, date: '2026-03-08', visibility: 'friends', tags: ['beach'] },
    { code: 'JP', place: 'Osaka', name: 'Rin', age: 29, metVia: 'club', rating: 7, date: '2026-01-19', visibility: 'private' },
  ];
  for (const [i, e] of samEntries.entries()) await addEntry(friendUid, `sam-${i}`, e);
  await writeAggregates(friendUid, samEntries, ['CA', 'AU', 'NZ', 'ZA', 'AR']);

  // Sam asks Demo to be friends, so the request is waiting in the app on first run.
  await setDoc(doc(db, 'friendRequests', `${friendUid}__${demoUid}`), {
    fromUid: friendUid,
    toUid: demoUid,
    status: 'pending',
    createdAt: serverTimestamp(),
    respondedAt: null,
    message: 'Add me back',
    fromUsername: 'sam',
    fromDisplayName: 'Sam Wanderer',
    fromAvatarThumb: null,
  });
  await signOut(auth);

  console.log(
    '\nDone.\n' +
      '  demo@example.com / testpass123  (6 entries, 11 countries visited, 1 friend request waiting)\n' +
      '  sam@example.com  / testpass123  (2 entries, 7 countries visited)\n',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
