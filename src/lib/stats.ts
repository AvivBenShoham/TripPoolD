import type { EncounterWithId } from '../types';
import type { Coverage } from './geo/coverage';
import { monthKeyOf, yearOf } from './format';

export interface DerivedStats {
  ratingHistogram: number[];
  topCountries: { code: string; count: number }[];
  nationalities: { code: string; count: number }[];
  byYear: { year: number; count: number }[];
  busiestMonth: { key: string; count: number } | null;
  longestStreakMonths: number;
  firstEntry: EncounterWithId | null;
  lastEntry: EncounterWithId | null;
  bestRated: EncounterWithId | null;
  metViaTop: { key: string; count: number } | null;
}

/** Longest run of consecutive calendar months with at least one entry. */
function longestMonthStreak(monthKeys: Set<string>): number {
  if (!monthKeys.size) return 0;
  const sorted = [...monthKeys].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const [py, pm] = sorted[i - 1].split('-').map(Number);
    const [cy, cm] = sorted[i].split('-').map(Number);
    const consecutive = cy * 12 + cm === py * 12 + pm + 1;
    run = consecutive ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

export function deriveStats(entries: EncounterWithId[]): DerivedStats {
  const ratingHistogram = new Array(10).fill(0) as number[];
  const countryCounts = new Map<string, number>();
  const nationalityCounts = new Map<string, number>();
  const yearCounts = new Map<number, number>();
  const monthCounts = new Map<string, number>();
  const metViaCounts = new Map<string, number>();

  let first: EncounterWithId | null = null;
  let last: EncounterWithId | null = null;
  let best: EncounterWithId | null = null;

  for (const e of entries) {
    ratingHistogram[Math.min(9, Math.max(0, e.rating - 1))] += 1;
    countryCounts.set(e.countryCode, (countryCounts.get(e.countryCode) ?? 0) + 1);
    nationalityCounts.set(e.nationalityCode, (nationalityCounts.get(e.nationalityCode) ?? 0) + 1);
    const y = yearOf(e.dateKey);
    yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
    const mk = monthKeyOf(e.dateKey);
    monthCounts.set(mk, (monthCounts.get(mk) ?? 0) + 1);
    metViaCounts.set(e.metVia, (metViaCounts.get(e.metVia) ?? 0) + 1);

    if (!first || e.dateKey < first.dateKey) first = e;
    if (!last || e.dateKey > last.dateKey) last = e;
    if (!best || e.rating > best.rating) best = e;
  }

  const busiest = [...monthCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const topMetVia = [...metViaCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    ratingHistogram,
    topCountries: [...countryCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    nationalities: [...nationalityCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    byYear: [...yearCounts.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year),
    busiestMonth: busiest ? { key: busiest[0], count: busiest[1] } : null,
    longestStreakMonths: longestMonthStreak(new Set(monthCounts.keys())),
    firstEntry: first,
    lastEntry: last,
    bestRated: best,
    metViaTop: topMetVia ? { key: topMetVia[0], count: topMetVia[1] } : null,
  };
}

export interface Badge {
  id: string;
  icon: string;
  title: string;
  description: string;
  earned: boolean;
  /** 0..1 toward earning it. */
  progress: number;
}

/**
 * Achievements span both coverage layers deliberately: some reward logging, others
 * reward travel alone, so marking countries visited is worth doing on its own.
 */
export function computeBadges(
  coverage: Coverage,
  entries: EncounterWithId[],
  stats: DerivedStats,
): Badge[] {
  const badges: Badge[] = [];
  const total = entries.length;

  const tier = (
    id: string,
    icon: string,
    title: string,
    description: string,
    value: number,
    target: number,
  ) =>
    badges.push({
      id,
      icon,
      title,
      description,
      earned: value >= target,
      progress: Math.min(1, target ? value / target : 0),
    });

  tier('first', '🌱', 'First pin', 'Log your first entry', total, 1);
  tier('ten', '🔟', 'Double digits', 'Log 10 entries', total, 10);
  tier('fifty', '5️⃣0️⃣', 'Half century', 'Log 50 entries', total, 50);
  tier('century', '💯', 'Century', 'Log 100 entries', total, 100);

  tier('c5', '🗺️', 'Getting around', 'Visit 5 countries', coverage.visitedCount, 5);
  tier('c10', '🧭', 'Ten countries', 'Visit 10 countries', coverage.visitedCount, 10);
  tier('c25', '✈️', 'Frequent flyer', 'Visit 25 countries', coverage.visitedCount, 25);
  tier('c50', '🌐', 'Half a hundred', 'Visit 50 countries', coverage.visitedCount, 50);
  tier('c100', '🏆', 'Centurion', 'Visit 100 countries', coverage.visitedCount, 100);

  tier(
    'logged5',
    '📍',
    'Five flags',
    'Log an entry in 5 different countries',
    coverage.entryCountryCount,
    5,
  );
  tier(
    'logged15',
    '🎌',
    'Fifteen flags',
    'Log an entry in 15 different countries',
    coverage.entryCountryCount,
    15,
  );

  tier(
    'continents',
    '🌏',
    'Grand slam',
    'Visit all six inhabited continents',
    coverage.continentsCovered,
    6,
  );

  const nationalityCount = stats.nationalities.length;
  tier('nat5', '🛂', 'Five passports', 'Five different nationalities', nationalityCount, 5);
  tier('nat15', '🎭', 'Fifteen passports', 'Fifteen different nationalities', nationalityCount, 15);

  const hasPerfect = entries.some((e) => e.rating === 10);
  badges.push({
    id: 'perfect',
    icon: '⭐',
    title: 'Perfect ten',
    description: 'Rate someone a 10',
    earned: hasPerfect,
    progress: hasPerfect ? 1 : stats.bestRated ? stats.bestRated.rating / 10 : 0,
  });

  const abroad = entries.length > 0 && coverage.entryCountryCount > 1;
  badges.push({
    id: 'abroad',
    icon: '🛫',
    title: 'Passport stamped',
    description: 'Log entries in more than one country',
    earned: abroad,
    progress: Math.min(1, coverage.entryCountryCount / 2),
  });

  tier('streak3', '🔥', 'On a run', 'Three consecutive months', stats.longestStreakMonths, 3);
  tier('streak6', '☄️', 'Six in a row', 'Six consecutive months', stats.longestStreakMonths, 6);

  const photoCount = entries.filter((e) => e.photo).length;
  tier('photos10', '📷', 'Photo album', 'Add photos to 10 entries', photoCount, 10);

  return badges;
}
