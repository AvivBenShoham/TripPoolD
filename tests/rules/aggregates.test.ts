import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { authed, befriend, createProfile, createUserDoc, makeEnv } from './helpers';

let env: RulesTestEnvironment;

const ME = 'alice';
const FRIEND = 'bob';
const STRANGER = 'carol';

beforeAll(async () => {
  env = await makeEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  for (const [uid, handle] of [
    [ME, 'alice'],
    [FRIEND, 'bob'],
    [STRANGER, 'carol'],
  ]) {
    await createProfile(authed(env, uid), uid, handle);
    await createUserDoc(authed(env, uid), uid);
  }
});

const publicAgg = (extra: Record<string, unknown> = {}) => ({
  visitedManual: { PT: { firstVisit: null, lastVisit: null, note: null } },
  visitedCodes: ['PT', 'ES'],
  encounterCoverageMode: 'sharedOnly',
  countryCounts: { ES: 2 },
  encounterTotal: 2,
  avgRatingPublished: 7.5,
  updatedAt: serverTimestamp(),
  ...extra,
});

const privateAgg = (extra: Record<string, unknown> = {}) => ({
  totalEntries: 3,
  countryCountsAll: { PT: 1, ES: 2 },
  countryCountsShared: { ES: 2 },
  nationalityCounts: { PT: 1, ES: 2 },
  metViaCounts: { bar: 3 },
  ratingSum: 22,
  ratingCount: 3,
  ratingSumShared: 15,
  ratingCountShared: 2,
  unresolvedCount: 0,
  firstEntryDateKey: '2026-01-01',
  lastEntryDateKey: '2026-05-01',
  updatedAt: serverTimestamp(),
  ...extra,
});

describe('aggregate visibility', () => {
  it('keeps the private aggregate owner-only', async () => {
    await setDoc(doc(authed(env, ME), 'users', ME, 'aggregates', 'private'), privateAgg());
    await befriend(env, FRIEND, ME);

    await assertSucceeds(getDoc(doc(authed(env, ME), 'users', ME, 'aggregates', 'private')));
    await assertFails(getDoc(doc(authed(env, FRIEND), 'users', ME, 'aggregates', 'private')));
    await assertFails(getDoc(doc(authed(env, STRANGER), 'users', ME, 'aggregates', 'private')));
  });

  /** One document read is all a friend needs to render the whole map plus totals. */
  it('lets a friend read the public aggregate, but not a stranger', async () => {
    await setDoc(doc(authed(env, ME), 'users', ME, 'aggregates', 'public'), publicAgg());
    await befriend(env, FRIEND, ME);

    const snap = await assertSucceeds(
      getDoc(doc(authed(env, FRIEND), 'users', ME, 'aggregates', 'public')),
    );
    expect(snap.data()?.visitedCodes).toEqual(['PT', 'ES']);
    await assertFails(getDoc(doc(authed(env, STRANGER), 'users', ME, 'aggregates', 'public')));
  });

  it('never lets a friend list the aggregates subcollection', async () => {
    await setDoc(doc(authed(env, ME), 'users', ME, 'aggregates', 'public'), publicAgg());
    await setDoc(doc(authed(env, ME), 'users', ME, 'aggregates', 'private'), privateAgg());
    await befriend(env, FRIEND, ME);
    // Listing would otherwise be a way to reach the private document.
    await assertFails(getDocs(collection(authed(env, FRIEND), 'users', ME, 'aggregates')));
  });

  it('loses friend access as soon as the friendship is removed', async () => {
    await setDoc(doc(authed(env, ME), 'users', ME, 'aggregates', 'public'), publicAgg());
    await befriend(env, FRIEND, ME);
    await assertSucceeds(getDoc(doc(authed(env, FRIEND), 'users', ME, 'aggregates', 'public')));

    const uids = [ME, FRIEND].sort();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`friendships/${uids[0]}__${uids[1]}`).delete();
    });
    await assertFails(getDoc(doc(authed(env, FRIEND), 'users', ME, 'aggregates', 'public')));
  });

  it('refuses writes to another user’s aggregates', async () => {
    await assertFails(
      setDoc(doc(authed(env, STRANGER), 'users', ME, 'aggregates', 'public'), publicAgg()),
    );
    await befriend(env, FRIEND, ME);
    await assertFails(
      setDoc(doc(authed(env, FRIEND), 'users', ME, 'aggregates', 'public'), publicAgg()),
    );
  });
});

