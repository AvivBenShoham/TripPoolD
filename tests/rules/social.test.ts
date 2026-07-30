import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { anon, authed, befriend, createProfile, createUserDoc, makeEnv, pairKey } from './helpers';

let env: RulesTestEnvironment;

const A = 'alice';
const B = 'bob';
const C = 'carol';

beforeAll(async () => {
  env = await makeEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  for (const [uid, handle] of [
    [A, 'alice'],
    [B, 'bob'],
    [C, 'carol'],
  ]) {
    await createProfile(authed(env, uid), uid, handle);
    await createUserDoc(authed(env, uid), uid);
  }
});

function requestPayload(from: string, to: string, extra: Record<string, unknown> = {}) {
  return {
    fromUid: from,
    toUid: to,
    status: 'pending',
    createdAt: serverTimestamp(),
    respondedAt: null,
    message: null,
    fromUsername: from,
    fromDisplayName: from,
    fromAvatarThumb: null,
    ...extra,
  };
}

describe('username uniqueness', () => {
  it('stops a second user claiming a taken handle', async () => {
    const db = authed(env, C);
    // Arrives as an update to an existing document, which the rules deny outright.
    await assertFails(
      setDoc(doc(db, 'usernames', 'alice'), {
        uid: C,
        claimedAt: serverTimestamp(),
        releasedAt: null,
      }),
    );
  });

  it('refuses a claim with no matching profile', async () => {
    const db = authed(env, C);
    await assertFails(
      setDoc(doc(db, 'usernames', 'brandnew'), {
        uid: C,
        claimedAt: serverTimestamp(),
        releasedAt: null,
      }),
    );
  });

  it('refuses a profile whose handle claim points at somebody else', async () => {
    const db = authed(env, C);
    await assertFails(
      setDoc(doc(db, 'publicProfiles', C), {
        uid: C,
        username: 'alice',
        usernameLower: 'alice',
        displayName: 'Carol',
        displayNameLower: 'carol',
        avatarThumb: null,
        avatarUrl: null,
        joinedAt: serverTimestamp(),
        deleted: false,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('enforces the lowercase invariant so Bob and bob cannot both exist', async () => {
    const db = authed(env, C);
    const batch = writeBatch(db);
    batch.set(doc(db, 'usernames', 'newname'), {
      uid: C,
      claimedAt: serverTimestamp(),
      releasedAt: null,
    });
    batch.set(doc(db, 'publicProfiles', C), {
      uid: C,
      username: 'NewName',
      usernameLower: 'NewName', // not lowercased — must be rejected
      displayName: 'Carol',
      displayNameLower: 'carol',
      avatarThumb: null,
      avatarUrl: null,
      joinedAt: serverTimestamp(),
      deleted: false,
      updatedAt: serverTimestamp(),
    });
    await assertFails(batch.commit());
  });

  it('cannot delete a handle claimed by someone else', async () => {
    const db = authed(env, C);
    await assertFails(deleteDoc(doc(db, 'usernames', 'alice')));
  });
});

describe('profile search', () => {
  it('is readable by any signed-in user but requires a limit', async () => {
    const db = authed(env, A);
    await assertSucceeds(getDoc(doc(db, 'publicProfiles', B)));

    // An unlimited query would let the whole directory be scraped.
    await assertFails(
      getDocs(query(collection(db, 'publicProfiles'), orderBy('usernameLower'))),
    );
    await assertFails(
      getDocs(query(collection(db, 'publicProfiles'), orderBy('usernameLower'), limit(50))),
    );

    const ok = await assertSucceeds(
      getDocs(
        query(
          collection(db, 'publicProfiles'),
          where('usernameLower', '>=', 'b'),
          where('usernameLower', '<', 'b'),
          orderBy('usernameLower'),
          limit(15),
        ),
      ),
    );
    expect(ok.docs.map((d) => d.id)).toEqual([B]);
  });

  it('is not readable when signed out', async () => {
    const db = anon(env);
    await assertFails(getDoc(doc(db, 'publicProfiles', A)));
  });
});

describe('friend requests', () => {
  it('lets a user send one, and blocks self-requests', async () => {
    const db = authed(env, A);
    await assertSucceeds(
      setDoc(doc(db, 'friendRequests', `${A}__${B}`), requestPayload(A, B)),
    );
    await assertFails(
      setDoc(doc(db, 'friendRequests', `${A}__${A}`), requestPayload(A, A)),
    );
  });

  it('rejects a spoofed sender identity', async () => {
    const db = authed(env, A);
    // Claiming to be Bob in the denormalised fields the recipient's inbox renders.
    await assertFails(
      setDoc(
        doc(db, 'friendRequests', `${A}__${B}`),
        requestPayload(A, B, { fromUsername: 'bob', fromDisplayName: 'bob' }),
      ),
    );
  });

  it('rejects a request forged on behalf of another user', async () => {
    const db = authed(env, C);
    await assertFails(
      setDoc(doc(db, 'friendRequests', `${A}__${B}`), requestPayload(A, B)),
    );
  });

  it('rejects a request to a nonexistent user', async () => {
    const db = authed(env, A);
    await assertFails(
      setDoc(doc(db, 'friendRequests', `${A}__ghost`), requestPayload(A, 'ghost')),
    );
  });

  it('lets only the recipient decline, and only pending to declined', async () => {
    await setDoc(
      doc(authed(env, A), 'friendRequests', `${A}__${B}`),
      requestPayload(A, B),
    );

    // The sender cannot decline their own request on the recipient's behalf.
    await assertFails(
      updateDoc(doc(authed(env, A), 'friendRequests', `${A}__${B}`), {
        status: 'declined',
        respondedAt: serverTimestamp(),
      }),
    );
    // Nor can they promote it to accepted.
    await assertFails(
      updateDoc(doc(authed(env, A), 'friendRequests', `${A}__${B}`), {
        status: 'accepted',
        respondedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(authed(env, B), 'friendRequests', `${A}__${B}`), {
        status: 'declined',
        respondedAt: serverTimestamp(),
      }),
    );
  });

  it('scopes the inbox and outbox queries to the caller', async () => {
    await setDoc(doc(authed(env, A), 'friendRequests', `${A}__${B}`), requestPayload(A, B));
    const db = authed(env, B);

    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'friendRequests'),
          where('toUid', '==', B),
          where('status', '==', 'pending'),
          orderBy('createdAt', 'desc'),
          limit(50),
        ),
      ),
    );
    // A query constraining neither participant field cannot satisfy the rule.
    await assertFails(getDocs(query(collection(db, 'friendRequests'))));
    // Nor can Bob read Carol's inbox.
    await assertFails(
      getDocs(query(collection(db, 'friendRequests'), where('toUid', '==', C), limit(50))),
    );
  });
});

describe('friendships cannot be forged', () => {
  it('refuses creation with no pending request', async () => {
    const db = authed(env, B);
    const uids = [A, B].sort();
    await assertFails(
      setDoc(doc(db, 'friendships', pairKey(A, B)), {
        uids,
        initiatorUid: A,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('refuses creation when the request was declined', async () => {
    await setDoc(doc(authed(env, A), 'friendRequests', `${A}__${B}`), requestPayload(A, B));
    await updateDoc(doc(authed(env, B), 'friendRequests', `${A}__${B}`), {
      status: 'declined',
      respondedAt: serverTimestamp(),
    });

    const db = authed(env, B);
    await assertFails(
      setDoc(doc(db, 'friendships', pairKey(A, B)), {
        uids: [A, B].sort(),
        initiatorUid: A,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('refuses the sender accepting their own request', async () => {
    await setDoc(doc(authed(env, A), 'friendRequests', `${A}__${B}`), requestPayload(A, B));
    const db = authed(env, A);
    await assertFails(
      setDoc(doc(db, 'friendships', pairKey(A, B)), {
        uids: [A, B].sort(),
        initiatorUid: B,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('refuses a third party inserting themselves into a friendship', async () => {
    await setDoc(doc(authed(env, A), 'friendRequests', `${A}__${B}`), requestPayload(A, B));
    const db = authed(env, C);
    await assertFails(
      setDoc(doc(db, 'friendships', pairKey(A, B)), {
        uids: [A, B].sort(),
        initiatorUid: A,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it('refuses a mismatched document id', async () => {
    await setDoc(doc(authed(env, A), 'friendRequests', `${A}__${B}`), requestPayload(A, B));
    const db = authed(env, B);
    await assertFails(
      setDoc(doc(db, 'friendships', 'not-the-pair-key'), {
        uids: [A, B].sort(),
        initiatorUid: A,
        createdAt: serverTimestamp(),
      }),
    );
  });

  /**
   * Accept is a batch of create-friendship + delete-request. The friendship rule get()s
   * the request, and inside a batch that read sees pre-batch state — so it still reads
   * 'pending' even though the same batch removes it.
   */
  it('accepts through the real batch, and the request is consumed', async () => {
    await setDoc(doc(authed(env, A), 'friendRequests', `${A}__${B}`), requestPayload(A, B));

    const db = authed(env, B);
    const uids = [A, B].sort();
    const batch = writeBatch(db);
    batch.set(doc(db, 'friendships', pairKey(A, B)), {
      uids,
      initiatorUid: A,
      createdAt: serverTimestamp(),
    });
    batch.delete(doc(db, 'friendRequests', `${A}__${B}`));
    await assertSucceeds(batch.commit());

    const snap = await getDoc(doc(db, 'friendships', pairKey(A, B)));
    expect(snap.exists()).toBe(true);
  });

  it('is immutable once created, and either party may delete it', async () => {
    await befriend(env, A, B);
    await assertFails(
      updateDoc(doc(authed(env, B), 'friendships', pairKey(A, B)), { initiatorUid: B }),
    );
    await assertFails(deleteDoc(doc(authed(env, C), 'friendships', pairKey(A, B))));
    await assertSucceeds(deleteDoc(doc(authed(env, A), 'friendships', pairKey(A, B))));
  });

  it('lists only the caller’s own friendships', async () => {
    await befriend(env, A, B);
    const db = authed(env, A);
    await assertSucceeds(
      getDocs(
        query(
          collection(db, 'friendships'),
          where('uids', 'array-contains', A),
          orderBy('createdAt', 'desc'),
        ),
      ),
    );
    await assertFails(getDocs(query(collection(db, 'friendships'))));
    await assertFails(
      getDocs(query(collection(db, 'friendships'), where('uids', 'array-contains', C))),
    );
  });
});

describe('blocking', () => {
  it('stops a blocked user from sending a request', async () => {
    await setDoc(doc(authed(env, B), 'users', B, 'blocked', A), {
      createdAt: serverTimestamp(),
    });
    const db = authed(env, A);
    await assertFails(
      setDoc(doc(db, 'friendRequests', `${A}__${B}`), requestPayload(A, B)),
    );
  });

  it('keeps a block list private to its owner', async () => {
    await setDoc(doc(authed(env, B), 'users', B, 'blocked', A), {
      createdAt: serverTimestamp(),
    });
    await assertFails(getDoc(doc(authed(env, A), 'users', B, 'blocked', A)));
  });
});
