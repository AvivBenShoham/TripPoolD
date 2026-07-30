import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useData } from '../state/DataProvider';
import { Banner, Screen, inputClass } from '../components/ui';
import { COUNTRIES, searchCountries, type CountryInfo } from '../lib/geo/countries';
import { pct } from '../lib/format';
import { setCountryVisited } from '../services/encounters';

/**
 * The travel-coverage editor: mark any country visited without logging anyone there.
 * This is coverage layer one, and it is deliberately independent of entries — a country
 * with an entry is implicitly visited, but not the other way round.
 */
export function CountriesScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { coverage, priv, pub } = useData();
  const [search, setSearch] = useState('');
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useMemo(() => (search ? searchCountries(search, 300) : COUNTRIES), [search]);

  const byRegion = useMemo(() => {
    const map = new Map<string, CountryInfo[]>();
    for (const c of list) {
      const arr = map.get(c.region);
      if (arr) arr.push(c);
      else map.set(c.region, [c]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [list]);

  const toggle = async (code: string) => {
    if (!user) return;
    const entryCount = priv.countryCountsAll[code] ?? 0;
    const manuallyMarked = !!pub.visitedManual[code];
    setError(null);
    setBusyCode(code);
    try {
      await setCountryVisited(user.uid, code, !manuallyMarked, priv);
      if (manuallyMarked && entryCount > 0) {
        setError(
          'Removed the manual mark, but this country still counts as visited because you have entries there.',
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyCode(null);
    }
  };

  return (
    <Screen title="Countries visited" back={() => navigate(-1)}>
      <div className="px-4 pt-3 pb-4">
        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-ink-2 px-2 py-2.5 ring-1 ring-line">
            <div className="text-xl font-bold tabular-nums">{coverage.visitedCount}</div>
            <div className="text-[10px] text-muted">visited</div>
          </div>
          <div className="rounded-xl bg-ink-2 px-2 py-2.5 ring-1 ring-line">
            <div className="text-xl font-bold tabular-nums">{pct(coverage.visitedPct, 1)}</div>
            <div className="text-[10px] text-muted">of the world</div>
          </div>
          <div className="rounded-xl bg-ink-2 px-2 py-2.5 ring-1 ring-line">
            <div className="text-xl font-bold tabular-nums">{coverage.entryCountryCount}</div>
            <div className="text-[10px] text-muted">with entries</div>
          </div>
        </div>

        <input
          className={inputClass}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search countries"
          aria-label="Search countries"
        />

        {error && (
          <div className="mt-3">
            <Banner tone="info">{error}</Banner>
          </div>
        )}

        {byRegion.map(([regionName, items]) => (
          <section key={regionName} className="mt-4">
            <h2 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
              {regionName}
              <span className="ml-1.5 font-normal">
                {items.filter((c) => coverage.byCode.has(c.cca2)).length}/{items.length}
              </span>
            </h2>
            <ul className="divide-y divide-line/60">
              {items.map((c) => {
                const cell = coverage.byCode.get(c.cca2);
                const entryCount = priv.countryCountsAll[c.cca2] ?? 0;
                return (
                  <li key={c.cca2} className="flex items-center gap-3 py-2.5">
                    <span className="w-7 shrink-0 text-center text-xl leading-none">{c.flag}</span>
                    <button
                      type="button"
                      onClick={() => navigate(`/country/${c.cca2}`)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate">{c.name}</span>
                      <span className="block text-xs text-muted">
                        {entryCount > 0
                          ? `${entryCount} logged`
                          : cell
                            ? 'Visited'
                            : c.demonym}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggle(c.cca2)}
                      disabled={busyCode === c.cca2}
                      aria-pressed={!!cell}
                      aria-label={`Mark ${c.name} visited`}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm ring-1 transition-colors ${
                        cell
                          ? entryCount > 0
                            ? 'bg-accent/20 text-accent ring-accent/40'
                            : 'bg-visited/30 text-white ring-visited'
                          : 'bg-ink-3 text-muted ring-line'
                      }`}
                    >
                      {busyCode === c.cca2 ? '…' : cell ? '✓' : '+'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Screen>
  );
}
