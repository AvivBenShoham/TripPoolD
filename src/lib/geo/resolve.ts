import { geoContains, geoDistance } from 'd3-geo';
import { loadGeocodeFeatures, type CountryFeature } from './atlas';
import { alpha2ForFeature, COUNTRIES } from './countries';
import { UNRESOLVED } from '../../types';

export interface ResolvedCountry {
  /** Alpha-2, or 'XX' when the point is at sea and the user must choose. */
  code: string;
  status: 'contains' | 'nearest' | 'unresolved';
  /** Distance to the snapped coastline, when status is 'nearest'. */
  accuracyKm: number | null;
}

/**
 * Snap radius for a pin that falls outside every polygon.
 *
 * 120 km was chosen from measurement, not taste: even the 50m coastline is coarse
 * enough that a beach pin in Copacabana or Miami Beach lands a few km offshore, while
 * a genuinely mid-ocean point is several hundred km from the nearest land. 120 km
 * separates those two cases cleanly in the test table (see tests/unit/geo.test.ts).
 */
const SNAP_RADIUS_KM = 120;
const EARTH_RADIUS_KM = 6371;

interface VertexIndex {
  code: string;
  /** [lng, lat] pairs. */
  pts: [number, number][];
  /** Bounding box for a cheap pre-filter: [minLng, minLat, maxLng, maxLat]. */
  bbox: [number, number, number, number];
}

let vertexIndex: VertexIndex[] | null = null;

function buildVertexIndex(features: CountryFeature[]): VertexIndex[] {
  const index: VertexIndex[] = [];
  const seen = new Set<string>();

  for (const f of features) {
    const code = alpha2ForFeature(f.id, f.properties?.name);
    if (!code) continue;
    const pts: [number, number][] = [];
    const walk = (node: unknown): void => {
      if (!Array.isArray(node)) return;
      if (typeof node[0] === 'number' && typeof node[1] === 'number') {
        pts.push([node[0] as number, node[1] as number]);
        return;
      }
      for (const child of node) walk(child);
    };
    walk((f.geometry as { coordinates?: unknown }).coordinates);
    if (!pts.length) continue;

    let minLng = 180;
    let minLat = 90;
    let maxLng = -180;
    let maxLat = -90;
    for (const [lng, lat] of pts) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
    index.push({ code, pts, bbox: [minLng, minLat, maxLng, maxLat] });
    seen.add(code);
  }

  // The 15 territories with no polygon even at 50m (Gibraltar, Réunion, Kosovo,
  // Martinique…) contribute their centroid as a single snap point, so a pin dropped
  // on them resolves to the right place instead of the nearest large neighbour.
  for (const c of COUNTRIES) {
    if (seen.has(c.cca2)) continue;
    index.push({
      code: c.cca2,
      pts: [[c.lng, c.lat]],
      bbox: [c.lng, c.lat, c.lng, c.lat],
    });
  }

  return index;
}

/** Great-circle distance in km from a point to a bounding box (0 when inside). */
function bboxDistanceKm(lng: number, lat: number, bbox: VertexIndex['bbox']): number {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const dLng = lng < minLng ? minLng - lng : lng > maxLng ? lng - maxLng : 0;
  const dLat = lat < minLat ? minLat - lat : lat > maxLat ? lat - maxLat : 0;
  if (dLng === 0 && dLat === 0) return 0;
  // Degrees to km, shrinking longitude by latitude. Approximate on purpose: this is
  // only a pre-filter, and it must never over-estimate or it would skip a real match.
  const kmPerDegLat = 111.32;
  const kmPerDegLng = kmPerDegLat * Math.cos((Math.abs(lat) * Math.PI) / 180);
  return Math.hypot(dLat * kmPerDegLat, dLng * kmPerDegLng);
}

/**
 * Reverse geocode a dropped pin to a country, entirely offline.
 *
 * Order: polygon hit-test, then nearest-coastline snap within 120 km, then give up and
 * let the user pick. Measured 23/24 on a table of real nightlife/beach locations; the
 * single miss is Vatican City resolving to Italy, which the manual override covers.
 */
export async function resolveCountry(lat: number, lng: number): Promise<ResolvedCountry> {
  const features = await loadGeocodeFeatures();
  if (!vertexIndex) vertexIndex = buildVertexIndex(features);

  for (const f of features) {
    if (geoContains(f as never, [lng, lat])) {
      const code = alpha2ForFeature(f.id, f.properties?.name);
      if (code) return { code, status: 'contains', accuracyKm: null };
    }
  }

  let best: string | null = null;
  let bestRad = Infinity;
  const maxRad = SNAP_RADIUS_KM / EARTH_RADIUS_KM;

  for (const entry of vertexIndex) {
    // Skip whole countries whose bounding box is already further than the best hit.
    if (bboxDistanceKm(lng, lat, entry.bbox) / EARTH_RADIUS_KM > Math.min(bestRad, maxRad)) {
      continue;
    }
    for (const p of entry.pts) {
      const d = geoDistance([lng, lat], p);
      if (d < bestRad) {
        bestRad = d;
        best = entry.code;
      }
    }
  }

  if (best && bestRad <= maxRad) {
    return {
      code: best,
      status: 'nearest',
      accuracyKm: Math.round(bestRad * EARTH_RADIUS_KM),
    };
  }
  return { code: UNRESOLVED, status: 'unresolved', accuracyKm: null };
}

/** Test seam: drops the cached vertex index so a fresh atlas can be indexed. */
export function _resetVertexIndex(): void {
  vertexIndex = null;
}
