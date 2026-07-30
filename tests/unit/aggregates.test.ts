import { describe, expect, it } from 'vitest';
import {
  aggregateDelta,
  contributesToPublic,
  recomputeAggregates,
  republishForMode,
  type AggregateFacts,
} from '../../src/lib/aggregates/delta';
import { EMPTY_PRIVATE_AGGREGATES } from '../../src/types';

function facts(over: Partial<AggregateFacts> = {}): AggregateFacts {
  return {
    countryCode: 'PT',
    nationalityCode: 'PT',
    metVia: 'bar',
    rating: 8,
    visibility: 'private',
    dateKey: '2026-05-01',
    ...over,
  };
}

/** Nothing anchors any country — the "last entry in this country" case. */
const noAnchor = () => false;
/** Something else still holds every country. */
const anchored = () => true;

describe('contributesToPublic', () => {
  it('follows the coverage mode', () => {
    expect(contributesToPublic('private', 'hidden')).toBe(false);
    expect(contributesToPublic('friends', 'hidden')).toBe(false);
    expect(contributesToPublic('private', 'sharedOnly')).toBe(false);
    expect(contributesToPublic('friends', 'sharedOnly')).toBe(true);
    expect(contributesToPublic('private', 'all')).toBe(true);
    expect(contributesToPublic('friends', 'all')).toBe(true);
  });
});

describe('aggregateDelta — create', () => {
  it('counts a private entry privately but publishes nothing in sharedOnly', () => {
    const d = aggregateDelta(null, facts(), 'sharedOnly', noAnchor);
    expect(d.privateCounts).toMatchObject({
      totalEntries: 1,
      'countryCountsAll.PT': 1,
      'nationalityCounts.PT': 1,
      'metViaCounts.bar': 1,
      ratingSum: 8,
      ratingCount: 1,
    });
    expect(d.privateCounts['countryCountsShared.PT']).toBeUndefined();
    expect(d.publicCounts).toEqual({});
    // Still counts as visited: travel coverage is not gated by the encounter mode.
    expect(d.visitedAdd).toEqual(['PT']);
  });

  it('publishes a shared entry in sharedOnly', () => {
    const d = aggregateDelta(null, facts({ visibility: 'friends' }), 'sharedOnly', noAnchor);
    expect(d.privateCounts['countryCountsShared.PT']).toBe(1);
    expect(d.privateCounts.ratingCountShared).toBe(1);
    expect(d.publicCounts).toMatchObject({ 'countryCounts.PT': 1, encounterTotal: 1 });
  });

  it('publishes a private entry when the mode is all', () => {
    const d = aggregateDelta(null, facts(), 'all', noAnchor);
    expect(d.publicCounts).toMatchObject({ 'countryCounts.PT': 1, encounterTotal: 1 });
    // ...but it is still not counted as *shared*, which is what makes a later mode
    // change back to sharedOnly a local rewrite rather than a recount.
    expect(d.privateCounts['countryCountsShared.PT']).toBeUndefined();
  });

  it('tracks unresolved countries separately and never as visited', () => {
    const d = aggregateDelta(null, facts({ countryCode: 'XX' }), 'all', noAnchor);
    expect(d.privateCounts.unresolvedCount).toBe(1);
    expect(d.visitedAdd).toEqual([]);
    expect(d.visitedRemove).toEqual([]);

    const sea = aggregateDelta(null, facts({ countryCode: 'XZ' }), 'all', noAnchor);
    expect(sea.privateCounts.unresolvedCount).toBe(1);
    expect(sea.visitedAdd).toEqual([]);
  });
});

describe('aggregateDelta — edit', () => {
  it('moves a country count and keeps the totals flat', () => {
    const d = aggregateDelta(
      facts({ countryCode: 'PT' }),
      facts({ countryCode: 'ES' }),
      'sharedOnly',
      noAnchor,
    );
    // Cancelled-out deltas are pruned rather than written as increment(0).
    expect(d.privateCounts.totalEntries).toBeUndefined();
    expect(d.privateCounts['countryCountsAll.PT']).toBe(-1);
    expect(d.privateCounts['countryCountsAll.ES']).toBe(1);
    expect(d.visitedAdd).toEqual(['ES']);
    expect(d.visitedRemove).toEqual(['PT']);
  });

  it('keeps the old country visited when another entry still anchors it', () => {
    const d = aggregateDelta(
      facts({ countryCode: 'PT' }),
      facts({ countryCode: 'ES' }),
      'sharedOnly',
      anchored,
    );
    expect(d.visitedRemove).toEqual([]);
    expect(d.visitedAdd).toEqual(['ES']);
  });

  it('adjusts the published layer when visibility flips', () => {
    const toFriends = aggregateDelta(
      facts({ visibility: 'private' }),
      facts({ visibility: 'friends' }),
      'sharedOnly',
      anchored,
    );
    expect(toFriends.publicCounts).toMatchObject({ 'countryCounts.PT': 1, encounterTotal: 1 });
    expect(toFriends.privateCounts['countryCountsShared.PT']).toBe(1);

    const toPrivate = aggregateDelta(
      facts({ visibility: 'friends' }),
      facts({ visibility: 'private' }),
      'sharedOnly',
      anchored,
    );
    expect(toPrivate.publicCounts).toMatchObject({ 'countryCounts.PT': -1, encounterTotal: -1 });
  });

  it('does not touch the published layer when the mode is all', () => {
    const d = aggregateDelta(
      facts({ visibility: 'private' }),
      facts({ visibility: 'friends' }),
      'all',
      anchored,
    );
    // Both contribute under `all`, so the published counts must net to zero rather than
    // double-counting the same entry.
    expect(d.publicCounts['countryCounts.PT']).toBeUndefined();
    expect(d.publicCounts.encounterTotal).toBeUndefined();
  });

  it('adjusts the rating sums when the rating changes', () => {
    const d = aggregateDelta(facts({ rating: 4 }), facts({ rating: 9 }), 'sharedOnly', anchored);
    expect(d.privateCounts.ratingSum).toBe(5);
    expect(d.privateCounts.ratingCount).toBeUndefined();
  });
});

