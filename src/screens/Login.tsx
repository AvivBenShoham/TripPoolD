import { useState } from 'react';
import { authErrorMessage, useAuth } from '../state/AuthProvider';
import { Banner, Button, Field, inputClass } from '../components/ui';

export function LoginScreen() {
  const { signInEmail, signUpEmail, signInGoogle } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signup') await signUpEmail(email, password);
      else await signInEmail(email, password);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInGoogle();
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scroll-y pt-safe flex h-full flex-col justify-center px-6 pb-8">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-3xl shadow-lg shadow-accent/25">
          🌍
        </div>
        <h1 className="text-3xl font-bold tracking-tight">PoolD</h1>
        <p className="mt-1 text-sm text-muted">Your map. Your log. Your countries.</p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Email">
          <input
            className={inputClass}
            type="email"
            inputMode="email"
            autoComplete="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </Field>
        <Field
          label="Password"
          hint={mode === 'signup' ? 'At least 6 characters.' : undefined}
        >
          <input
            className={inputClass}
            type="password"
            name="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </Field>

        {error && <Banner tone="error">{error}</Banner>}

        <Button type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <div className="my-4 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button variant="ghost" onClick={google} disabled={busy}>
        <span aria-hidden>🇬</span> Continue with Google
      </Button>

      <button
        type="button"
        className="mt-6 text-sm text-muted underline decoration-line underline-offset-4"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError(null);
        }}
      >
        {mode === 'signin' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
      </button>
    </div>
  );
}
