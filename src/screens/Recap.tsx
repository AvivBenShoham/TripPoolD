import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../state/DataProvider';
import { Card, EmptyState, Screen } from '../components/ui';
import { WorldMap } from '../components/WorldMap';
import { buildCoverage } from '../lib/geo/coverage';
import { EMPTY_PRIVATE_AGGREGATES, EMPTY_PUBLIC_AGGREGATES, MET_VIA_LABELS } from '../types';
import { countryFlag, countryName, demonym } from '../lib/geo/countries';
import { formatDateKey, monthLabel, yearOf } from '../lib/format';
import { deriveStats } from '../lib/stats';

/** Screenshot-friendly year summary, in the spirit of Polarsteps' travel book. */
export function RecapScreen() {
  const { year } = useParams<{ year: string }>();
  const navigate = useNavigate();
  const { entries } = useData();
  const y = Number(year);

  const mine = useMemo(() => entries.filter((e) => yearOf(e.dateKey) === y), [entries, y]);
  const stats = useMemo(() => deriveStats(mine), [mine]);

  const coverage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of mine) counts[e.countryCode] = (counts[e.countryCode] ?? 0) + 1;
    return buildCoverage(
      { ...EMPTY_PUBLIC_AGGREGATES, visitedCodes: Object.keys(counts) },
      { ...EMPTY_PRIVATE_AGGREGATES, totalEntries: mine.length, countryCountsAll: counts },
    );
  }, [mine]);

  if (!mine.length) {
    return (
      <Screen title={`${year} recap`} back={() => navigate(-1)}>
        <EmptyState icon="🗓️" title={`Nothing logged in ${year}`} />
      </Screen>
    );
  }

  const avg = (mine.reduce((s, e) => s + e.rating, 0) / mine.length).toFixed(1);

  return (
    <Screen title={`${year} recap`} back={() => navigate(-1)}>
      <div className="flex flex-col gap-4 px-4 py-4">
        <Card className="overflow-hidden">
          <div className="h-44">
            <WorldMap
              coverage={coverage}
              pins={mine.map((e) => ({
                id: e.id,
                lat: e.location.lat,
                lng: e.location.lng,
                thumb: null,
                rating: e.rating,
              }))}
              interactive={false}
              className="h-full w-full"
            />
          </div>
          <div className="border-t border-line px-3 py-3">
            <p className="text-3xl font-bold">{mine.length}</p>
            <p className="text-sm text-muted">
              in {coverage.entryCountryCount}{' '}
              {coverage.entryCountryCount === 1 ? 'country' : 'countries'} across{' '}
              {coverage.continentsCovered} {coverage.continentsCovered === 1 ? 'continent' : 'continents'}
            </p>
          </div>
        </Card>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-ink-2 px-2 py-2.5 ring-1 ring-line">
            <div className="text-xl font-bold tabular-nums">{avg}</div>
            <div className="text-[10px] text-muted">avg rating</div>
          </div>
          <div className="rounded-xl bg-ink-2 px-2 py-2.5 ring-1 ring-line">
            <div className="text-xl font-bold tabular-nums">{stats.nationalities.length}</div>
            <div className="text-[10px] text-muted">nationalities</div>
          </div>
          <div className="rounded-xl bg-ink-2 px-2 py-2.5 ring-1 ring-line">
            <div className="text-xl font-bold tabular-nums">{stats.longestStreakMonths}</div>
            <div className="text-[10px] text-muted">month streak</div>
          </div>
        </div>

        {stats.busiestMonth && (
          <Card className="px-3 py-3 text-sm">
            <span className="text-muted">Busiest month · </span>
            {monthLabel(`${stats.busiestMonth.key}-01`)} with {stats.busiestMonth.count}
          </Card>
        )}

        {!!stats.topCountries.length && (
          <Card className="px-3 py-3">
            <h2 className="mb-2 text-sm font-semibold">Where</h2>
            <div className="flex flex-wrap gap-1.5">
              {stats.topCountries.map((c) => (
                <span key={c.code} className="rounded-full bg-ink-3 px-2.5 py-1 text-xs">
                  {countryFlag(c.code)} {countryName(c.code)}
                  {c.count > 1 && <span className="ml-1 text-muted">×{c.count}</span>}
                </span>
              ))}
            </div>
          </Card>
        )}

        {!!stats.nationalities.length && (
          <Card className="px-3 py-3">
            <h2 className="mb-2 text-sm font-semibold">Who</h2>
            <div className="flex flex-wrap gap-1.5">
              {stats.nationalities.map((n) => (
                <span key={n.code} className="rounded-full bg-ink-3 px-2.5 py-1 text-xs">
                  {countryFlag(n.code)} {demonym(n.code)}
                  {n.count > 1 && <span className="ml-1 text-muted">×{n.count}</span>}
                </span>
              ))}
            </div>
          </Card>
        )}

        {stats.bestRated && (
          <Card className="px-3 py-3 text-sm">
            <span className="text-muted">Highest rated · </span>
            {stats.bestRated.name} ({stats.bestRated.rating}/10) ·{' '}
            {formatDateKey(stats.bestRated.dateKey)}
          </Card>
        )}

        {stats.metViaTop && (
          <Card className="px-3 py-3 text-sm">
            <span className="text-muted">Mostly met · </span>
            {MET_VIA_LABELS[stats.metViaTop.key as keyof typeof MET_VIA_LABELS]}
          </Card>
        )}

        <div className="h-4" />
      </div>
    </Screen>
  );
}
