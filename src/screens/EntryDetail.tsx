import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useData } from '../state/DataProvider';
import { Button, Card, EmptyState, RatingBadge, Screen, Spinner } from '../components/ui';
import { WorldMap } from '../components/WorldMap';
import { countryFlag, countryName } from '../lib/geo/countries';
import { formatDateKey } from '../lib/format';
import { MET_VIA_LABELS } from '../types';
import { getFullPhoto } from '../services/encounters';
import { buildCoverage } from '../lib/geo/coverage';
import { EMPTY_PRIVATE_AGGREGATES, EMPTY_PUBLIC_AGGREGATES } from '../types';

export function EntryDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { entries, loading } = useData();
  const entry = entries.find((e) => e.id === id) ?? null;

  const [fullPhoto, setFullPhoto] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);

  // The full image lives in a separate document so the log list never pays for it.
  useEffect(() => {
    if (!user || !entry?.hasFullPhoto || !id) return;
    let cancelled = false;
    getFullPhoto(user.uid, id)
      .then((d) => {
        if (!cancelled) setFullPhoto(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [user, entry?.hasFullPhoto, id]);

  if (loading) return <Spinner />;
  if (!entry) {
    return (
      <Screen title="Entry" back={() => navigate('/log')}>
        <EmptyState icon="🤷" title="That entry is gone" body="It may have been deleted." />
      </Screen>
    );
  }

  const singleCoverage = buildCoverage(
    { ...EMPTY_PUBLIC_AGGREGATES, visitedCodes: [entry.countryCode] },
    { ...EMPTY_PRIVATE_AGGREGATES, countryCountsAll: { [entry.countryCode]: 1 }, totalEntries: 1 },
  );

  return (
    <Screen
      title={entry.name}
      back={() => navigate(-1)}
      right={
        <Button variant="subtle" onClick={() => navigate(`/entry/${entry.id}/edit`)} className="px-3">
          Edit
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        {(fullPhoto || entry.photo) && (
          <button
            type="button"
            onClick={() => setPhotoOpen((v) => !v)}
            className="overflow-hidden rounded-2xl ring-1 ring-line"
          >
            <img
              src={fullPhoto ?? entry.photo!.thumbDataUrl}
              alt={entry.name}
              className={`w-full object-cover transition-all ${photoOpen ? '' : 'max-h-72'}`}
            />
          </button>
        )}

        <div className="flex items-center gap-3">
          <RatingBadge rating={entry.rating} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{entry.name}</p>
            <p className="text-xs text-muted">
              {entry.nationalityLabel}
              {entry.age !== null ? ` · ${entry.age}` : ''}
            </p>
          </div>
          <span
            className="rounded-full bg-ink-3 px-2.5 py-1 text-xs text-muted"
            title={entry.visibility === 'friends' ? 'Friends can see this' : 'Only you can see this'}
          >
            {entry.visibility === 'friends' ? '👥 Friends' : '🔒 Private'}
          </span>
        </div>

        <Card className="overflow-hidden">
          <div className="h-40">
            <WorldMap
              coverage={singleCoverage}
              pins={[
                {
                  id: entry.id,
                  lat: entry.location.lat,
                  lng: entry.location.lng,
                  thumb: null,
                  rating: entry.rating,
                },
              ]}
              markerLatLng={{ lat: entry.location.lat, lng: entry.location.lng }}
              highlightCode={entry.countryCode}
              interactive={false}
              className="h-full w-full"
            />
          </div>
          <button
            type="button"
            onClick={() => navigate(`/country/${entry.countryCode}`)}
            className="flex w-full items-center gap-3 border-t border-line px-3 py-3 text-left active:bg-ink-3"
          >
            <span className="text-xl">{countryFlag(entry.countryCode)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {entry.location.label || countryName(entry.countryCode)}
              </span>
              <span className="block text-xs text-muted">
                {countryName(entry.countryCode)}
                {entry.countryStatus === 'nearest' && entry.location.accuracyKm !== null
                  ? ` · nearest coast ~${entry.location.accuracyKm} km`
                  : ''}
              </span>
            </span>
            <span className="text-muted">›</span>
          </button>
        </Card>

        <dl className="grid grid-cols-2 gap-3">
          <Detail label="Date" value={formatDateKey(entry.dateKey)} />
          <Detail
            label="How you met"
            value={
              entry.metViaDetail
                ? `${MET_VIA_LABELS[entry.metVia]} · ${entry.metViaDetail}`
                : MET_VIA_LABELS[entry.metVia]
            }
          />
        </dl>

        {entry.description && (
          <Card className="px-3 py-3">
            <p className="text-sm whitespace-pre-wrap">{entry.description}</p>
          </Card>
        )}

        {!!entry.tags.length && (
          <div className="flex flex-wrap gap-1.5">
            {entry.tags.map((t) => (
              <span key={t} className="rounded-full bg-ink-3 px-2.5 py-1 text-xs text-muted">
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="h-4" />
      </div>
    </Screen>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-ink-2 px-3 py-2.5 ring-1 ring-line">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}
