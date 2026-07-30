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
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { authed, befriend, createProfile, createUserDoc, entryPayload, makeEnv } from './helpers';

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
  await createProfile(authed(env, ME), ME, 'alice');
  await createProfile(authed(env, FRIEND), FRIEND, 'bob');
  await createProfile(authed(env, STRANGER), STRANGER, 'carol');
  await createUserDoc(authed(env, ME), ME);
});

async function seedEntries() {
  const db = authed(env, ME);
  await setDoc(doc(db, 'users', ME, 'encounters', 'e-private'), entryPayload(ME));
  await setDoc(
    doc(db, 'users', ME, 'encounters', 'e-shared'),
    entryPayload(ME, { visibility: 'friends', name: 'Shared', countryCode: 'ES' }),
  );
}

describe('entry confidentiality', () => {
  it('lets the owner read their own entries', async () => {
    await seedEntries();
    const db = authed(env, ME);
    await assertSucceeds(getDoc(doc(db, 'users', ME, 'encounters', 'e-private')));
    await assertSucceeds(getDocs(query(collection(db, 'users', ME, 'encounters'))));
  });

  it('denies a stranger, even for a shared entry', async () => {
    await seedEntries();
    const db = authed(env, STRANGER);
    await assertFails(getDoc(doc(db, 'users', ME, 'encounters', 'e-shared')));
    await assertFails(
      getDocs(
        query(collection(db, 'users', ME, 'encounters'), where('visibility', '==', 'friends')),
      ),
    );
  });

  it('lets a friend read a shared entry but not a private one', async () => {
    await seedEntries();
    await befriend(env, FRIEND, ME);
    const db = authed(env, FRIEND);
    await assertSucceeds(getDoc(doc(db, 'users', ME, 'encounters', 'e-shared')));
    // Fetching by exact ID must not bypass the visibility check.
    await assertFails(getDoc(doc(db, 'users', ME, 'encounters', 'e-private')));
  });

  /**
   * The central query/rule pairing. Rules are not filters: without the visibility
   * constraint Firestore cannot prove the rule holds for every possible result, so it
   * rejects the whole query rather than returning a narrowed set.
   */
  it('rejects a friend query that omits the visibility filter', async () => {
    await seedEntries();
    await befriend(env, FRIEND, ME);
    const db = authed(env, FRIEND);

    await assertFails(
      getDocs(query(collection(db, 'users', ME, 'encounters'), orderBy('date', 'desc'))),
    );

    const ok = await assertSucceeds(
      getDocs(
        query(
          collection(db, 'users', ME, 'encounters'),
          where('visibility', '==', 'friends'),
          orderBy('date', 'desc'),
          limit(20),
        ),
      ),
    );
    expect(ok.docs).toHaveLength(1);
    expect(ok.docs[0].id).toBe('e-shared');
  });

  it('revokes access the moment the friendship is deleted', async () => {
    await seedEntries();
    await befriend(env, FRIEND, ME);
    const db = authed(env, FRIEND);
    await assertSucceeds(getDoc(doc(db, 'users', ME, 'encounters', 'e-shared')));

    const uids = [ME, FRIEND].sort();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`friendships/${uids[0]}__${uids[1]}`).delete();
    });

    await assertFails(getDoc(doc(db, 'users', ME, 'encounters', 'e-shared')));
  });

  it('never lets anyone write to another user’s entries', async () => {
    const db = authed(env, STRANGER);
    await assertFails(
      setDoc(doc(db, 'users', ME, 'encounters', 'forged'), entryPayload(ME)),
    );
    // Not even by claiming ownership of the document body.
    await assertFails(
      setDoc(doc(db, 'users', ME, 'encounters', 'forged2'), entryPayload(STRANGER)),
    );
  });
});

