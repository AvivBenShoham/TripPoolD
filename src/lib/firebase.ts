import { initializeApp } from 'firebase/app';
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  browserPopupRedirectResolver,
} from 'firebase/auth';
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from 'firebase/firestore';
import { firebaseConfig, useEmulators } from './firebaseConfig';

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const popupResolver = browserPopupRedirectResolver;

/**
 * Persistent cache means the map and log render instantly on a cold start and writes
 * queue while offline. It is deliberately NOT used against the emulator: a stale
 * IndexedDB from a previous test run is a confusing source of phantom data.
 *
 * `useEmulators` is decided by hostname (see firebaseConfig.ts), so a localhost dev server
 * or e2e run never reaches the real project.
 *
 * Two consequences the app has to handle, both in src/services:
 *   - Rules are not evaluated locally, so an invalid offline write is accepted into
 *     the cache, renders optimistically, and is reverted when it reaches the server.
 *     Every write therefore also runs a client-side validator.
 *   - `await setDoc(...)` never resolves while offline, so no UI transition may block
 *     on a commit promise.
 */
export const db = initializeFirestore(app, {
  localCache: useEmulators
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/** Firestore hard limits the app has to design around, referenced from the services. */
export const LIMITS = {
  /** Max operations in one writeBatch, and at most one op per document per batch. */
  batchOps: 500,
  /** Practical ceiling for a base64 payload in a single document (1 MiB doc cap). */
  fullPhotoChars: 700_000,
  thumbChars: 48_000,
  avatarChars: 24_000,
} as const;
