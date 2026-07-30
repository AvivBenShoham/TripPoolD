import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../state/DataProvider';
import { Card, CountryRow, EmptyState, Screen, StatTile, Spinner, Button } from '../components/ui';
import { computeBadges, deriveStats } from '../lib/stats';
import { CONTINENTS, countryFlag, demonym } from '../lib/geo/countries';
import { formatDateKey, monthLabel, pct, ratingColor } from '../lib/format';
import { MET_VIA_LABELS, type MetVia } from '../types';

export function StatsScreen() {
  const { entries, coverage, loading } = useData();
  const navigate = useNavigate();

  const stats = useMemo(() => deriveStats(entries), [entries]);
  const badges = useMemo(() => computeBadges(coverage, entries, stats), [coverage, entries, stats]);
  const earned = badges.filter((b) => b.earned).length;
  const maxHist = Math.max(1, ...stats.ratingHistogram);
  const maxYear = Math.max(1, ...stats.byYear.map((y) => y.count));

  if (loading) return <Spinner label="Crunching your stats" />;

  return (
    <Screen title="Stats">
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="logged" value={coverage.totalEntries} />
          <StatTile
            label="countries visited"
            value={coverage.visitedCount}
            sub={pct(coverage.visitedPct, 1) + ' of the world'}
            onClick={() => navigate('/countries')}
          />
          <StatTile label="countries with entries" value={coverage.entryCountryCount} />
          <StatTile label="continents" value={`${coverage.continentsCovered}/6`} />
          <StatTile
            label="average rating"
            value={coverage.avgRating !== null ? coverage.avgRating.toFixed(1) : '—'}
          />
          <StatTile label="nationalities" value={stats.nationalities.length} />
        </div>

        <StatTile
          label="of the world's land area"
          value={pct(coverage.visitedAreaPct, 1)}
          sub="A different way to read coverage: a big country counts for more."
        />

        {!entries.length && (
          <EmptyState
            icon="📊"
            title="Stats appear as you log"
            body="You can also just mark countries you have visited — that fills the map on its own."
            action={<Button onClick={() => navigate('/countries')}>Mark countries visited</Button>}
          />
        )}

        <Card
          onClick={() => navigate('/stats/achievements')}
          className="flex items-center gap-3 px-3 py-3"
        >
          <span className="text-2xl">🏅</span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Achievements</span>
            <span className="block text-xs text-muted">
              {earned} of {badges.length} earned
            </span>
          </span>
          <span className="text-muted">›</span>
        </Card>

        {!!stats.byYear.length && (
          <Card className="px-3 py-3">
            <h2 className="mb-3 text-sm font-semibold">By year</h2>
            <div className="flex items-end gap-2" style={{ height: 96 }}>
              {stats.byYear.map((y) => (
                <button
                  key={y.year}
                  type="button"
                  onClick={() => navigate(`/stats/recap/${y.year}`)}
                  className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
                >
                  <span className="text-[10px] tabular-nums text-muted">{y.count}</span>
                  <span
                    className="w-full rounded-t-md bg-accent/80"
                    style={{ height: `${(y.count / maxYear) * 64}px` }}
                  />
                  <span className="text-[10px] text-muted">{String(y.year).slice(2)}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">Tap a year for its recap.</p>
          </Card>
        )}

        {!!entries.length && (
          <Card className="px-3 py-3">
            <h2 className="mb-3 text-sm font-semibold">Rating spread</h2>
            <div className="flex items-end gap-1" style={{ height: 80 }}>
              {stats.ratingHistogram.map((count, i) => (
                <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                  <span
                    className="w-full rounded-t-sm"
                    style={{
                      height: `${(count / maxHist) * 56}px`,
                      backgroundColor: ratingColor(i + 1),
                      minHeight: count ? 3 : 0,
                    }}
                  />
                  <span className="text-[9px] text-muted">{i + 1}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="px-3 py-3">
          <h2 className="mb-2 text-sm font-semibold">Continents</h2>
          <ul className="flex flex-col gap-1.5">
            {CONTINENTS.filter((c) => c !== 'Antarctic').map((c) => {
              const visited = coverage.visitedByRegion[c] ?? 0;
              const logged = coverage.entriesByRegion[c] ?? 0;
              return (
                <li key={c} className="flex items-center gap-2 text-sm">
                  <span className="w-20 shrink-0 text-muted">{c}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-3">
                    <span
                      className="block h-full rounded-full bg-visited"
                      style={{ width: `${Math.min(100, visited * 4)}%` }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted">
                    {visited} · {logged}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-muted">Countries visited · countries with entries.</p>
        </Card>

        {!!stats.topCountries.length && (
          <Card className="px-3 py-2">
            <h2 className="mt-1 mb-1 text-sm font-semibold">Top countries</h2>
            <ul className="divide-y divide-line/60">
              {stats.topCountries.slice(0, 8).map((c) => (
                <li key={c.code}>
                  <CountryRow
                    code={c.code}
                    onClick={() => navigate(`/country/${c.code}`)}
                    right={<span className="tabular-nums text-muted">{c.count}</span>}
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!!stats.nationalities.length && (
          <Card className="px-3 py-3">
            <h2 className="mb-2 text-sm font-semibold">Nationalities</h2>
            <div className="flex flex-wrap gap-1.5">
              {stats.nationalities.slice(0, 24).map((n) => (
                <span
                  key={n.code}
                  className="rounded-full bg-ink-3 px-2.5 py-1 text-xs"
                  title={demonym(n.code)}
                >
                  {countryFlag(n.code)} {demonym(n.code)}
                  {n.count > 1 && <span className="ml-1 text-muted">×{n.count}</span>}
                </span>
              ))}
            </div>
          </Card>
        )}

        {!!entries.length && (
          <Card className="px-3 py-3">
            <h2 className="mb-2 text-sm font-semibold">Records</h2>
            <dl className="flex flex-col gap-2 text-sm">
              {stats.firstEntry && (
                <Row label="First" value={`${stats.firstEntry.name} · ${formatDateKey(stats.firstEntry.dateKey)}`} />
              )}
              {stats.lastEntry && (
                <Row label="Most recent" value={`${stats.lastEntry.name} · ${formatDateKey(stats.lastEntry.dateKey)}`} />
              )}
              {stats.bestRated && (
                <Row label="Highest rated" value={`${stats.bestRated.name} · ${stats.bestRated.rating}/10`} />
              )}
              {stats.busiestMonth && (
                <Row
                  label="Busiest month"
                  value={`${monthLabel(`${stats.busiestMonth.key}-01`)} · ${stats.busiestMonth.count}`}
                />
              )}
              <Row label="Longest streak" value={`${stats.longestStreakMonths} months`} />
              {stats.metViaTop && (
                <Row
                  label="Usually meet"
                  value={`${MET_VIA_LABELS[stats.metViaTop.key as MetVia]} · ${stats.metViaTop.count}`}
                />
              )}
            </dl>
          </Card>
        )}

        {coverage.unresolvedCount > 0 && (
          <Card className="px-3 py-3 text-sm text-muted">
            {coverage.unresolvedCount} {coverage.unresolvedCount === 1 ? 'entry' : 'entries'} still
            need a country, so they are not counted in coverage.
          </Card>
        )}

        <div className="h-4" />
      </div>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  );
}
