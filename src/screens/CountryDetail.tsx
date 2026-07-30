import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useData } from '../state/DataProvider';
import { Button, Card, EmptyState, RatingBadge, Screen } from '../components/ui';
import { BY_ALPHA2, countryFlag, countryName, demonym } from '../lib/geo/countries';
import { formatDateKey } from '../lib/format';
import { setCountryVisited } from '../services/encounters';

export function CountryDetailScreen() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { entries, priv, pub } = useData();
  const [busy, setBusy] = useState(false);

  const cca2 = (code ?? '').toUpperCase();
  const info = BY_ALPHA2[cca2];
  const mine = useMemo(
    () =>
      entries
        .filter((e) => e.countryCode === cca2)
        .sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
    [entries, cca2],
  );
  const manuallyMarked = !!pub.visitedManual[cca2];

  if (!info) {
    return (
      <Screen title="Country" back={() => navigate(-1)}>
        <EmptyState icon="🗺️" title="Unknown country" body={`No country matches “${code}”.`} />
      </Screen>
    );
  }

  const toggle = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await setCountryVisited(user.uid, cca2, !manuallyMarked, priv);
    } finally {
      setBusy(false);
    }
  };

  const avg = mine.length
    ? (mine.reduce((s, e) => s + e.rating, 0) / mine.length).toFixed(1)
    : null;

  return (
    <Screen title={info.name} back={() => navigate(-1)}>
      <div className="flex flex-col gap-4 px-4 py-4">
        <Card className="flex items-center gap-3 px-3 py-3">
          <span className="text-4xl">{countryFlag(cca2)}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{info.name}</p>
            <p className="text-xs text-muted">
              {demonym(cca2)} · {info.subregion || info.region}
            </p>
          </div>
        </Card>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-ink-2 px-2 py-2.5 ring-1 ring-line">
            <div className="text-xl font-bold tabular-nums">{mine.length}</div>
            <div className="text-[10px] text-muted">logged</div>
          </div>
          <div className="rounded-xl bg-ink-2 px-2 py-2.5 ring-1 ring-line">
            <div className="text-xl font-bold tabular-nums">{avg ?? '—'}</div>
            <div className="text-[10px] text-muted">avg rating</div>
          </div>
          <div className="rounded-xl bg-ink-2 px-2 py-2.5 ring-1 ring-line">
            <div className="text-xl font-bold">{mine.length || manuallyMarked ? '✓' : '—'}</div>
            <div className="text-[10px] text-muted">visited</div>
          </div>
        </div>

        <Button variant={manuallyMarked ? 'subtle' : 'ghost'} onClick={() => void toggle()} disabled={busy}>
          {manuallyMarked ? '✓ Marked visited — tap to unmark' : 'Mark as visited'}
        </Button>
        {mine.length > 0 && manuallyMarked && (
          <p className="-mt-2 text-xs text-muted">
            This country counts as visited regardless, because you have entries here.
          </p>
        )}

        {mine.length ? (
          <ul className="divide-y divide-line/60">
            {mine.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/entry/${e.id}`)}
                  className="flex w-full items-center gap-3 py-3 text-left active:bg-ink-3"
                >
                  {e.photo ? (
                    <img src={e.photo.thumbDataUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
                  ) : (
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-3 text-muted">
                      ·
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.name}</span>
                    <span className="block text-xs text-muted">
                      {formatDateKey(e.dateKey)}
                      {e.location.label ? ` · ${e.location.label}` : ''}
                    </span>
                  </span>
                  <RatingBadge rating={e.rating} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={countryFlag(cca2)}
            title={`Nothing in ${countryName(cca2)} yet`}
            body="Mark it visited, or add an entry here."
            action={<Button onClick={() => navigate('/entry/new')}>Add an entry</Button>}
          />
        )}
      </div>
    </Screen>
  );
}
