import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useData } from '../state/DataProvider';
import {
  Avatar,
  Banner,
  Button,
  Card,
  EmptyState,
  RatingBadge,
  Screen,
  Spinner,
  StatTile,
} from '../components/ui';
import { WorldMap, type MapLayer } from '../components/WorldMap';
import { getProfile } from '../services/profiles';
import { getFriendEntries, getFriendPublicAggregates } from '../services/encounters';
import { unfriend } from '../services/friends';
import { buildCoverage, EMPTY_COVERAGE, type Coverage } from '../lib/geo/coverage';
import { countryFlag, countryName } from '../lib/geo/countries';
import { formatDateKey, pct } from '../lib/format';
import type { EncounterWithId, PublicProfile } from '../types';

const LAYERS: { id: MapLayer; label: string }[] = [
  { id: 'combined', label: 'All' },
  { id: 'visited', label: 'Visited' },
  { id: 'entries', label: 'Logged' },
];

export function FriendProfileScreen() {
  const { uid } = useParams<{ uid: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { friendUids } = useData();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [coverage, setCoverage] = useState<Coverage>(EMPTY_COVERAGE);
  const [entries, setEntries] = useState<EncounterWithId[]>([]);
  const [layer, setLayer] = useState<MapLayer>('combined');
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isFriend = !!uid && friendUids.includes(uid);

  useEffect(() => {
    if (!uid || !user) return;
    let cancelled = false;
    setLoading(true);
    setDenied(false);
    setError(null);

    (async () => {
      try {
        const p = await getProfile(uid);
        if (cancelled) return;
        setProfile(p);

        // Both of these are friend-gated by rules. A permission error here is the
        // expected outcome of an unfriend, not a bug — so it becomes a clear message
        // and the cached friend data is dropped rather than left on screen.
        const [agg, list] = await Promise.all([
          getFriendPublicAggregates(uid),
          getFriendEntries(uid, 50),
        ]);
        if (cancelled) return;
        setCoverage(agg ? buildCoverage(agg, null) : EMPTY_COVERAGE);
        setEntries(list);
      } catch (err) {
        if (cancelled) return;
        const code = (err as { code?: string })?.code ?? '';
        if (code === 'permission-denied') {
          setDenied(true);
          setCoverage(EMPTY_COVERAGE);
          setEntries([]);
        } else {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid, user, isFriend]);

  const pins = useMemo(
    () =>
      entries.map((e) => ({
        id: e.id,
        lat: e.location.lat,
        lng: e.location.lng,
        thumb: e.photo?.thumbDataUrl ?? null,
        rating: e.rating,
      })),
    [entries],
  );

  const remove = async () => {
    if (!user || !uid) return;
    setBusy(true);
    try {
      await unfriend(user.uid, uid);
      navigate('/friends', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Loading" />;

  if (denied || !isFriend) {
    return (
      <Screen title={profile?.displayName ?? 'Profile'} back={() => navigate('/friends')}>
        <EmptyState
          icon="🔒"
          title="Not visible"
          body="You need to be friends with each other to see this map and log."
          action={<Button onClick={() => navigate('/friends')}>Back to friends</Button>}
        />
      </Screen>
    );
  }

  return (
    <Screen title={profile?.displayName ?? 'Friend'} back={() => navigate('/friends')}>
      <div className="flex flex-col gap-4 px-4 py-4">
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
          </div>
        </Card>

        <div className="grid grid-cols-3 gap-2">
          <StatTile
            label="countries"
            value={coverage.visitedCount}
            sub={pct(coverage.visitedPct, 0)}
            testId="friend-countries"
          />
          <StatTile label="logged" value={coverage.totalEntries} testId="friend-logged" />
          <StatTile label="continents" value={`${coverage.continentsCovered}/6`} />
        </div>

        <Card className="overflow-hidden">
          <div className="flex gap-1 border-b border-line bg-ink-2 p-1">
            {LAYERS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLayer(l.id)}
                className={`flex-1 rounded-lg py-1.5 text-xs font-medium ${
                  layer === l.id ? 'bg-accent text-white' : 'text-muted'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="h-52">
            <WorldMap
              coverage={coverage}
              layer={layer}
              pins={layer === 'visited' ? [] : pins}
              className="h-full w-full"
            />
          </div>
        </Card>

        <div>
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
            Shared with you ({entries.length})
          </h2>
          {entries.length ? (
            <ul className="divide-y divide-line/60">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-3">
                  {e.photo ? (
                    <img src={e.photo.thumbDataUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
                  ) : (
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-3 text-xl">
                      {countryFlag(e.countryCode)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {countryFlag(e.countryCode)}{' '}
                      {e.location.label || countryName(e.countryCode)} ·{' '}
                      {formatDateKey(e.dateKey)}
                    </span>
                    <span className="block truncate text-xs text-muted/80">
                      {e.nationalityLabel}
                    </span>
                  </span>
                  <RatingBadge rating={e.rating} size="sm" />
                </li>
              ))}
            </ul>
          ) : (
            <Card className="px-3 py-4 text-sm text-muted">
              Nothing shared with you yet. Their totals above still count everything —
              individual entries appear only when they mark them visible to friends.
            </Card>
          )}
        </div>

        <Button variant="ghost" onClick={() => void remove()} disabled={busy}>
          Remove friend
        </Button>

        <div className="h-4" />
      </div>
    </Screen>
  );
}
