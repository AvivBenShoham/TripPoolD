/**
 * Bounded waits for Firestore calls.
 *
 * Firestore treats an unreachable backend as a retryable condition and keeps trying
 * indefinitely rather than rejecting — so a project whose Firestore database has not been
 * created, or a network that silently blackholes the connection, makes `getDoc()` hang
 * forever instead of failing. Any UI that gates rendering on such a promise then sits on a
 * spinner with nothing to tell the user.
 *
 * Every read that a screen blocks on should therefore be bounded.
 */

export class TimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`Timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/** Default budget: generous enough for a cold start on a slow phone connection. */
export const READ_TIMEOUT_MS = 12_000;

export function withTimeout<T>(promise: Promise<T>, ms = READ_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Turns a failed Firestore read into something a person can act on.
 *
 * The two cases worth separating are "the backend never answered" (almost always an
 * unprovisioned or unreachable project) and "the backend said no" (rules), because the
 * fixes are completely different.
 */
export function backendErrorMessage(err: unknown): string {
  if (err instanceof TimeoutError) {
    return 'The database did not respond. If this project was just set up, check that Cloud Firestore has been created in the Firebase console — the app cannot load anything until it exists.';
  }
  const code = (err as { code?: string })?.code ?? '';
  if (code === 'permission-denied') {
    return 'The database refused that read. The security rules may not have been deployed yet (npx firebase deploy --only firestore:rules).';
  }
  if (code === 'unavailable') {
    return 'Cannot reach the database. Check your connection and try again.';
  }
  if (code === 'failed-precondition') {
    return 'The database is not ready. If Cloud Firestore was just enabled, give it a minute and retry.';
  }
  return (err as Error)?.message || 'Could not reach the database.';
}
