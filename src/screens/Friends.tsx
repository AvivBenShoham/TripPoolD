import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useData } from '../state/DataProvider';
import { Avatar, Banner, Button, Card, EmptyState, Screen, Spinner } from '../components/ui';
import { getProfiles } from '../services/profiles';
import { acceptFriendRequest, cancelFriendRequest, declineFriendRequest } from '../services/friends';
import { getFriendPublicAggregates, getFriendRecent } from '../services/encounters';
import { buildCoverage } from '../lib/geo/coverage';
import type { EncounterWithId, PublicProfile } from '../types';
import { countryFlag, countryName } from '../lib/geo/countries';
import { relativeTime } from '../lib/format';

interface FriendSummary {
  profile: PublicProfile;
  visitedCount: number;
  entryCountries: number;
  total: number;
}

interface FeedItem {
  uid: string;
  profile: PublicProfile;
  entry: EncounterWithId;
}

export function FriendsScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { friendUids, incoming, outgoing } = useData();

  const [profiles, setProfiles] = useState<Map<string, PublicProfile>>(new Map());
  const [summaries, setSummaries] = useState<FriendSummary[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const uids = [...new Set([...friendUids, ...incoming.map((r) => r.fromUid), ...outgoing.map((r) => r.toUid)])];
      const profs = await getProfiles(uids);
      setProfiles(profs);

      /**
       * The feed is derived, not stored. Every item comes back through a query the
       * rules already authorise, so there is no forgery surface and unfriending takes
       * effect immediately — no fan-out writes and no stale copies to clean up.
       * Capped, because each entry carries its ~20 KB thumbnail and Firestore has no
       * field projection.
       */
      const capped = friendUids.slice(0, 12);
      const results = await Promise.all(
        capped.map(async (uid) => {
          try {
            const [agg, recent] = await Promise.all([
              getFriendPublicAggregates(uid),
              getFriendRecent(uid, 3),
            ]);
            return { uid, agg, recent };
          } catch {
            // A friendship revoked mid-load: skip rather than failing the whole screen.
            return { uid, agg: null, recent: [] as EncounterWithId[] };
          }
        }),
      );

      const sums: FriendSummary[] = [];
      const items: FeedItem[] = [];
      for (const r of results) {
        const profile = profs.get(r.uid);
        if (!profile) continue;
        if (r.agg) {
          const cov = buildCoverage(r.agg, null);
          sums.push({
            profile,
            visitedCount: cov.visitedCount,
            entryCountries: cov.entryCountryCount,
            total: cov.totalEntries,
          });
        } else {
          sums.push({ profile, visitedCount: 0, entryCountries: 0, total: 0 });
        }
        for (const e of r.recent) items.push({ uid: r.uid, profile, entry: e });
      }

      sums.sort((a, b) => b.visitedCount - a.visitedCount || b.total - a.total);
      items.sort((a, b) => (b.entry.createdAt?.toMillis?.() ?? 0) - (a.entry.createdAt?.toMillis?.() ?? 0));
      setSummaries(sums);
      setFeed(items.slice(0, 20));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user, friendUids, incoming, outgoing]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (fromUid: string) => {
    if (!user) return;
    setBusyUid(fromUid);
    try {
      await acceptFriendRequest(user.uid, fromUid);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyUid(null);
    }
  };

  const decline = async (fromUid: string) => {
    if (!user) return;
    setBusyUid(fromUid);
    try {
      await declineFriendRequest(user.uid, fromUid);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyUid(null);
    }
  };

  const cancel = async (toUid: string) => {
    if (!user) return;
    setBusyUid(toUid);
    try {
      await cancelFriendRequest(user.uid, toUid);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <Screen
      title="Friends"
      right={
        <Button onClick={() => navigate('/friends/search')} className="px-3 text-sm">
          Find
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        {error && <Banner tone="error">{error}</Banner>}

        {!!incoming.length && (
          <section>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
              Requests ({incoming.length})
            </h2>
            <ul className="flex flex-col gap-2">
              {incoming.map((r) => (
                <li key={r.id}>
                  <Card className="flex items-center gap-3 px-3 py-3">
                    <Avatar name={r.fromDisplayName} thumb={r.fromAvatarThumb} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.fromDisplayName}</p>
                      <p className="truncate text-xs text-muted">@{r.fromUsername}</p>
                      {r.message && <p className="mt-1 truncate text-xs">{r.message}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        onClick={() => void accept(r.fromUid)}
                        disabled={busyUid === r.fromUid}
                        className="px-3 text-sm"
                      >
                        Accept
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void decline(r.fromUid)}
                        disabled={busyUid === r.fromUid}
                        className="px-3 text-sm"
                      >
                        ✕
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!!outgoing.filter((r) => r.status === 'pending').length && (
          <section>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Sent</h2>
            <ul className="flex flex-col gap-2">
              {outgoing
                .filter((r) => r.status === 'pending')
                .map((r) => {
                  const p = profiles.get(r.toUid);
                  return (
                    <li key={r.id}>
                      <Card className="flex items-center gap-3 px-3 py-2.5">
                        <Avatar name={p?.displayName ?? '?'} thumb={p?.avatarThumb} url={p?.avatarUrl} size={32} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{p?.displayName ?? 'Pending'}</p>
                          <p className="truncate text-xs text-muted">
                            {p ? `@${p.username}` : ''} · waiting
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          onClick={() => void cancel(r.toUid)}
                          disabled={busyUid === r.toUid}
                          className="px-3 text-sm"
                        >
                          Cancel
                        </Button>
                      </Card>
                    </li>
                  );
                })}
            </ul>
          </section>
        )}

        {loading && !summaries.length ? (
          <Spinner label="Loading friends" />
        ) : !friendUids.length ? (
          <EmptyState
            icon="👥"
            title="No friends yet"
            body="Search for someone by username. Once you both accept, you can see each other's map and log."
            action={<Button onClick={() => navigate('/friends/search')}>Find friends</Button>}
          />
        ) : (
          <>
            <section>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                Leaderboard · countries visited
              </h2>
              <ul className="flex flex-col gap-2">
                {summaries.map((s, i) => (
                  <li key={s.profile.uid}>
                    <Card
                      onClick={() => navigate(`/u/${s.profile.uid}`)}
                      className="flex items-center gap-3 px-3 py-3"
                    >
                      <span className="w-5 shrink-0 text-center text-sm font-bold text-muted tabular-nums">
                        {i + 1}
                      </span>
                      <Avatar
                        name={s.profile.displayName}
                        thumb={s.profile.avatarThumb}
                        url={s.profile.avatarUrl}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{s.profile.displayName}</span>
                        <span className="block truncate text-xs text-muted">
                          @{s.profile.username}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-bold tabular-nums">{s.visitedCount}</span>
                        <span className="block text-[10px] text-muted">countries</span>
                      </span>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>

            {!!feed.length && (
              <section>
                <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                  Recent from friends
                </h2>
                <ul className="flex flex-col gap-2">
                  {feed.map((f) => (
                    <li key={`${f.uid}-${f.entry.id}`}>
                      <Card
                        onClick={() => navigate(`/u/${f.uid}`)}
                        className="flex items-center gap-3 px-3 py-2.5"
                      >
                        <Avatar
                          name={f.profile.displayName}
                          thumb={f.profile.avatarThumb}
                          url={f.profile.avatarUrl}
                          size={32}
                        />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="font-medium">{f.profile.displayName}</span>
                          <span className="text-muted"> logged someone in </span>
                          {countryFlag(f.entry.countryCode)}{' '}
                          {countryName(f.entry.countryCode)}
                          <span className="block text-xs text-muted">
                            {relativeTime(f.entry.createdAt)}
                          </span>
                        </span>
                      </Card>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <div className="h-4" />
      </div>
    </Screen>
  );
}
