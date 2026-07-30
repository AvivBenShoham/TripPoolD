import { useEffect, useState } from 'react';
import { useAuth } from '../state/AuthProvider';
import {
  HandleError,
  checkHandle,
  claimHandleAndCreateProfile,
  type HandleAvailability,
} from '../services/profiles';
import { Banner, Button, Field, inputClass } from '../components/ui';
import { slugifyHandle } from '../lib/format';
import { avatarThumbFromUrl } from '../lib/image';
import { CountryPicker } from '../components/CountryPicker';
import { countryFlag, countryName } from '../lib/geo/countries';

const HINTS: Record<HandleAvailability, string> = {
  available: 'Available.',
  taken: 'That username is taken.',
  reserved: 'That username was recently released and is reserved for a few more days.',
  mine: 'That is already yours.',
  invalid: '3–20 characters: lowercase letters, numbers and underscores.',
};

export function OnboardingScreen() {
  const { user, refreshProfile, signOut } = useAuth();
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [homeCountry, setHomeCountry] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [availability, setAvailability] = useState<HandleAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from a Google profile, but never auto-claim: the handle is public and
  // stays reserved for 30 days after release, so the user must confirm it.
  useEffect(() => {
    if (!user) return;
    const name = user.displayName ?? '';
    if (name) {
      setDisplayName(name);
      setHandle(slugifyHandle(name));
    } else if (user.email) {
      setHandle(slugifyHandle(user.email.split('@')[0]));
    }
  }, [user]);

  useEffect(() => {
    if (!handle) {
      setAvailability(null);
      return;
    }
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        setAvailability(await checkHandle(handle, user?.uid ?? null));
      } catch {
        setAvailability(null);
      } finally {
        setChecking(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [handle, user?.uid]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setBusy(true);
    try {
      // Best-effort: a Google photo may be CORS-blocked, in which case we store the
      // URL itself and render it directly instead.
      let avatarThumb: string | null = null;
      if (user.photoURL) avatarThumb = await avatarThumbFromUrl(user.photoURL);

      await claimHandleAndCreateProfile({
        uid: user.uid,
        email: user.email ?? '',
        handle,
        displayName: displayName.trim() || handle,
        avatarThumb,
        avatarUrl: avatarThumb ? null : (user.photoURL ?? null),
        authProviders: user.providerData.map((p) => p.providerId),
        homeCountry,
      });
      await refreshProfile();
    } catch (err) {
      if (err instanceof HandleError) setError(HINTS[err.reason]);
      else setError((err as Error).message || 'Could not finish setting up your profile.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit =
    !busy &&
    !checking &&
    !!displayName.trim() &&
    (availability === 'available' || availability === 'mine');

  return (
    <div className="scroll-y pt-safe flex h-full flex-col px-6 pb-8">
      <h1 className="mt-6 text-2xl font-bold">Pick your username</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        This is how friends find you. Everything else stays private until you accept
        someone as a friend.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Username"
          hint={
            checking
              ? 'Checking…'
              : availability
                ? HINTS[availability]
                : '3–20 characters: lowercase letters, numbers and underscores.'
          }
        >
          <div className="flex items-center gap-2">
            <span className="text-muted">@</span>
            <input
              className={inputClass}
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={20}
              placeholder="yourname"
              required
            />
          </div>
        </Field>

        <Field label="Display name">
          <input
            className={inputClass}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            placeholder="Your name"
            required
          />
        </Field>

        <Field label="Home country" hint="Optional. Used for your travel stats." as="div">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className={`${inputClass} flex items-center gap-2 text-left`}
          >
            {homeCountry ? (
              <>
                <span>{countryFlag(homeCountry)}</span>
                <span>{countryName(homeCountry)}</span>
              </>
            ) : (
              <span className="text-muted">Choose a country</span>
            )}
          </button>
        </Field>

        {error && <Banner tone="error">{error}</Banner>}

        <Button type="submit" disabled={!canSubmit}>
          {busy ? 'Setting up…' : 'Start mapping'}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => void signOut()}
        className="mt-6 text-sm text-muted underline decoration-line underline-offset-4"
      >
        Sign out
      </button>

      <CountryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(code) => {
          setHomeCountry(code);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
