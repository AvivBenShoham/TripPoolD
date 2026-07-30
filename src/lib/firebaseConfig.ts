/**
 * Firebase web config.
 *
 * The apiKey here is NOT a secret. It identifies the project to Google's APIs and is
 * visible in the JS bundle of every Firebase web app that has ever shipped. All actual
 * protection comes from firestore.rules. If you later want to restrict which origins may
 * use this key, that is what Firebase App Check is for — see README.
 *
 * Values can be overridden per-environment with VITE_FIREBASE_* variables.
 */
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyAb2Sy40MZKpeIdZd4X_yDKnvA3tGvtLUY',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'poold-d8f26.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'poold-d8f26',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'poold-d8f26.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '147205101939',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:147205101939:web:950bb17c60d0bb67fa8d06',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/**
 * Whether to talk to the local Firebase Emulator Suite.
 *
 * Keyed off the hostname rather than a build-time flag, deliberately: served from
 * localhost means development, so `npm run dev` and `npm run e2e` just work, and a
 * deployed build on a real domain always uses the real project. This also avoids
 * depending on env-var plumbing, which is one more thing that can silently be wrong and
 * send test traffic at production.
 *
 * Escape hatch, for checking the real backend from a local build: append `?prod=1` to the
 * URL, or set `localStorage['poold:useProd'] = '1'`.
 */
function resolveUseEmulators(): boolean {
  if (typeof window === 'undefined') return false;
  if (!LOCAL_HOSTS.has(window.location.hostname)) return false;
  try {
    if (new URLSearchParams(window.location.search).has('prod')) return false;
    if (window.localStorage.getItem('poold:useProd') === '1') return false;
  } catch {
    // Private browsing can throw on localStorage access; the hostname check stands.
  }
  return true;
}

export const useEmulators = resolveUseEmulators();
