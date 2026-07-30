import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useData } from '../state/DataProvider';
import {
  Avatar,
  Banner,
  Button,
  Card,
  Chevron,
  Field,
  Screen,
  Sheet,
  inputClass,
} from '../components/ui';
import { CountryPicker } from '../components/CountryPicker';
import { updateProfileFields, updateSettings } from '../services/profiles';
import { publicAggRef } from '../services/encounters';
import { republishForMode } from '../lib/aggregates/delta';
import { deleteAccount, downloadJson, exportAccountJson } from '../services/account';
import { countryFlag, countryName } from '../lib/geo/countries';
import type { CoverageMode, Visibility } from '../types';
import { setDoc } from 'firebase/firestore';

const MODE_LABELS: Record<CoverageMode, { title: string; body: string }> = {
  hidden: {
    title: 'Hidden',
    body: 'Friends see only which countries you have visited, never how many people. Your travel map stays truthful, so nothing is inferable from the gap.',
  },
  sharedOnly: {
    title: 'Shared entries only',
    body: 'Counts come from entries you have marked visible to friends. Friends could work these out from those entries anyway, so this publishes nothing new.',
  },
  all: {
    title: 'All entries',
    body: 'Counts include private entries. Friends see how many and where, never who or what.',
  },
};

export function SettingsScreen() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile, signOut } = useAuth();
  const { settings, priv, pub, entries } = useData();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [countryOpen, setCountryOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteStage, setDeleteStage] = useState<string | null>(null);

  const saveName = async () => {
    if (!user || !profile) return;
    setBusy('name');
    setError(null);
    try {
      await updateProfileFields(user.uid, profile, { displayName });
      await refreshProfile();
      setMessage('Display name updated.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setVisibilityDefault = async (v: Visibility) => {
    if (!user) return;
    setBusy('visibility');
    try {
      await updateSettings(user.uid, { ...settings, defaultVisibility: v });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  /**
   * Changing the coverage mode republishes the whole encounter layer from the private
   * aggregate, so it is a local rewrite with no entry reads. Both private count maps
   * are kept precisely so this stays cheap.
   */
  const setMode = async (mode: CoverageMode) => {
    if (!user) return;
    setBusy('mode');
    setError(null);
    try {
      await updateSettings(user.uid, { ...settings, encounterCoverageMode: mode });
      await setDoc(
        publicAggRef(user.uid),
        republishForMode(priv, mode, Object.keys(pub.visitedManual)),
        { merge: true },
      );
      setMessage('Updated what friends can see.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setHome = async (code: string) => {
    if (!user) return;
    setCountryOpen(false);
    setBusy('home');
    try {
      await updateSettings(user.uid, { ...settings, homeCountry: code });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const exportData = async () => {
    if (!user) return;
    setBusy('export');
    setError(null);
    try {
      const json = await exportAccountJson(user.uid, profile, entries);
      downloadJson(`poold-export-${new Date().toISOString().slice(0, 10)}.json`, json);
      setMessage('Export downloaded.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    if (!user) return;
    setBusy('delete');
    setError(null);
    try {
      await deleteAccount(user.uid, {
        password: deletePassword || undefined,
        onStage: (s) => setDeleteStage(s),
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
      setDeleteStage(null);
    }
  };

  return (
    <Screen title="Settings" back={() => navigate(-1)}>
      <div className="flex flex-col gap-4 px-4 py-4">
        {message && <Banner tone="success">{message}</Banner>}
        {error && <Banner tone="error">{error}</Banner>}

        <Card className="flex items-center gap-3 px-3 py-3">
          <Avatar
            name={profile?.displayName ?? '?'}
            thumb={profile?.avatarThumb}
            url={profile?.avatarUrl}
            size={48}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{profile?.displayName}</p>
            <p className="truncate text-xs text-muted">@{profile?.username}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
          </div>
        </Card>

        <Field label="Display name">
          <div className="flex gap-2">
            <input
              className={inputClass}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={40}
            />
            <Button
              onClick={() => void saveName()}
              disabled={busy === 'name' || !displayName.trim() || displayName === profile?.displayName}
              className="px-4"
              ariaLabel="Save display name"
            >
              Save
            </Button>
          </div>
        </Field>

        <Field label="Home country" as="div">
          <button
            type="button"
            onClick={() => setCountryOpen(true)}
            className={`${inputClass} flex items-center gap-2 text-left`}
            disabled={busy === 'home'}
          >
            {settings.homeCountry ? (
              <>
                <span>{countryFlag(settings.homeCountry)}</span>
                <span className="flex-1">{countryName(settings.homeCountry)}</span>
              </>
            ) : (
              <span className="flex-1 text-muted">Not set</span>
            )}
            <Chevron />
          </button>
        </Field>

        <Field label="New entries default to" as="div">
          <div className="flex gap-1 rounded-xl bg-ink-3 p-1 ring-1 ring-line">
            {(['private', 'friends'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => void setVisibilityDefault(v)}
                disabled={busy === 'visibility'}
                className={`flex-1 rounded-lg py-2 text-sm font-medium ${
                  settings.defaultVisibility === v ? 'bg-accent text-white' : 'text-muted'
                }`}
              >
                {v === 'private' ? '🔒 Private' : '👥 Friends'}
              </button>
            ))}
          </div>
        </Field>

        <div>
          <p className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">
            What friends see in your counts
          </p>
          <div className="flex flex-col gap-2">
            {(['hidden', 'sharedOnly', 'all'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => void setMode(m)}
                disabled={busy === 'mode'}
                className={`rounded-2xl px-3 py-3 text-left ring-1 transition-colors ${
                  settings.encounterCoverageMode === m
                    ? 'bg-accent/15 ring-accent'
                    : 'bg-ink-2 ring-line'
                }`}
              >
                <span className="flex items-center gap-2 font-medium">
                  {settings.encounterCoverageMode === m && <span className="text-accent">✓</span>}
                  {MODE_LABELS[m].title}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{MODE_LABELS[m].body}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            Which countries you have visited is always visible to friends.
          </p>
        </div>

        <Card
          onClick={() => navigate('/countries')}
          className="flex items-center gap-3 px-3 py-3"
        >
          <span className="text-xl">🗺️</span>
          <span className="min-w-0 flex-1 font-medium">Countries visited</span>
          <span className="text-muted">›</span>
        </Card>

        <Button variant="ghost" onClick={() => void exportData()} disabled={busy === 'export'}>
          {busy === 'export' ? 'Preparing…' : 'Export my data as JSON'}
        </Button>

        <Button variant="ghost" onClick={() => void signOut()}>
          Sign out
        </Button>

        <Button variant="danger" onClick={() => setDeleteOpen(true)}>
          Delete my account
        </Button>

        <p className="text-center text-xs text-muted">
          PoolD · your data lives in your own Firebase project
        </p>
        <div className="h-4" />
      </div>

      <CountryPicker
        open={countryOpen}
        onClose={() => setCountryOpen(false)}
        onPick={(code) => void setHome(code)}
        selected={settings.homeCountry}
        title="Home country"
      />

      <Sheet open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete account">
        <div className="flex flex-col gap-3">
          <Banner tone="error">
            This permanently deletes every entry, photo, your coverage map, friendships and
            your username. It cannot be undone.
          </Banner>

          {user?.providerData.some((p) => p.providerId === 'password') && (
            <Field label="Confirm your password">
              <input
                type="password"
                className={inputClass}
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
          )}

          <Field label="Type DELETE to confirm">
            <input
              className={inputClass}
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              autoCapitalize="characters"
            />
          </Field>

          {deleteStage && <p className="text-sm text-muted">Deleting: {deleteStage}…</p>}

          <Button
            variant="danger"
            onClick={() => void doDelete()}
            disabled={deleteConfirm !== 'DELETE' || busy === 'delete'}
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete everything'}
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}
