import { describe, expect, it } from 'vitest';
import { resolveCountry } from '../../src/lib/geo/resolve';
import {
  ALPHA2_BY_NUMERIC,
  COUNTRIES,
  WORLD_TOTAL,
  alpha2ForFeature,
  demonym,
} from '../../src/lib/geo/countries';
import { RENDER_FEATURES } from '../../src/lib/geo/atlas';
import { buildCoverage } from '../../src/lib/geo/coverage';
import { EMPTY_PRIVATE_AGGREGATES, EMPTY_PUBLIC_AGGREGATES } from '../../src/types';

/**
 * These cases are the measured output of the geo strategy, not aspirations. They exist
 * so that bumping world-atlas or world-countries cannot silently degrade pin→country
 * resolution — which is exactly what would happen at 110m, where Singapore resolves to
 * Malaysia and Monaco to France.
 */
describe('reverse geocoding', () => {
  const cases: [name: string, lat: number, lng: number, expected: string][] = [
    ['Paris', 48.8566, 2.3522, 'FR'],
    ['Tel Aviv', 32.08, 34.78, 'IL'],
    ['Barcelona', 41.39, 2.17, 'ES'],
    ['Amsterdam', 52.37, 4.9, 'NL'],
    ['Tokyo', 35.68, 139.69, 'JP'],
    ['Cancun', 21.16, -86.85, 'MX'],
    ['Dubai', 25.2, 55.27, 'AE'],
    // Microstates and islands: all of these fail outright at 110m resolution.
    ['Singapore', 1.29, 103.85, 'SG'],
    ['Malta', 35.9, 14.51, 'MT'],
    ['Maldives', 4.18, 73.51, 'MV'],
    ['Andorra', 42.51, 1.52, 'AD'],
    ['Mykonos', 37.45, 25.33, 'GR'],
    ['Santorini', 36.39, 25.43, 'GR'],
    ['Ibiza', 38.91, 1.43, 'ES'],
    ['Phuket', 7.89, 98.39, 'TH'],
    ['Mauritius', -20.34, 57.55, 'MU'],
    ['Bahamas', 25.06, -77.35, 'BS'],
    // Coastal points that land offshore of a coarse coastline — these are what the
    // nearest-vertex snap exists for. A centroid fallback gets all three wrong.
    ['Monaco', 43.73, 7.42, 'MC'],
    ['Hong Kong', 22.32, 114.17, 'HK'],
    ['Copacabana', -22.97, -43.18, 'BR'],
    ['Miami Beach', 25.79, -80.13, 'US'],
    ['Bora Bora', -16.5, -151.74, 'PF'],
  ];

  for (const [name, lat, lng, expected] of cases) {
    it(`resolves ${name} to ${expected}`, async () => {
      const r = await resolveCountry(lat, lng);
      expect(r.code).toBe(expected);
    });
  }

  it('reports a snapped result as such, with a distance', async () => {
    const r = await resolveCountry(43.73, 7.42); // Monaco, outside every polygon
    expect(r.status).toBe('nearest');
    expect(r.accuracyKm).toBeGreaterThanOrEqual(0);
    expect(r.accuracyKm).toBeLessThanOrEqual(120);
  });

  it('leaves open ocean unresolved rather than guessing', async () => {
    for (const [lat, lng] of [
      [20, -30], // mid-Atlantic
      [0, -140], // mid-Pacific
      [-40, 80], // southern Indian Ocean
    ]) {
      const r = await resolveCountry(lat, lng);
      expect(r.code).toBe('XX');
      expect(r.status).toBe('unresolved');
    }
  });
});

describe('country dataset', () => {
  it('covers every country with a stable denominator', () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(250);
    // Frozen constant: if this changes, everyone's "% of world" silently moves.
    expect(WORLD_TOTAL).toBe(194);
  });

  it('joins the render atlas to alpha-2 codes', () => {
    const matched = RENDER_FEATURES.filter((f) =>
      alpha2ForFeature(f.id, f.properties?.name),
    ).length;
    // 177 features; the unmatched remainder is disputed territory with no ISO code.
    expect(matched).toBeGreaterThanOrEqual(174);
    expect(ALPHA2_BY_NUMERIC['250']).toBe('FR');
  });

  it('supplies demonyms for the nationality field', () => {
    expect(demonym('FR')).toBe('French');
    expect(demonym('BR')).toBe('Brazilian');
    expect(demonym('TH')).toBe('Thai');
  });
});

describe('coverage union', () => {
  it('treats an entry country as visited even when visitedCodes lags', () => {
    const cov = buildCoverage(
      { ...EMPTY_PUBLIC_AGGREGATES, visitedCodes: ['JP'] },
      { ...EMPTY_PRIVATE_AGGREGATES, totalEntries: 3, countryCountsAll: { BR: 2, PT: 1 } },
    );
    expect(cov.visitedCodes).toEqual(['BR', 'JP', 'PT']);
    expect(cov.visitedCount).toBe(3);
    expect(cov.entryCountryCount).toBe(2);
    expect(cov.byCode.get('JP')?.state).toBe(1); // visited only
    expect(cov.byCode.get('BR')?.state).toBe(2); // has entries
    expect(cov.byCode.get('BR')?.count).toBe(2);
  });

  it('excludes the unresolved and international-waters sentinels', () => {
    const cov = buildCoverage(
      { ...EMPTY_PUBLIC_AGGREGATES, visitedCodes: ['XX', 'XZ', 'FR'] },
      { ...EMPTY_PRIVATE_AGGREGATES, totalEntries: 2, countryCountsAll: { XX: 1, FR: 1 } },
    );
    expect(cov.visitedCodes).toEqual(['FR']);
    expect(cov.entryCodes).toEqual(['FR']);
  });

  it("renders a friend's view from the public doc alone", () => {
    const cov = buildCoverage(
      {
        ...EMPTY_PUBLIC_AGGREGATES,
        visitedCodes: ['FR', 'IT', 'ES'],
        countryCounts: { ES: 2 },
        encounterTotal: 2,
        avgRatingPublished: 7.5,
      },
      null,
    );
    expect(cov.visitedCount).toBe(3);
    expect(cov.entryCountryCount).toBe(1);
    expect(cov.totalEntries).toBe(2);
    expect(cov.avgRating).toBe(7.5);
  });

  it('counts continents and percentage of world', () => {
    const cov = buildCoverage(
      { ...EMPTY_PUBLIC_AGGREGATES, visitedCodes: ['FR', 'BR', 'JP', 'ZA', 'AU'] },
      null,
    );
    expect(cov.continentsCovered).toBe(5);
    expect(cov.visitedPct).toBeCloseTo(5 / 194, 6);
    expect(cov.visitedAreaPct).toBeGreaterThan(0);
    expect(cov.visitedAreaPct).toBeLessThan(1);
  });
});