describe('entry validation', () => {
  it('rejects an age below the 18 policy floor', async () => {
    const db = authed(env, ME);
    await assertFails(
      setDoc(doc(db, 'users', ME, 'encounters', 'bad'), entryPayload(ME, { age: 17 })),
    );
    await assertSucceeds(
      setDoc(doc(db, 'users', ME, 'encounters', 'ok'), entryPayload(ME, { age: 18 })),
    );
    // Age is optional, so null must still be accepted.
    await assertSucceeds(
      setDoc(doc(db, 'users', ME, 'encounters', 'ok2'), entryPayload(ME, { age: null })),
    );
  });

  it('rejects out-of-range ratings', async () => {
    const db = authed(env, ME);
    for (const rating of [0, 11, -1, 5.5]) {
      await assertFails(
        setDoc(doc(db, 'users', ME, 'encounters', `r${rating}`), entryPayload(ME, { rating })),
      );
    }
    await assertSucceeds(
      setDoc(doc(db, 'users', ME, 'encounters', 'r10'), entryPayload(ME, { rating: 10 })),
    );
  });

  it('rejects a malformed country code or date key', async () => {
    const db = authed(env, ME);
    await assertFails(
      setDoc(doc(db, 'users', ME, 'encounters', 'c1'), entryPayload(ME, { countryCode: 'prt' })),
    );
    await assertFails(
      setDoc(doc(db, 'users', ME, 'encounters', 'c2'), entryPayload(ME, { dateKey: '1-5-2026' })),
    );
  });

  it('rejects coordinates outside the world', async () => {
    const db = authed(env, ME);
    await assertFails(
      setDoc(
        doc(db, 'users', ME, 'encounters', 'geo'),
        entryPayload(ME, {
          location: { lat: 99, lng: 0, label: '', source: 'pin', accuracyKm: null },
        }),
      ),
    );
  });

  /** Confirms rules CEL really does expose List.join for bounding total tag length. */
  it('bounds tags by count and by joined length', async () => {
    const db = authed(env, ME);
    await assertFails(
      setDoc(
        doc(db, 'users', ME, 'encounters', 't1'),
        entryPayload(ME, { tags: Array.from({ length: 13 }, (_, i) => `tag${i}`) }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db, 'users', ME, 'encounters', 't2'),
        entryPayload(ME, { tags: [ 'x'.repeat(301) ] }),
      ),
    );
    await assertSucceeds(
      setDoc(
        doc(db, 'users', ME, 'encounters', 't3'),
        entryPayload(ME, { tags: ['a', 'b', 'c'] }),
      ),
    );
  });

  it('rejects unknown fields', async () => {
    const db = authed(env, ME);
    await assertFails(
      setDoc(
        doc(db, 'users', ME, 'encounters', 'x'),
        entryPayload(ME, { secretBackdoor: true }),
      ),
    );
  });

  it('rejects an oversized thumbnail', async () => {
    const db = authed(env, ME);
    await assertFails(
      setDoc(
        doc(db, 'users', ME, 'encounters', 'p'),
        entryPayload(ME, {
          photo: { thumbDataUrl: 'x'.repeat(48_001), w: 320, h: 320, bytes: 1 },
        }),
      ),
    );
  });

  it('will not let createdAt be rewritten on update', async () => {
    const db = authed(env, ME);
    await setDoc(doc(db, 'users', ME, 'encounters', 'e'), entryPayload(ME));
    await assertFails(
      setDoc(
        doc(db, 'users', ME, 'encounters', 'e'),
        entryPayload(ME, { createdAt: new Date('2000-01-01') }),
      ),
    );
  });
});

describe('media documents', () => {
  it('caps the stored image and follows the parent’s visibility', async () => {
    const db = authed(env, ME);
    await setDoc(
      doc(db, 'users', ME, 'encounters', 'e-shared'),
      entryPayload(ME, { visibility: 'friends', hasFullPhoto: true }),
    );
    await setDoc(
      doc(db, 'users', ME, 'encounters', 'e-private'),
      entryPayload(ME, { hasFullPhoto: true }),
    );

    const media = (id: string) => doc(db, 'users', ME, 'encounters', id, 'media', 'full');
    await assertSucceeds(
      setDoc(media('e-shared'), {
        dataUrl: 'data:image/jpeg;base64,AAAA',
        w: 1600,
        h: 900,
        bytes: 3,
        mime: 'image/jpeg',
        createdAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(media('e-private'), {
        dataUrl: 'data:image/jpeg;base64,AAAA',
        w: 1600,
        h: 900,
        bytes: 3,
        mime: 'image/jpeg',
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db, 'users', ME, 'encounters', 'e-shared', 'media', 'full'), {
        dataUrl: 'x'.repeat(750_001),
        w: 1,
        h: 1,
        bytes: 1,
        mime: 'image/jpeg',
        createdAt: serverTimestamp(),
      }),
    );

    await befriend(env, FRIEND, ME);
    const fdb = authed(env, FRIEND);
    await assertSucceeds(
      getDoc(doc(fdb, 'users', ME, 'encounters', 'e-shared', 'media', 'full')),
    );
    await assertFails(
      getDoc(doc(fdb, 'users', ME, 'encounters', 'e-private', 'media', 'full')),
    );
  });
});
