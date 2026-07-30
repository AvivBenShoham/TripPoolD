import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { authed, createProfile, createUserDoc, makeEnv } from './helpers';
import { aggregateDelta, deltaToUpdates } from '../../src/lib/aggregates/delta';
import { dayToTimestamp } from '../../src/lib/format';
import { EMPTY_PRIVATE_AGGREGATES, EMPTY_PUBLIC_AGGREGATES } from '../../src/types';

/**
 * Reproduces the write the app actually performs when saving an entry — the same batch,
 * built with the same real delta functions.
 *
 * The hand-written fixture in entries.test.ts passed while the app hung, because the app
 * writes the entry and both aggregate documents in ONE batch, and a batch fails as a
 * whole. Testing the real shape is the only way that class of bug shows up.
 */

let env: RulesTestEnvironment;
const ME = 'alice';

beforeAll(async () => {
  env = await makeEnv();
});

afterAll(async () => {
  await env.cleanup();
});

/** Mirrors onboarding: profile, user doc, and both aggregates seeded complete. */
async function onboard(db: Firestore, uid: string) {
  await createProfile(db, uid, uid);
  await createUserDoc(db, uid);
  await setDoc(doc(db, 'users', uid, 'aggregates', 'private'), {
    ...EMPTY_PRIVATE_AGGREGATES,
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'users', uid, 'aggregates', 'public'), {
    ...EMPTY_PUBLIC_AGGREGATES,
    updatedAt: serverTimestamp(),
  });
}

beforeEach(async () => {
  await env.clearFirestore();
  await onboard(authed(env, ME), ME);
});

/** Byte-for-byte what src/services/encounters.ts `toDocument()` produces. */
function appEntryDocument(uid: string, over: Record<string, unknown> = {}) {
  return {
    ownerUid: uid,
    visibility: 'friends',
    location: {
      lat: 38.72,
      lng: -9.14,
      label: 'Bairro Alto',
      source: 'pin',
      accuracyKm: null,
    },
    countryCode: 'PT',
    countryName: 'Portugal',
    countryNumeric: '620',
    continent: 'Europe',
    subregion: 'Southern Europe',
    countryStatus: 'contains',
    nationalityCode: 'PT',
    nationalityLabel: 'Portuguese',
    name: 'Ana',
    age: 26,
    metVia: 'club',
    metViaDetail: null,
    date: dayToTimestamp('2026-07-29'),
    dateKey: '2026-07-29',
    description: 'Verification entry.',
    rating: 9,
    tags: ['travel', 'summer'],
    photo: null,
    hasFullPhoto: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    schemaVersion: 1,
    ...over,
  };
}

describe('the real entry-create batch', () => {
  it('commits the entry and both aggregate updates together', async () => {
    const db = authed(env, ME);

    const delta = aggregateDelta(
      null,
      {
        countryCode: 'PT',
        nationalityCode: 'PT',
        metVia: 'club',
        rating: 9,
        visibility: 'friends',
        dateKey: '2026-07-29',
      },
      'sharedOnly',
      () => false,
    );
    const { priv, pub } = deltaToUpdates(delta);

    const batch = writeBatch(db);
    batch.set(doc(db, 'users', ME, 'encounters', 'e1'), appEntryDocument(ME));
    batch.update(doc(db, 'users', ME, 'aggregates', 'private'), {
      ...priv,
      firstEntryDateKey: '2026-07-29',
      lastEntryDateKey: '2026-07-29',
    });
    batch.update(doc(db, 'users', ME, 'aggregates', 'public'), {
      ...pub,
      encounterCoverageMode: 'sharedOnly',
    });

    await assertSucceeds(batch.commit());

    // And the dotted paths must have landed as NESTED fields, not literal dotted keys.
    const snap = await getDoc(doc(db, 'users', ME, 'aggregates', 'private'));
    const data = snap.data() as Record<string, unknown>;
    expect(data.totalEntries).toBe(1);
    expect(data.countryCountsAll).toEqual({ PT: 1 });
    expect(data['countryCountsAll.PT']).toBeUndefined();

    const pubSnap = await getDoc(doc(db, 'users', ME, 'aggregates', 'public'));
    const pubData = pubSnap.data() as Record<string, unknown>;
    expect(pubData.countryCounts).toEqual({ PT: 1 });
    expect(pubData.visitedCodes).toEqual(['PT']);
  });

  /**
   * The bug this whole file exists for: `set(..., { merge: true })` treats a key with a
   * dot as a literal field name rather than a nested path, so the document ends up with a
   * field called "countryCountsAll.PT" — which hasOnly() correctly rejects.
   */
  it('rejects dotted field names written through set(merge), as the old code did', async () => {
    const db = authed(env, ME);
    await assertFails(
      setDoc(
        doc(db, 'users', ME, 'aggregates', 'private'),
        { 'countryCountsAll.PT': 1, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
  });

  it('marks a country visited with a nested dotted path', async () => {
    const db = authed(env, ME);
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', ME, 'aggregates', 'public'), {
      'visitedManual.JP': { firstVisit: null, lastVisit: null, note: null },
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());

    const snap = await getDoc(doc(db, 'users', ME, 'aggregates', 'public'));
    expect((snap.data() as Record<string, unknown>).visitedManual).toEqual({
      JP: { firstVisit: null, lastVisit: null, note: null },
    });
  });

  it('still enforces entry validation inside the batch', async () => {
    const db = authed(env, ME);
    const batch = writeBatch(db);
    // Under-age entry must sink the whole batch, aggregates included.
    batch.set(doc(db, 'users', ME, 'encounters', 'bad'), appEntryDocument(ME, { age: 16 }));
    batch.update(doc(db, 'users', ME, 'aggregates', 'private'), {
      totalEntries: 1,
      updatedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });
});