describe('aggregateDelta — delete', () => {
  it('reverses everything and un-visits an unanchored country', () => {
    const d = aggregateDelta(facts({ visibility: 'friends' }), null, 'sharedOnly', noAnchor);
    expect(d.privateCounts).toMatchObject({
      totalEntries: -1,
      'countryCountsAll.PT': -1,
      'countryCountsShared.PT': -1,
      ratingSum: -8,
      ratingCount: -1,
    });
    expect(d.publicCounts).toMatchObject({ 'countryCounts.PT': -1, encounterTotal: -1 });
    expect(d.visitedRemove).toEqual(['PT']);
  });

  it('leaves the country visited when it was marked manually', () => {
    // anchored() stands in for "visitedManual holds PT", which is exactly what stops a
    // deletion from erasing a country the user marked as visited by hand.
    const d = aggregateDelta(facts(), null, 'sharedOnly', anchored);
    expect(d.visitedRemove).toEqual([]);
  });
});

describe('recomputeAggregates', () => {
  const entries: AggregateFacts[] = [
    facts({ countryCode: 'PT', rating: 8, visibility: 'friends', dateKey: '2026-05-01' }),
    facts({ countryCode: 'PT', rating: 6, visibility: 'private', dateKey: '2026-01-09' }),
    facts({ countryCode: 'ES', nationalityCode: 'BR', rating: 10, visibility: 'friends', dateKey: '2026-03-20' }),
    facts({ countryCode: 'XX', rating: 5, visibility: 'private', dateKey: '2025-12-02' }),
  ];

  it('folds the same numbers the incremental path produces', () => {
    const { priv } = recomputeAggregates(entries, 'sharedOnly', ['FR']);
    expect(priv.totalEntries).toBe(4);
    expect(priv.countryCountsAll).toEqual({ PT: 2, ES: 1, XX: 1 });
    expect(priv.countryCountsShared).toEqual({ PT: 1, ES: 1 });
    expect(priv.nationalityCounts).toEqual({ PT: 3, BR: 1 });
    expect(priv.ratingSum).toBe(29);
    expect(priv.ratingCount).toBe(4);
    expect(priv.ratingSumShared).toBe(18);
    expect(priv.unresolvedCount).toBe(1);
    expect(priv.firstEntryDateKey).toBe('2025-12-02');
    expect(priv.lastEntryDateKey).toBe('2026-05-01');
  });

  it('unions manual and entry countries, excluding sentinels', () => {
    const { pub } = recomputeAggregates(entries, 'sharedOnly', ['FR', 'IT']);
    expect(pub.visitedCodes).toEqual(['ES', 'FR', 'IT', 'PT']);
    expect(pub.countryCounts).toEqual({ PT: 1, ES: 1 });
    expect(pub.encounterTotal).toBe(2);
    expect(pub.avgRatingPublished).toBe(9);
  });

  it('publishes nothing but still reports travel coverage when hidden', () => {
    const { pub } = recomputeAggregates(entries, 'hidden', ['FR']);
    expect(pub.countryCounts).toEqual({});
    expect(pub.encounterTotal).toBe(0);
    expect(pub.avgRatingPublished).toBeNull();
    // The visited union stays truthful, so a friend cannot infer hidden entry countries
    // by diffing the two layers.
    expect(pub.visitedCodes).toEqual(['ES', 'FR', 'PT']);
  });
});

describe('republishForMode', () => {
  const priv = {
    ...EMPTY_PRIVATE_AGGREGATES,
    totalEntries: 3,
    countryCountsAll: { PT: 2, ES: 1 },
    countryCountsShared: { PT: 1 },
    ratingSum: 24,
    ratingCount: 3,
    ratingSumShared: 8,
    ratingCountShared: 1,
  };

  it('rewrites the published layer from the private maps, with no entry reads', () => {
    expect(republishForMode(priv, 'all', ['FR'])).toMatchObject({
      countryCounts: { PT: 2, ES: 1 },
      encounterTotal: 3,
      avgRatingPublished: 8,
    });
    expect(republishForMode(priv, 'sharedOnly', ['FR'])).toMatchObject({
      countryCounts: { PT: 1 },
      encounterTotal: 1,
      avgRatingPublished: 8,
    });
    expect(republishForMode(priv, 'hidden', ['FR'])).toMatchObject({
      countryCounts: {},
      encounterTotal: 0,
      avgRatingPublished: null,
    });
  });

  it('keeps the visited union identical across all three modes', () => {
    const expected = ['ES', 'FR', 'PT'];
    for (const mode of ['hidden', 'sharedOnly', 'all'] as const) {
      expect(republishForMode(priv, mode, ['FR']).visitedCodes).toEqual(expected);
    }
  });
});
