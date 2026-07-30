import {
  BY_ALPHA2,
  NUMERIC_BY_ALPHA2,
  WORLD_TOTAL,
  isRealCountry,
  region,
} from './countries';
import type { PrivateAggregates, PublicAggregates } from '../../types';

/** 0 = not visited, 1 = visited only, 2 = has entries. Entries win. */
export type CoverageState = 0 | 1 | 2;

export interface CoverageCell {
  code: string;
  state: CoverageState;
  count: number;
}

export interface Coverage {
  /** Keyed by TopoJSON numeric id — the only thing the SVG fill lookup reads. */
  byNumeric: Map<string, CoverageCell>;
  byCode: Map<string, CoverageCell>;

  visitedCodes: string[];
  visitedCount: number;
  visitedPct: number;
  visitedAreaPct: number;
  visitedByRegion: Record<string, number>;

  entryCodes: string[];
  entryCountryCount: number;
  entryCountsByCode: Record<string, number>;
  entriesByRegion: Record<string, number>;

  totalEntries: number;
  continentsCovered: number;
  avgRating: number | null;
  unresolvedCount: number;
  maxCount: number;
}

function countByRegion(codes: Iterable<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const code of codes) {
    const r = region(code);
    out[r] = (out[r] ?? 0) + 1;
  }
  return out;
}

/**
 * Builds every coverage number the map and stats screens read, from at most two
 * documents. Called once per Firestore snapshot (memoised on snapshot identity), never
 * per render — so panning, zooming and switching layers do no work here.
 *
 * The same function serves both views, which is what keeps "my map" and "how my friends
 * see my map" from ever diverging:
 *   - my own map passes (public, private) and reflects every entry
 *   - a friend's map passes (public, null) and reflects exactly what was published
 * That also makes a "preview as friend" toggle a one-line prop change, which is the
 * best defence against a bug in the publish policy.
 */
export function buildCoverage(
  pub: PublicAggregates,
  priv: PrivateAggregates | null,
): Coverage {
  const counts = priv ? priv.countryCountsAll : pub.countryCounts;

  const visited = new Set<string>();
  for (const code of pub.visitedCodes) if (isRealCountry(code)) visited.add(code);

  const entryCounts: Record<string, number> = {};
  for (const [code, n] of Object.entries(counts)) {
    if (n > 0 && isRealCountry(code)) {
      entryCounts[code] = n;
      // An entry country is implicitly visited, so a country never shows as
      // "not visited" while holding entries — even if visitedCodes lags behind.
      visited.add(code);
    }
  }

  const byNumeric = new Map<string, CoverageCell>();
  const byCode = new Map<string, CoverageCell>();
  let maxCount = 0;

  for (const code of visited) {
    const count = entryCounts[code] ?? 0;
    if (count > maxCount) maxCount = count;
    const cell: CoverageCell = { code, state: count > 0 ? 2 : 1, count };
    byCode.set(code, cell);
    const numeric = NUMERIC_BY_ALPHA2[code];
    if (numeric) byNumeric.set(numeric, cell);
  }

  const visitedCodes = [...visited].sort();
  const entryCodes = Object.keys(entryCounts).sort();

  let visitedArea = 0;
  for (const code of visited) visitedArea += BY_ALPHA2[code]?.area ?? 0;
  let totalArea = 0;
  for (const c of Object.values(BY_ALPHA2)) if (c.unMember) totalArea += c.area;

  const visitedByRegion = countByRegion(visited);

  return {
    byNumeric,
    byCode,

    visitedCodes,
    visitedCount: visited.size,
    visitedPct: WORLD_TOTAL ? visited.size / WORLD_TOTAL : 0,
    visitedAreaPct: totalArea ? visitedArea / totalArea : 0,
    visitedByRegion,

    entryCodes,
    entryCountryCount: entryCodes.length,
    entryCountsByCode: entryCounts,
    entriesByRegion: countByRegion(entryCodes),

    totalEntries: priv ? priv.totalEntries : pub.encounterTotal,
    // Antarctica is in the region list but is not a "continent covered" for anyone.
    continentsCovered: Object.keys(visitedByRegion).filter((r) => r !== 'Antarctic').length,
    avgRating: priv
      ? priv.ratingCount > 0
        ? priv.ratingSum / priv.ratingCount
        : null
      : pub.avgRatingPublished,
    unresolvedCount: priv?.unresolvedCount ?? 0,
    maxCount,
  };
}

export const EMPTY_COVERAGE: Coverage = buildCoverage(
  {
    visitedManual: {},
    visitedCodes: [],
    encounterCoverageMode: 'sharedOnly',
    countryCounts: {},
    encounterTotal: 0,
    avgRatingPublished: null,
    updatedAt: null,
  },
  null,
);
