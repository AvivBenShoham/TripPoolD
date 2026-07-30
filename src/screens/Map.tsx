import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../state/DataProvider';
import { WorldMap, type MapLayer } from '../components/WorldMap';
import { Banner, Button, CountryRow, RatingBadge, Sheet, Spinner } from '../components/ui';
import { countryFlag, countryName, demonym } from '../lib/geo/countries';
import { formatDateKey, pct } from '../lib/format';
import { setCountryVisited } from '../services/encounters';
import { useAuth } from '../state/AuthProvider';

const LAYERS: { id: MapLayer; label: string }[] = [
  { id: 'combined', label: 'All' },
  { id: 'visited', label: 'Visited' },
  { id: 'entries', label: 'Logged' },
];

export function MapScreen() {
  const { user } = useAuth();
  const { coverage, entries, priv, pub, loading, error, needsRepair, repair } = useData();
  const navigate = useNavigate();
  const [layer, setLayer] = useState<MapLayer>('combined');
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const selectedEntries = useMemo(
    () => (selected ? entries.filter((e) => e.countryCode === selected) : []),
    [entries, selected],
  );

  const isVisitedManually = selected ? !!pub.visitedManual[selected] : false;
  const selectedCount = selected ? (priv.countryCountsAll[selected] ?? 0) : 0;

  const toggleVisited = async () => {
    if (!user || !selected) return;
    setBusy(true);
    try {
      await setCountryVisited(user.uid, selected, !isVisitedManually, priv);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Loading your map" />;

  return (
    <div className="relative flex h-full flex-col">
      <header className="pt-safe shrink-0 px-4 pb-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="map-total">
              {coverage.totalEntries}
              <span className="ml-1.5 text-sm font-normal text-muted">
                {coverage.totalEntries === 1 ? 'logged' : 'logged'}
              </span>
            </h1>
            <p className="text-xs text-muted" data-testid="map-coverage">
              {coverage.visitedCount} {coverage.visitedCount === 1 ? 'country' : 'countries'}{' '}
              visited · {pct(coverage.visitedPct, 1)} of the world
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            aria-label="Settings"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-ink-2 text-muted ring-1 ring-line active:bg-ink-3"
          >
            ⚙
          </button>
        </div>

        <div className="mt-3 flex gap-1 rounded-xl bg-ink-2 p-1 ring-1 ring-line">
          {LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setLayer(l.id)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                layer === l.id ? 'bg-accent text-white' : 'text-muted'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </header>

      {(error || needsRepair) && (
        <div className="shrink-0 px-4 pb-2">
          {error ? (
            <Banner tone="error">{error}</Banner>
          ) : (
            <Banner
              tone="warn"
              action={
                <Button variant="subtle" onClick={() => void repair()} className="px-3 text-xs">
                  Fix
                </Button>
              }
            >
              Your stats look out of step with your log.
            </Banner>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <WorldMap
          coverage={coverage}
          layer={layer}
          pins={layer === 'visited' ? [] : pins}
          onSelectCountry={setSelected}
          highlightCode={selected}
        />
      </div>

      <div className="shrink-0 px-4 pb-2">
        <div className="flex items-center justify-center gap-4 text-[10px] text-muted">
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-sm bg-[#1b2338] ring-1 ring-line" /> Not visited
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-sm bg-[#3d5aa8]" /> Visited
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-2.5 rounded-sm bg-[hsl(334_78%_54%)]" /> Logged
          </span>
        </div>
      </div>

      <Sheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={
          selected ? (
            <span className="flex items-center gap-2">
              <span className="text-xl">{countryFlag(selected)}</span>
              <span className="truncate">{countryName(selected)}</span>
            </span>
          ) : null
        }
      >
        {selected && (
          <>
            <p className="mb-3 text-sm text-muted">
              {demonym(selected)} ·{' '}
              {selectedCount > 0
                ? `${selectedCount} logged here`
                : isVisitedManually
                  ? 'Visited, nothing logged'
                  : 'Nothing here yet'}
            </p>

            <div className="mb-4 flex gap-2">
              <Button
                variant={isVisitedManually ? 'subtle' : 'ghost'}
                onClick={() => void toggleVisited()}
                disabled={busy}
                className="flex-1"
              >
                {isVisitedManually ? '✓ Marked visited' : 'Mark visited'}
              </Button>
              <Button onClick={() => navigate(`/country/${selected}`)} className="flex-1">
                Open
              </Button>
            </div>

            {selectedCount > 0 && (
              <ul className="divide-y divide-line/60">
                {selectedEntries.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/entry/${e.id}`)}
                      className="flex w-full items-center gap-3 py-2.5 text-left active:bg-ink-3"
                    >
                      {e.photo ? (
                        <img
                          src={e.photo.thumbDataUrl}
                          alt=""
                          className="h-10 w-10 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink-3 text-muted">
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
            )}

            {selectedCount === 0 && !isVisitedManually && (
              <CountryRow
                code={selected}
                sub="Tap ‘Mark visited’ if you have been here without logging anyone."
              />
            )}
          </>
        )}
      </Sheet>
    </div>
  );
}