describe('aggregate shape', () => {
  it('accepts a well-formed write', async () => {
    const db = authed(env, ME);
    await assertSucceeds(setDoc(doc(db, 'users', ME, 'aggregates', 'public'), publicAgg()));
    await assertSucceeds(setDoc(doc(db, 'users', ME, 'aggregates', 'private'), privateAgg()));
  });

  it('rejects an unknown field', async () => {
    const db = authed(env, ME);
    await assertFails(
      setDoc(doc(db, 'users', ME, 'aggregates', 'public'), publicAgg({ backdoor: 1 })),
    );
  });

  it('rejects an invalid coverage mode', async () => {
    const db = authed(env, ME);
    await assertFails(
      setDoc(
        doc(db, 'users', ME, 'aggregates', 'public'),
        publicAgg({ encounterCoverageMode: 'everything' }),
      ),
    );
  });

  it('rejects a negative total', async () => {
    const db = authed(env, ME);
    await assertFails(
      setDoc(doc(db, 'users', ME, 'aggregates', 'private'), privateAgg({ totalEntries: -1 })),
    );
  });

  /**
   * Confirms rules see the POST-transform value of increment(), so the >= 0 bound
   * actually constrains the outcome rather than the delta. This is the assumption the
   * whole client-maintained aggregate design rests on.
   */
  it('applies numeric bounds to the result of increment()', async () => {
    const db = authed(env, ME);
    await setDoc(doc(db, 'users', ME, 'aggregates', 'private'), privateAgg({ totalEntries: 1 }));

    await assertSucceeds(
      setDoc(
        doc(db, 'users', ME, 'aggregates', 'private'),
        { totalEntries: increment(-1), updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
    // Now at 0; decrementing again would take it negative, which must be refused.
    await assertFails(
      setDoc(
        doc(db, 'users', ME, 'aggregates', 'private'),
        { totalEntries: increment(-1), updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
  });

  it('caps the country maps and the visited list', async () => {
    const db = authed(env, ME);
    const tooMany: Record<string, number> = {};
    for (let i = 0; i < 321; i += 1) tooMany[`C${i}`] = 1;
    await assertFails(
      setDoc(doc(db, 'users', ME, 'aggregates', 'public'), publicAgg({ countryCounts: tooMany })),
    );
    await assertFails(
      setDoc(
        doc(db, 'users', ME, 'aggregates', 'public'),
        publicAgg({ visitedCodes: Array.from({ length: 321 }, (_, i) => `C${i}`) }),
      ),
    );
  });

  it('rejects a document with an unexpected id', async () => {
    const db = authed(env, ME);
    await assertFails(setDoc(doc(db, 'users', ME, 'aggregates', 'sneaky'), publicAgg()));
  });
});

describe('private user document', () => {
  it('is readable and writable only by its owner', async () => {
    await assertSucceeds(getDoc(doc(authed(env, ME), 'users', ME)));
    await assertFails(getDoc(doc(authed(env, STRANGER), 'users', ME)));
    await befriend(env, FRIEND, ME);
    // Even a friend never sees settings or the email address.
    await assertFails(getDoc(doc(authed(env, FRIEND), 'users', ME)));
  });

  it('pins the email to the auth token', async () => {
    const db = authed(env, STRANGER);
    await assertFails(
      setDoc(doc(db, 'users', STRANGER), {
        email: 'someone.else@example.com',
        authProviders: ['password'],
        createdAt: serverTimestamp(),
        usernameChangedAt: null,
        settings: {
          defaultVisibility: 'private',
          encounterCoverageMode: 'sharedOnly',
          homeCountry: null,
        },
        friendUidsCache: [],
        deletion: null,
        schemaVersion: 1,
      }),
    );
  });
});
