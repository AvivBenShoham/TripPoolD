import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../state/DataProvider';
import { Button, EmptyState, RatingBadge, Screen, Sheet, Spinner, inputClass } from '../components/ui';
import { countryFlag, countryName } from '../lib/geo/countries';
import { formatDateKey, monthLabel, monthKeyOf } from '../lib/format';
import { MET_VIA_LABELS } from '../types';
import type { EncounterWithId } from '../types';

type SortKey = 'date-desc' | 'date-asc' | 'rating-desc' | 'rating-asc';

export function LogScreen() {
  const { entries, loading, coverage } = useData();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('date-desc');
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  const [minRating, setMinRating] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let list = entries.filter((e) => {
      if (countryFilter && e.countryCode !== countryFilter) return false;
      if (e.rating < minRating) return false;
      if (!needle) return true;
      return (
        e.name.toLowerCase().includes(needle) ||
        e.location.label.toLowerCase().includes(needle) ||
        e.countryName.toLowerCase().includes(needle) ||
        e.nationalityLabel.toLowerCase().includes(needle) ||
        e.description.toLowerCase().includes(needle) ||
        e.tags.some((t) => t.includes(needle))
      );
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'date-asc':
          return a.dateKey.localeCompare(b.dateKey);
        case 'rating-desc':
          return b.rating - a.rating || b.dateKey.localeCompare(a.dateKey);
        case 'rating-asc':
          return a.rating - b.rating || b.dateKey.localeCompare(a.dateKey);
        default:
          return b.dateKey.localeCompare(a.dateKey);
      }
    });
    return list;
  }, [entries, search, sort, countryFilter, minRating]);

  // Month grouping only makes sense while sorted by date.
  const groups = useMemo(() => {
    if (sort !== 'date-desc' && sort !== 'date-asc') {
      return [{ key: 'all', label: '', items: filtered }];
    }
    const map = new Map<string, EncounterWithId[]>();
    for (const e of filtered) {
      const key = monthKeyOf(e.dateKey);
      const arr = map.get(key);
      if (arr) arr.push(e);
      else map.set(key, [e]);
    }
    return [...map.entries()].map(([key, items]) => ({
      key,
      label: monthLabel(`${key}-01`),
      items,
    }));
  }, [filtered, sort]);

  const activeFilters = (countryFilter ? 1 : 0) + (minRating > 1 ? 1 : 0);

  if (loading) return <Spinner label="Loading your log" />;

  return (
    <Screen
      title="Log"
      right={
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className="relative flex h-9 items-center gap-1 rounded-lg bg-ink-2 px-3 text-sm text-muted ring-1 ring-line active:bg-ink-3"
        >
          Filter
          {activeFilters > 0 && (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] text-white">
              {activeFilters}
            </span>
          )}
        </button>
      }
    >
      <div className="px-4 pt-3">
        <input
          className={inputClass}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search names, places, tags"
          aria-label="Search your log"
        />
      </div>

      {!entries.length ? (
        <EmptyState
          icon="📖"
          title="Nothing logged yet"
          body="Add your first entry and it will appear on your map straight away."
          action={<Button onClick={() => navigate('/entry/new')}>Add an entry</Button>}
        />
      ) : !filtered.length ? (
        <EmptyState icon="🔍" title="No matches" body="Try a different search or clear the filters." />
      ) : (
        <div className="px-4 pt-3 pb-4">
          <p className="mb-2 text-xs text-muted">
            {filtered.length} of {entries.length} · {coverage.entryCountryCount} countries
          </p>
          {groups.map((g) => (
            <section key={g.key} className="mb-4">
              {g.label && (
                <h2 className="sticky top-0 z-10 -mx-4 bg-ink/95 px-4 py-1.5 text-xs font-semibold tracking-wide text-muted uppercase backdrop-blur">
                  {g.label}
                </h2>
              )}
              <ul className="divide-y divide-line/60">
                {g.items.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/entry/${e.id}`)}
                      className="flex w-full items-center gap-3 py-3 text-left active:bg-ink-3"
                    >
                      {e.photo ? (
                        <img
                          src={e.photo.thumbDataUrl}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-xl object-cover"
                        />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-ink-3 text-xl">
                          {countryFlag(e.countryCode)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{e.name}</span>
                          {e.visibility === 'friends' && (
                            <span className="text-[10px] text-muted" title="Visible to friends">
                              👥
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {countryFlag(e.countryCode)} {e.location.label || countryName(e.countryCode)}
                          {' · '}
                          {formatDateKey(e.dateKey)}
                        </span>
                        <span className="block truncate text-xs text-muted/80">
                          {e.nationalityLabel} · {MET_VIA_LABELS[e.metVia]}
                        </span>
                      </span>
                      <RatingBadge rating={e.rating} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter and sort">
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Sort</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['date-desc', 'Newest first'],
                  ['date-asc', 'Oldest first'],
                  ['rating-desc', 'Highest rated'],
                  ['rating-asc', 'Lowest rated'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSort(key)}
                  className={`rounded-xl px-3 py-2.5 text-sm ring-1 ${
                    sort === key ? 'bg-accent text-white ring-accent' : 'bg-ink-3 text-muted ring-line'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
              Minimum rating: {minRating}
            </p>
            <input
              type="range"
              min={1}
              max={10}
              value={minRating}
              onChange={(e) => setMinRating(Number(e.target.value))}
              className="h-6 w-full"
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Country</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setCountryFilter(null)}
                className={`rounded-full px-3 py-1.5 text-sm ring-1 ${
                  !countryFilter ? 'bg-accent text-white ring-accent' : 'bg-ink-3 text-muted ring-line'
                }`}
              >
                All
              </button>
              {coverage.entryCodes.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setCountryFilter(code)}
                  className={`rounded-full px-3 py-1.5 text-sm ring-1 ${
                    countryFilter === code
                      ? 'bg-accent text-white ring-accent'
                      : 'bg-ink-3 text-muted ring-line'
                  }`}
                >
                  {countryFlag(code)} {countryName(code)}
                </button>
              ))}
            </div>
          </div>

          <Button
            variant="ghost"
            onClick={() => {
              setCountryFilter(null);
              setMinRating(1);
              setSort('date-desc');
            }}
          >
            Reset
          </Button>
        </div>
      </Sheet>
    </Screen>
  );
}
