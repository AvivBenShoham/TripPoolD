import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  arrayRemove,
  arrayUnion,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { FriendRequest, FriendRequestWithId, Friendship, PublicProfile } from '../types';
import { userRef } from './profiles';

/** One document per relationship, keyed by the two uids sorted — no asymmetry possible. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

export function friendshipRef(a: string, b: string) {
  return doc(db, 'friendships', pairKey(a, b));
}

export function requestId(fromUid: string, toUid: string): string {
  return `${fromUid}__${toUid}`;
}

export function requestRef(fromUid: string, toUid: string) {
  return doc(db, 'friendRequests', requestId(fromUid, toUid));
}

/** Satisfied by the `array-contains` rule branch. */
export function watchFriendships(
  uid: string,
  onData: (uids: string[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      collection(db, 'friendships'),
      where('uids', 'array-contains', uid),
      orderBy('createdAt', 'desc'),
    ),
    (snap) =>
      onData(
        snap.docs.map((d) => {
          const f = d.data() as Friendship;
          return f.uids[0] === uid ? f.uids[1] : f.uids[0];
        }),
      ),
    onError,
  );
}

/** The `toUid` equality is what proves the first branch of the rules' disjunction. */
export function watchIncomingRequests(
  uid: string,
  onData: (reqs: FriendRequestWithId[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      collection(db, 'friendRequests'),
      where('toUid', '==', uid),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      qLimit(50),
    ),
    (snap) =>
      onData(snap.docs.map((d) => ({ ...(d.data() as FriendRequest), id: d.id }))),
    onError,
  );
}

export function watchOutgoingRequests(
  uid: string,
  onData: (reqs: FriendRequestWithId[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      collection(db, 'friendRequests'),
      where('fromUid', '==', uid),
      orderBy('createdAt', 'desc'),
      qLimit(50),
    ),
    (snap) =>
      onData(snap.docs.map((d) => ({ ...(d.data() as FriendRequest), id: d.id }))),
    onError,
  );
}

/**
 * Sends a request. The denormalised sender identity is what lets the recipient's inbox
 * render with no extra reads; the rules verify it against the sender's real profile, so
 * it cannot be used to impersonate someone else.
 */
export async function sendFriendRequest(
  me: PublicProfile,
  toUid: string,
  message: string | null = null,
): Promise<'sent' | 'auto-accepted'> {
  if (toUid === me.uid) throw new Error('You cannot add yourself.');

  // If they already asked us, accepting is the right move rather than creating a
  // second, crossing request that neither side can resolve cleanly.
  const reverse = await getDoc(requestRef(toUid, me.uid));
  if (reverse.exists() && (reverse.data() as { status: string }).status === 'pending') {
    await acceptFriendRequest(me.uid, toUid);
    return 'auto-accepted';
  }

  await setDoc(requestRef(me.uid, toUid), {
    fromUid: me.uid,
    toUid,
    status: 'pending',
    createdAt: serverTimestamp(),
    respondedAt: null,
    message,
    fromUsername: me.username,
    fromDisplayName: me.displayName,
    fromAvatarThumb: me.avatarThumb,
  });
  return 'sent';
}

/**
 * Accepts, as one atomic batch: create the friendship, consume the request.
 *
 * The friendship rule get()s the request and requires status 'pending'. Inside a batch
 * that read observes pre-batch state, so it still reads 'pending' even though this same
 * batch deletes it — which is what makes accept both atomic and unforgeable.
 */
export async function acceptFriendRequest(myUid: string, fromUid: string): Promise<void> {
  const uids = [myUid, fromUid].sort() as [string, string];
  const batch = writeBatch(db);
  batch.set(doc(db, 'friendships', pairKey(myUid, fromUid)), {
    uids,
    initiatorUid: fromUid,
    createdAt: serverTimestamp(),
  });
  batch.delete(requestRef(fromUid, myUid));
  // Render-only mirror. No security rule reads it, so a stale value cannot grant access.
  batch.update(userRef(myUid), { friendUidsCache: arrayUnion(fromUid) });
  await batch.commit();
}

/** Only the recipient may decline, and only pending -> declined. */
export async function declineFriendRequest(myUid: string, fromUid: string): Promise<void> {
  await updateDoc(requestRef(fromUid, myUid), {
    status: 'declined',
    respondedAt: serverTimestamp(),
  });
}

export async function cancelFriendRequest(myUid: string, toUid: string): Promise<void> {
  await deleteDoc(requestRef(myUid, toUid));
}

/** One delete revokes both directions, effective on the friend's very next read. */
export async function unfriend(myUid: string, otherUid: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(friendshipRef(myUid, otherUid));
  batch.update(userRef(myUid), { friendUidsCache: arrayRemove(otherUid) });
  await batch.commit();
}

export async function isFriend(myUid: string, otherUid: string): Promise<boolean> {
  const snap = await getDoc(friendshipRef(myUid, otherUid));
  return snap.exists();
}

export type RelationshipState =
  | 'self'
  | 'friends'
  | 'request-sent'
  | 'request-received'
  | 'declined'
  | 'none';

/** One-shot relationship probe, for the search results and profile header. */
export async function getRelationship(
  myUid: string,
  otherUid: string,
): Promise<RelationshipState> {
  if (myUid === otherUid) return 'self';
  const [friendship, outgoing, incoming] = await Promise.all([
    getDoc(friendshipRef(myUid, otherUid)),
    getDoc(requestRef(myUid, otherUid)),
    getDoc(requestRef(otherUid, myUid)),
  ]);
  if (friendship.exists()) return 'friends';
  if (incoming.exists() && (incoming.data() as { status: string }).status === 'pending') {
    return 'request-received';
  }
  if (outgoing.exists()) {
    const status = (outgoing.data() as { status: string }).status;
    return status === 'declined' ? 'declined' : 'request-sent';
  }
  return 'none';
}

export async function blockUser(myUid: string, otherUid: string): Promise<void> {
  await setDoc(doc(db, 'users', myUid, 'blocked', otherUid), {
    createdAt: serverTimestamp(),
  });
}

export async function unblockUser(myUid: string, otherUid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', myUid, 'blocked', otherUid));
}

export async function listBlocked(myUid: string): Promise<string[]> {
  const snap = await getDocs(collection(db, 'users', myUid, 'blocked'));
  return snap.docs.map((d) => d.id);
}
