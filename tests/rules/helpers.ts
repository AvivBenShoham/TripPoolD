import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';

export const PROJECT_ID = 'poold-test';

export async function makeEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
}

/**
 * rules-unit-testing hands back a compat (v8) Firestore instance, while the app and these
 * tests use the modular API. The cast is the standard bridge between the two; the object
 * is the same client underneath.
 */
export function authed(
  env: RulesTestEnvironment,
  uid: string,
  email = `${uid}@example.com`,
): Firestore {
  return env
    .authenticatedContext(uid, { email, email_verified: true })
    .firestore() as unknown as Firestore;
}

export function anon(env: RulesTestEnvironment): Firestore {
  return env.unauthenticatedContext().firestore() as unknown as Firestore;
}

/**
 * Creates a profile the way the app does: the username claim and the profile in one
 * batch, because each rule cross-checks the other with getAfter().
 */
export async function createProfile(
  db: Firestore,
  uid: string,
  handle: string,
  displayName = handle,
): Promise<void> {
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
  await batch.commit();
}

export async function createUserDoc(db: Firestore, uid: string): Promise<void> {
  await setDoc(doc(db, 'users', uid), {
    email: `${uid}@example.com`,
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
  });
}

export function entryPayload(
  uid: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ownerUid: uid,
    visibility: 'private',
    location: { lat: 38.7, lng: -9.14, label: 'Lisbon', source: 'pin', accuracyKm: null },
    countryCode: 'PT',
    countryName: 'Portugal',
    countryNumeric: '620',
    continent: 'Europe',
    subregion: 'Southern Europe',
    countryStatus: 'contains',
    nationalityCode: 'PT',
    nationalityLabel: 'Portuguese',
    name: 'Test',
    age: 24,
    metVia: 'bar',
    metViaDetail: null,
    date: new Date('2026-05-01T12:00:00Z'),
    dateKey: '2026-05-01',
    description: 'notes',
    rating: 8,
    tags: ['travel'],
    photo: null,
    hasFullPhoto: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    schemaVersion: 1,
    ...overrides,
  };
}

/** Establishes a mutual friendship through the real request-then-accept flow. */
export async function befriend(
  env: RulesTestEnvironment,
  a: string,
  b: string,
): Promise<void> {
  const dbA = authed(env, a);
  await setDoc(doc(dbA, 'friendRequests', `${a}__${b}`), {
    fromUid: a,
    toUid: b,
    status: 'pending',
    createdAt: serverTimestamp(),
    respondedAt: null,
    message: null,
    fromUsername: a,
    fromDisplayName: a,
    fromAvatarThumb: null,
  });

  const dbB = authed(env, b);
  const uids = [a, b].sort();
  const batch = writeBatch(dbB);
  batch.set(doc(dbB, 'friendships', `${uids[0]}__${uids[1]}`), {
    uids,
    initiatorUid: a,
    createdAt: serverTimestamp(),
  });
  batch.delete(doc(dbB, 'friendRequests', `${a}__${b}`));
  await batch.commit();
}

export function pairKey(a: string, b: string): string {
  const uids = [a, b].sort();
  return `${uids[0]}__${uids[1]}`;
}
