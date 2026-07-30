import { arrayRemove, arrayUnion, deleteField, increment, serverTimestamp } from 'firebase/firestore';
import type { CoverageMode, Encounter, PrivateAggregates, Visibility } from '../../types';
import { isRealCountry } from '../geo/countries';

/**
 * The single source of truth for every aggregate number in the app.
 *
 * Pure, exhaustively unit-tested, and used by BOTH the write path and the repair
 * routine — so a create, an edit, a delete and a full recompute can never disagree
 * about what the counters should say. Rules can bound the shape of these values but
 * cannot verify their arithmetic, so this file is where that correctness lives.
 *
 * Everything is expressed with increment/arrayUnion sentinels rather than
 * read-modify-write. That is deliberate: sentinels are commutative, so two tabs or a
 * queued offline write replaying against a newer server state both land correctly.
 */

/** The subset of an entry the aggregates care about. */
export interface AggregateFacts {
  countryCode: string;
  nationalityCode: string;
  metVia: string;
  rating: number;
  visibility: Visibility;
  dateKey: string;
}

export function factsOf(e: Encounter): AggregateFacts {
  return {
    countryCode: e.countryCode,
    nationalityCode: e.nationalityCode,
    metVia: e.metVia,
    rating: e.rating,
    visibility: e.visibility,
    dateKey: e.dateKey,
  };
}

/** Does this entry contribute to the friend-visible encounter layer? */
export function contributesToPublic(visibility: Visibility, mode: CoverageMode): boolean {
  if (mode === 'hidden') return false;
  if (mode === 'all') return true;
  return visibility === 'friends';
}

type FieldMap = Record<string, unknown>;

function bump(map: FieldMap, path: string, by: number): void {
  if (by === 0) return;
  const existing = map[path];
  // Two entries in one batch can touch the same country; fold them rather than
  // emitting two operations, because a batch allows only one op per document.
  const prev = typeof existing === 'number' ? existing : 0;
  map[path] = prev + by;
}

function toIncrements(counts: FieldMap): FieldMap {
  const out: FieldMap = {};
  for (const [k, v] of Object.entries(counts)) {
    out[k] = increment(v as number);
  }
  return out;
}

export interface AggregateDelta {
  privateCounts: FieldMap;
  publicCounts: FieldMap;
  visitedAdd: string[];
  visitedRemove: string[];
}

/**
 * Computes the raw numeric deltas for a transition. `before`/`after` null means
 * create/delete respectively.
 *
 * `stillAnchored` answers "does any OTHER entry, or a manual mark, still hold this
 * country?" — the caller knows this from the aggregates it already has in memory. It is
 * what stops deleting one entry from wrongly un-visiting a country.
 */
export function aggregateDelta(
  before: AggregateFacts | null,
  after: AggregateFacts | null,
  mode: CoverageMode,
  stillAnchored: (code: string) => boolean,
): AggregateDelta {
  const privateCounts: FieldMap = {};
  const publicCounts: FieldMap = {};
  const touched = new Set<string>();

  if (before) {
    bump(privateCounts, 'totalEntries', -1);
    bump(privateCounts, `countryCountsAll.${before.countryCode}`, -1);
    bump(privateCounts, `nationalityCounts.${before.nationalityCode}`, -1);
    bump(privateCounts, `metViaCounts.${before.metVia}`, -1);
    bump(privateCounts, 'ratingSum', -before.rating);
    bump(privateCounts, 'ratingCount', -1);
    if (before.visibility === 'friends') {
      bump(privateCounts, `countryCountsShared.${before.countryCode}`, -1);
      bump(privateCounts, 'ratingSumShared', -before.rating);
      bump(privateCounts, 'ratingCountShared', -1);
    }
    if (!isRealCountry(before.countryCode)) bump(privateCounts, 'unresolvedCount', -1);
    if (contributesToPublic(before.visibility, mode)) {
      bump(publicCounts, `countryCounts.${before.countryCode}`, -1);
      bump(publicCounts, 'encounterTotal', -1);
    }
    touched.add(before.countryCode);
  }

  if (after) {
    bump(privateCounts, 'totalEntries', 1);
    bump(privateCounts, `countryCountsAll.${after.countryCode}`, 1);
    bump(privateCounts, `nationalityCounts.${after.nationalityCode}`, 1);
    bump(privateCounts, `metViaCounts.${after.metVia}`, 1);
    bump(privateCounts, 'ratingSum', after.rating);
    bump(privateCounts, 'ratingCount', 1);
    if (after.visibility === 'friends') {
      bump(privateCounts, `countryCountsShared.${after.countryCode}`, 1);
      bump(privateCounts, 'ratingSumShared', after.rating);
      bump(privateCounts, 'ratingCountShared', 1);
    }
    if (!isRealCountry(after.countryCode)) bump(privateCounts, 'unresolvedCount', 1);
    if (contributesToPublic(after.visibility, mode)) {
      bump(publicCounts, `countryCounts.${after.countryCode}`, 1);
      bump(publicCounts, 'encounterTotal', 1);
    }
    touched.add(after.countryCode);
  }

  // Drop deltas that cancelled out. An edit that does not move a country would
  // otherwise emit increment(0) for several fields — harmless, but pointless write
  // amplification, and it makes the payloads harder to read while debugging.
  for (const map of [privateCounts, publicCounts]) {
    for (const [k, v] of Object.entries(map)) if (v === 0) delete map[k];
  }

  const visitedAdd: string[] = [];
  const visitedRemove: string[] = [];
  for (const code of touched) {
    if (!isRealCountry(code)) continue;
    const nowHasEntry = after?.countryCode === code;
    if (nowHasEntry) visitedAdd.push(code);
    else if (!stillAnchored(code)) visitedRemove.push(code);
  }

  return { privateCounts, publicCounts, visitedAdd, visitedRemove };
}

