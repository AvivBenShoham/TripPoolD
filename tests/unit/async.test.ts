import { describe, expect, it } from 'vitest';
import { TimeoutError, backendErrorMessage, withTimeout } from '../../src/lib/async';

describe('withTimeout', () => {
  it('passes through a value that arrives in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 500)).resolves.toBe('ok');
  });

  it('passes through a rejection unchanged', async () => {
    const err = Object.assign(new Error('denied'), { code: 'permission-denied' });
    await expect(withTimeout(Promise.reject(err), 500)).rejects.toBe(err);
  });

  /**
   * The case this exists for: Firestore retries an unreachable backend forever instead of
   * rejecting, so a promise that never settles must not be able to hold the UI hostage.
   */
  it('rejects when the promise never settles', async () => {
    const never = new Promise<never>(() => {});
    await expect(withTimeout(never, 20)).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('backendErrorMessage', () => {
  it('explains a timeout as an unprovisioned database', () => {
    const msg = backendErrorMessage(new TimeoutError(12_000));
    expect(msg).toContain('Cloud Firestore');
    expect(msg).toContain('Firebase console');
  });

  it('distinguishes a refusal from a non-answer', () => {
    const denied = backendErrorMessage({ code: 'permission-denied' });
    expect(denied).toContain('security rules');
    expect(denied).not.toContain('did not respond');
  });

  it('handles the offline and not-ready cases', () => {
    expect(backendErrorMessage({ code: 'unavailable' })).toContain('Cannot reach');
    expect(backendErrorMessage({ code: 'failed-precondition' })).toContain('not ready');
  });

  it('falls back to the underlying message', () => {
    expect(backendErrorMessage(new Error('something odd'))).toBe('something odd');
  });
});
