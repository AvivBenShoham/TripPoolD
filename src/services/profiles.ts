import {
  doc,
  getDoc,
  getDocs,
  collection,
  limit as qLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Transaction,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { PublicProfile, UserSettings } from '../types';
import {
  EMPTY_PRIVATE_AGGREGATES,
  EMPTY_PUBLIC_AGGREGATES,
  SCHEMA_VERSION,
} from '../types';

/** Handles are stored lowercase; the display case lives on the profile. */
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/** Days a released handle stays reserved, to block impersonation by handle recycling. */
export const HANDLE_TOMBSTONE_DAYS = 30;

export function profileRef(uid: string) {
  return doc(db, 'publicProfiles', uid);
}

export function userRef(uid: string) {
  return doc(db, 'users', uid);
}

export function usernameRef(handleLower: string) {
  return doc(db, 'usernames', handleLower);
}

export async function getProfile(uid: string): Promise<PublicProfile | null> {
  const snap = await getDoc(profileRef(uid));
  return snap.exists() ? (snap.data() as PublicProfile) : null;
}

export type HandleAvailability = 'available' | 'taken' | 'reserved' | 'mine' | 'invalid';

/**
 * Advisory availability check for live feedback while typing. The real gate is the
 * claim transaction below — this can always be stale by the time the user submits.
 */
export async function checkHandle(
  handle: string,
  myUid: string | null,
): Promise<HandleAvailability> {
  const lower = handle.trim().toLowerCase();
  if (!HANDLE_RE.test(lower)) return 'invalid';
  const snap = await getDoc(usernameRef(lower));
  if (!snap.exists()) return 'available';
  const d = snap.data() as { uid: string; releasedAt: { toMillis(): number } | null };
  if (d.uid === myUid) return 'mine';
  if (d.releasedAt) {
    const expires = d.releasedAt.toMillis() + HANDLE_TOMBSTONE_DAYS * 86_400_000;
    return Date.now() > expires ? 'available' : 'reserved';
  }
  return 'taken';
}

export class HandleError extends Error {
  constructor(public readonly reason: HandleAvailability) {
    super(reason);
  }
}

interface ClaimInput {
  uid: string;
  email: string;
  handle: string;
  displayName: string;
  avatarThumb: string | null;
  avatarUrl: string | null;
  authProviders: string[];
  homeCountry: string | null;
}

/**
 * Claims a handle and creates the profile in one transaction.
 *
 * Uniqueness is structural rather than checked-then-hoped: the /usernames key space
 * makes a second claim on the same handle arrive as an update, which the rules deny, and
 * the transaction's read set includes the missing document so concurrent claimants are
 * serialised — the loser retries and then sees it exists.
 *
 * The rules additionally cross-check both directions with getAfter(), so a claim cannot
 * exist without a profile pointing at it, nor a profile without a matching claim.
 */
export async function claimHandleAndCreateProfile(input: ClaimInput): Promise<void> {
  const lower = input.handle.trim().toLowerCase();
  if (!HANDLE_RE.test(lower)) throw new HandleError('invalid');

  await runTransaction(db, async (tx: Transaction) => {
    const claimSnap = await tx.get(usernameRef(lower));
    if (claimSnap.exists()) {
      const d = claimSnap.data() as { uid: string; releasedAt: { toMillis(): number } | null };
      if (d.uid !== input.uid) {
        const expired =
          d.releasedAt &&
          Date.now() > d.releasedAt.toMillis() + HANDLE_TOMBSTONE_DAYS * 86_400_000;
        if (!expired) throw new HandleError(d.releasedAt ? 'reserved' : 'taken');
      }
    }

    const existingProfile = await tx.get(profileRef(input.uid));
    const oldHandle = existingProfile.exists()
      ? (existingProfile.data() as PublicProfile).usernameLower
      : null;

    tx.set(usernameRef(lower), {
      uid: input.uid,
      claimedAt: serverTimestamp(),
      releasedAt: null,
    });

    tx.set(profileRef(input.uid), {
      uid: input.uid,
      username: input.handle.trim(),
      usernameLower: lower,
      displayName: input.displayName.trim(),
      displayNameLower: input.displayName.trim().toLowerCase(),
      avatarThumb: input.avatarThumb,
      avatarUrl: input.avatarUrl,
      joinedAt: existingProfile.exists()
        ? (existingProfile.data() as PublicProfile).joinedAt
        : serverTimestamp(),
      deleted: false,
      updatedAt: serverTimestamp(),
    });

    if (!existingProfile.exists()) {
      // Seed both aggregate documents complete and zeroed, in the same transaction.
      // This is what lets every later aggregate write be a real `update` with nested
      // field paths (`countryCountsAll.PT`) rather than a merge-set, and it means the
      // security rules never have to reason about a half-populated document.
      tx.set(doc(db, 'users', input.uid, 'aggregates', 'private'), {
        ...EMPTY_PRIVATE_AGGREGATES,
        updatedAt: serverTimestamp(),
      });
      tx.set(doc(db, 'users', input.uid, 'aggregates', 'public'), {
        ...EMPTY_PUBLIC_AGGREGATES,
        updatedAt: serverTimestamp(),
      });

      tx.set(userRef(input.uid), {
        email: input.email,
        authProviders: input.authProviders,
        createdAt: serverTimestamp(),
        usernameChangedAt: null,
        settings: {
          defaultVisibility: 'private',
          encounterCoverageMode: 'sharedOnly',
          homeCountry: input.homeCountry,
        } satisfies UserSettings,
        friendUidsCache: [],
        deletion: null,
        schemaVersion: SCHEMA_VERSION,
      });
    }

    // Tombstone the previous handle rather than freeing it immediately.
    if (oldHandle && oldHandle !== lower) {
      tx.update(usernameRef(oldHandle), { releasedAt: serverTimestamp() });
    }
  });
}

export async function updateProfileFields(
  uid: string,
  current: PublicProfile,
  fields: { displayName?: string; avatarThumb?: string | null; avatarUrl?: string | null },
): Promise<void> {
  const displayName = (fields.displayName ?? current.displayName).trim();
  await setDoc(profileRef(uid), {
    ...current,
    displayName,
    displayNameLower: displayName.toLowerCase(),
    avatarThumb: fields.avatarThumb !== undefined ? fields.avatarThumb : current.avatarThumb,
    avatarUrl: fields.avatarUrl !== undefined ? fields.avatarUrl : current.avatarUrl,
    updatedAt: serverTimestamp(),
  });
}

export async function updateSettings(uid: string, settings: UserSettings): Promise<void> {
  await updateDoc(userRef(uid), { settings });
}

/**
 * Prefix search over username and display name, run as two queries and merged.
 *
 * Firestore has no substring search, so this matches the START of a handle or name, not
 * the middle. The limit() call is mandatory, not an optimisation: the rules require
 * `request.query.limit <= 25`, and a query with no limit leaves that null and is denied.
 */
export async function searchProfiles(rawQuery: string, myUid: string): Promise<PublicProfile[]> {
  const q = rawQuery.trim().toLowerCase();
  if (q.length < 2) return [];
  // '\uf8ff' is the highest Basic-Multilingual-Plane private-use character, so it
  // sorts after any realistic suffix. This is the standard Firestore prefix-range
  // idiom; note it matches the START of a handle or name, never the middle.
  const hi = q + '\uf8ff';

  const [byHandle, byName] = await Promise.all([
    getDocs(
      query(
        collection(db, 'publicProfiles'),
        where('usernameLower', '>=', q),
        where('usernameLower', '<', hi),
        orderBy('usernameLower'),
        qLimit(15),
      ),
    ),
    getDocs(
      query(
        collection(db, 'publicProfiles'),
        where('displayNameLower', '>=', q),
        where('displayNameLower', '<', hi),
        orderBy('displayNameLower'),
        qLimit(15),
      ),
    ),
  ]);

  const merged = new Map<string, PublicProfile>();
  for (const snap of [...byHandle.docs, ...byName.docs]) {
    const p = snap.data() as PublicProfile;
    // `deleted` is filtered here rather than in the query: a where() on it would need
    // a composite index and would also exclude documents written before the field existed.
    if (p.uid === myUid || p.deleted) continue;
    merged.set(p.uid, p);
  }
  return [...merged.values()];
}

/** Batched profile fetch for friend lists and request inboxes. */
export async function getProfiles(uids: string[]): Promise<Map<string, PublicProfile>> {
  const out = new Map<string, PublicProfile>();
  const snaps = await Promise.all(uids.map((uid) => getDoc(profileRef(uid))));
  for (const snap of snaps) {
    if (snap.exists()) out.set(snap.id, snap.data() as PublicProfile);
  }
  return out;
}