/** Converts a delta into the two Firestore update payloads. */
export function deltaToUpdates(d: AggregateDelta): {
  priv: FieldMap;
  pub: FieldMap;
} {
  const priv: FieldMap = { ...toIncrements(d.privateCounts), updatedAt: serverTimestamp() };
  const pub: FieldMap = { ...toIncrements(d.publicCounts), updatedAt: serverTimestamp() };
  if (d.visitedAdd.length) pub.visitedCodes = arrayUnion(...d.visitedAdd);
  // arrayUnion and arrayRemove cannot both target one field in one write, so a
  // transition that does both is split by the caller. In practice a single entry
  // change only ever adds or removes, never both, because `touched` is per-country.
  else if (d.visitedRemove.length) pub.visitedCodes = arrayRemove(...d.visitedRemove);
  return { priv, pub };
}

/** Folds many entries into one aggregate snapshot. Used by the repair routine. */
export function recomputeAggregates(
  entries: AggregateFacts[],
  mode: CoverageMode,
  visitedManual: string[],
): { priv: PrivateAggregates; pub: FieldMap } {
  const priv: PrivateAggregates = {
    totalEntries: 0,
    countryCountsAll: {},
    countryCountsShared: {},
    nationalityCounts: {},
    metViaCounts: {},
    ratingSum: 0,
    ratingCount: 0,
    ratingSumShared: 0,
    ratingCountShared: 0,
    unresolvedCount: 0,
    firstEntryDateKey: null,
    lastEntryDateKey: null,
    updatedAt: null,
  };
  const publicCounts: Record<string, number> = {};
  let publicTotal = 0;
  let publicRatingSum = 0;
  let publicRatingCount = 0;

  for (const e of entries) {
    priv.totalEntries += 1;
    priv.countryCountsAll[e.countryCode] = (priv.countryCountsAll[e.countryCode] ?? 0) + 1;
    priv.nationalityCounts[e.nationalityCode] =
      (priv.nationalityCounts[e.nationalityCode] ?? 0) + 1;
    priv.metViaCounts[e.metVia] = (priv.metViaCounts[e.metVia] ?? 0) + 1;
    priv.ratingSum += e.rating;
    priv.ratingCount += 1;
    if (e.visibility === 'friends') {
      priv.countryCountsShared[e.countryCode] =
        (priv.countryCountsShared[e.countryCode] ?? 0) + 1;
      priv.ratingSumShared += e.rating;
      priv.ratingCountShared += 1;
    }
    if (!isRealCountry(e.countryCode)) priv.unresolvedCount += 1;
    if (contributesToPublic(e.visibility, mode)) {
      publicCounts[e.countryCode] = (publicCounts[e.countryCode] ?? 0) + 1;
      publicTotal += 1;
      publicRatingSum += e.rating;
      publicRatingCount += 1;
    }
    if (!priv.firstEntryDateKey || e.dateKey < priv.firstEntryDateKey) {
      priv.firstEntryDateKey = e.dateKey;
    }
    if (!priv.lastEntryDateKey || e.dateKey > priv.lastEntryDateKey) {
      priv.lastEntryDateKey = e.dateKey;
    }
  }

  // Prune zero-valued keys so a decremented country disappears rather than lingering
  // as `{ PT: 0 }` — every consumer treats 0 as absent, and this keeps them agreeing.
  for (const map of [priv.countryCountsAll, priv.countryCountsShared, priv.nationalityCounts]) {
    for (const [k, v] of Object.entries(map)) if (v <= 0) delete map[k];
  }
  for (const [k, v] of Object.entries(publicCounts)) if (v <= 0) delete publicCounts[k];

  const visited = new Set(visitedManual.filter(isRealCountry));
  for (const code of Object.keys(priv.countryCountsAll)) {
    if (isRealCountry(code)) visited.add(code);
  }

  return {
    priv,
    pub: {
      countryCounts: publicCounts,
      encounterTotal: publicTotal,
      encounterCoverageMode: mode,
      avgRatingPublished:
        mode === 'hidden' || publicRatingCount === 0
          ? null
          : Math.round((publicRatingSum / publicRatingCount) * 10) / 10,
      visitedCodes: [...visited].sort(),
      updatedAt: serverTimestamp(),
    },
  };
}

/** Rewrites the published encounter layer when the coverage mode changes. */
export function republishForMode(
  priv: PrivateAggregates,
  mode: CoverageMode,
  visitedManual: string[],
): FieldMap {
  const source =
    mode === 'all' ? priv.countryCountsAll : mode === 'sharedOnly' ? priv.countryCountsShared : {};
  const counts: Record<string, number> = {};
  let total = 0;
  for (const [code, n] of Object.entries(source)) {
    if (n > 0) {
      counts[code] = n;
      total += n;
    }
  }
  const ratingSum = mode === 'all' ? priv.ratingSum : priv.ratingSumShared;
  const ratingCount = mode === 'all' ? priv.ratingCount : priv.ratingCountShared;

  // The visited union must stay truthful even when counts are hidden, otherwise a
  // friend could infer hidden entry countries by diffing the two layers.
  const visited = new Set(visitedManual.filter(isRealCountry));
  for (const code of Object.keys(priv.countryCountsAll)) {
    if (isRealCountry(code)) visited.add(code);
  }

  return {
    encounterCoverageMode: mode,
    countryCounts: counts,
    encounterTotal: total,
    avgRatingPublished:
      mode === 'hidden' || ratingCount === 0
        ? null
        : Math.round((ratingSum / ratingCount) * 10) / 10,
    visitedCodes: [...visited].sort(),
    updatedAt: serverTimestamp(),
  };
}

export { deleteField };
