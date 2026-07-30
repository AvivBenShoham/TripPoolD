import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as qLimit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { deleteUser, reauthenticateWithPopup, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { auth, db, LIMITS } from '../lib/firebase';
import { profileRef, userRef, usernameRef } from './profiles';
import type { EncounterWithId, PublicProfile } from '../types';

/**
 * Exports everything the account holds as JSON. Includes full-size photos, so it can be
 * large — this is a deliberate "take your data with you" escape hatch, not a backup
 * format.
 */
export async function exportAccountJson(
  uid: string,
  profile: PublicProfile | null,
  entries: EncounterWithId[],
): Promise<string> {
  const withPhotos = await Promise.all(
    entries.map(async (e) => {
      if (!e.hasFullPhoto) return { ...e, fullPhoto: null };
      try {
        const snap = await getDocs(
          query(collection(db, 'users', uid, 'encounters', e.id, 'media'), qLimit(1)),
        );
        const media = snap.docs[0]?.data() as { dataUrl?: string } | undefined;
        return { ...e, fullPhoto: media?.dataUrl ?? null };
      } catch {
        return { ...e, fullPhoto: null };
      }
    }),
  );

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      app: 'PoolD',
      profile,
      entries: withPhotos,
    },
    null,
    2,
  );
}

export function downloadJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type DeletionStage =
  | 'reauth'
  | 'hiding'
  | 'friendships'
  | 'requests'
  | 'entries'
  | 'aggregates'
  | 'identity'
  | 'auth'
  | 'done';

/**
 * Deletes the account, in an order that matters.
 *
 * Auth deletion must come LAST: once the auth user is gone, no rule can ever match
 * isSelf() again, so anything left behind becomes permanently unreachable and
 * unremovable. Each stage is recorded so an interrupted purge resumes rather than
 * stranding data.
 */
export async function deleteAccount(
  uid: string,
  opts: { password?: string; onStage?: (stage: DeletionStage) => void },
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('You are not signed in.');
  const stage = opts.onStage ?? (() => undefined);

  // Firebase requires a recent login before deleting a user.
  stage('reauth');
  try {
    if (opts.password && user.email) {
      await reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(user.email, opts.password),
      );
    } else {
      const provider = user.providerData[0]?.providerId;
      if (provider === 'google.com') {
        const { GoogleAuthProvider } = await import('firebase/auth');
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      }
    }
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      throw new Error('That password is not right.');
    }
    throw err;
  }

  // Hide from search first, before any slow work begins.
  stage('hiding');
  await updateDoc(userRef(uid), {
    deletion: { requested: true, requestedAt: serverTimestamp(), stage: 'started' },
  });
  await setDoc(profileRef(uid), { deleted: true, updatedAt: serverTimestamp() }, { merge: true });

  stage('friendships');
  const friendships = await getDocs(
    query(collection(db, 'friendships'), where('uids', 'array-contains', uid)),
  );
  for (const d of friendships.docs) await deleteDoc(d.ref);

  stage('requests');
  for (const field of ['fromUid', 'toUid'] as const) {
    const reqs = await getDocs(query(collection(db, 'friendRequests'), where(field, '==', uid)));
    for (const d of reqs.docs) await deleteDoc(d.ref);
  }

  stage('entries');
  // Paged, because a batch holds at most 500 operations and each entry may cost two.
  for (;;) {
    const page = await getDocs(query(collection(db, 'users', uid, 'encounters'), qLimit(120)));
    if (page.empty) break;
    const batch = writeBatch(db);
    let ops = 0;
    for (const d of page.docs) {
      const media = await getDocs(collection(db, 'users', uid, 'encounters', d.id, 'media'));
      for (const m of media.docs) {
        batch.delete(m.ref);
        ops += 1;
      }
      batch.delete(d.ref);
      ops += 1;
      if (ops >= LIMITS.batchOps - 10) break;
    }
    await batch.commit();
  }

  stage('aggregates');
  await deleteDoc(doc(db, 'users', uid, 'aggregates', 'private')).catch(() => undefined);
  await deleteDoc(doc(db, 'users', uid, 'aggregates', 'public')).catch(() => undefined);

  stage('identity');
  const prof = await getDocs(
    query(collection(db, 'publicProfiles'), where('uid', '==', uid), qLimit(1)),
  );
  const handle = (prof.docs[0]?.data() as PublicProfile | undefined)?.usernameLower;
  // Profile before username: the /usernames delete rule requires the profile to no
  // longer claim the handle, which is what forces this order.
  await deleteDoc(profileRef(uid));
  if (handle) await deleteDoc(usernameRef(handle)).catch(() => undefined);
  await deleteDoc(userRef(uid)).catch(() => undefined);

  stage('auth');
  await deleteUser(user);
  stage('done');
}
