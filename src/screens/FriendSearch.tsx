import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { Avatar, Banner, Button, Card, EmptyState, Screen, inputClass } from '../components/ui';
import { searchProfiles } from '../services/profiles';
import { getRelationship, sendFriendRequest, type RelationshipState } from '../services/friends';
import type { PublicProfile } from '../types';

export function FriendSearchScreen() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [states, setStates] = useState<Record<string, RelationshipState>>({});
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const found = await searchProfiles(q, user.uid);
        setResults(found);
        setSearched(true);
        setError(null);
        const pairs = await Promise.all(
          found.map(async (p) => [p.uid, await getRelationship(user.uid, p.uid)] as const),
        );
        setStates(Object.fromEntries(pairs));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSearching(false);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [q, user]);

  const send = async (uid: string) => {
    if (!profile) return;
    setBusyUid(uid);
    setError(null);
    try {
      const outcome = await sendFriendRequest(profile, uid);
      setStates((s) => ({ ...s, [uid]: outcome === 'auto-accepted' ? 'friends' : 'request-sent' }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyUid(null);
    }
  };

  const labelFor = (state: RelationshipState | undefined) => {
    switch (state) {
      case 'friends':
        return 'Friends';
      case 'request-sent':
        return 'Requested';
      case 'request-received':
        return 'Wants to add you';
      case 'declined':
        return 'Declined';
      default:
        return null;
    }
  };

  return (
    <Screen title="Find friends" back={() => navigate(-1)}>
      <div className="flex flex-col gap-3 px-4 py-4">
        <input
          className={inputClass}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Username or display name"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search for people"
        />
        <p className="text-xs text-muted">
          Matches the start of a username or display name. Your own map and log stay hidden
          until you accept someone.
        </p>

        {error && <Banner tone="error">{error}</Banner>}

        {searching && <p className="text-sm text-muted">Searching…</p>}

        {!searching && searched && !results.length && (
          <EmptyState icon="🔍" title="Nobody found" body="Check the spelling of the username." />
        )}

        <ul className="flex flex-col gap-2">
          {results.map((p) => {
            const state = states[p.uid];
            const label = labelFor(state);
            return (
              <li key={p.uid}>
                <Card className="flex items-center gap-3 px-3 py-3">
                  <button
                    type="button"
                    onClick={() => state === 'friends' && navigate(`/u/${p.uid}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <Avatar name={p.displayName} thumb={p.avatarThumb} url={p.avatarUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.displayName}</span>
                      <span className="block truncate text-xs text-muted">@{p.username}</span>
                    </span>
                  </button>
                  {label ? (
                    <span className="shrink-0 rounded-full bg-ink-3 px-2.5 py-1 text-xs text-muted">
                      {label}
                    </span>
                  ) : (
                    <Button
                      onClick={() => void send(p.uid)}
                      disabled={busyUid === p.uid}
                      className="shrink-0 px-3 text-sm"
                    >
                      {busyUid === p.uid ? '…' : 'Add'}
                    </Button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </div>
    </Screen>
  );
}
