import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  fetchSignInMethodsForEmail,
  linkWithCredential,
  EmailAuthProvider,
  type User,
} from 'firebase/auth';
import { auth, googleProvider, popupResolver } from '../lib/firebase';
import { getProfile } from '../services/profiles';
import type { PublicProfile } from '../types';

interface AuthState {
  user: User | null;
  profile: PublicProfile | null;
  /** True until both the auth state and the profile lookup have resolved. */
  loading: boolean;
  /** Authenticated but no profile document yet — onboarding must run. */
  needsOnboarding: boolean;
  /** Auth itself is unavailable (most often: not enabled on the Firebase project). */
  authError: string | null;
  /** The profile lookup failed, which is different from there being no profile. */
  profileError: string | null;
  retryProfile: () => void;
  refreshProfile: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Turns Firebase's error codes into something a person can act on. */
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address does not look right.';
    case 'auth/missing-password':
      return 'Enter a password.';
    case 'auth/weak-password':
      return 'Use at least 6 characters for the password.';
    case 'auth/email-already-in-use':
      return 'An account already exists for that email. Try signing in instead.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Wrong email or password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.';
    case 'auth/network-request-failed':
      return 'You appear to be offline.';
    case 'auth/configuration-not-found':
    case 'auth/operation-not-allowed':
      // Not a user error — this project's Auth has not been provisioned yet, which is a
      // console step. Say so rather than showing a raw error code.
      return 'Sign-in is not enabled on this Firebase project yet. In the Firebase console, open Authentication → Sign-in method and enable Email/Password and Google.';
    default:
      return (err as Error)?.message || 'Something went wrong signing in.';
  }
}

/**
 * What was resolved, and for whom.
 *
 * Keying the result to a uid is the point: a plain `ready` boolean alongside a `user`
 * that can stay referentially null is exactly how you end up with a spinner that never
 * clears, because nothing re-triggers the lookup that would flip the flag back.
 */
interface Resolved {
  uid: string | null;
  profile: PublicProfile | null;
  failed: boolean;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // `undefined` means "auth has not reported yet", distinct from "signed out".
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // A redirect sign-in resumes here. Popups are blocked inside in-app browsers
  // (Instagram, TikTok webviews), so signInGoogle falls back to redirect.
  useEffect(() => {
    getRedirectResult(auth).catch(() => undefined);
  }, []);

  useEffect(() => {
    return onAuthStateChanged(
      auth,
      (u) => {
        setAuthError(null);
        setUser(u);
      },
      (err) => {
        // Auth is unreachable or unconfigured. Surface it instead of spinning.
        setAuthError(authErrorMessage(err));
        setUser(null);
      },
    );
  }, []);

  const uid = user === undefined ? undefined : (user?.uid ?? null);

  useEffect(() => {
    if (uid === undefined) return;
    if (uid === null) {
      setResolved({ uid: null, profile: null, failed: false });
      return;
    }
    let cancelled = false;
    // Deliberately a profile lookup rather than getAdditionalUserInfo().isNewUser: a user
    // whose earlier signup transaction failed is not "new", but still has no profile, and
    // both paths must land in onboarding.
    getProfile(uid)
      .then((p) => {
        if (!cancelled) setResolved({ uid, profile: p, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResolved({ uid, profile: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [uid, retryCount]);

  const settled = resolved !== null && resolved.uid === uid;
  const loading = uid === undefined || !settled;
  const profile = settled ? resolved.profile : null;
  const profileFailed = settled ? resolved.failed : false;

  const value = useMemo<AuthState>(
    () => ({
      user: user ?? null,
      profile,
      loading,
      // A failed lookup must not be mistaken for "no profile", or a transient network
      // error would drop an existing user into onboarding and offer them a new username.
      needsOnboarding: !!user && !loading && !profile && !profileFailed,
      authError,
      profileError: profileFailed
        ? 'Could not load your profile. Check your connection and try again.'
        : null,
      retryProfile: () => setRetryCount((n) => n + 1),
      refreshProfile: async () => {
        if (!user) return;
        const p = await getProfile(user.uid);
        setResolved({ uid: user.uid, profile: p, failed: false });
      },
      signInEmail: async (email, password) => {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      signUpEmail: async (email, password) => {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      },
      signInGoogle: async () => {
        try {
          await signInWithPopup(auth, googleProvider, popupResolver);
        } catch (err) {
          const code = (err as { code?: string })?.code ?? '';
          if (
            code === 'auth/popup-blocked' ||
            code === 'auth/operation-not-supported-in-this-environment'
          ) {
            await signInWithRedirect(auth, googleProvider);
            return;
          }
          if (code === 'auth/account-exists-with-different-credential') {
            // Without this branch, a user with both a password account and a Google
            // account on one email simply cannot get back in.
            const email = (err as { customData?: { email?: string } }).customData?.email;
            const methods = email ? await fetchSignInMethodsForEmail(auth, email) : [];
            throw new Error(
              methods.includes('password')
                ? 'You already have a password account for that email. Sign in with your password first, then link Google from Settings.'
                : 'An account already exists for that email with a different sign-in method.',
            );
          }
          throw err;
        }
      },
      signOut: async () => {
        await fbSignOut(auth);
      },
    }),
    [user, profile, loading, profileFailed, authError],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Links a password credential onto the signed-in account (Settings → link Google). */
export async function linkPassword(email: string, password: string): Promise<void> {
  if (!auth.currentUser) throw new Error('Not signed in.');
  await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password));
}
