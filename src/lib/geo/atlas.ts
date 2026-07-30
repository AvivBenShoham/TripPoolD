import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import topo110 from 'world-atlas/countries-110m.json';

export type CountryFeature = Feature<Geometry, { name?: string }>;

function toFeatures(topology: unknown): CountryFeature[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = topology as any;
  const fc = feature(t, t.objects.countries) as unknown as FeatureCollection<
    Geometry,
    { name?: string }
  >;
  return fc.features as CountryFeature[];
}

/**
 * Render resolution: 177 features, ~38 KB gzipped, ~32 ms to project. Measured as the
 * only resolution that stays smooth on a phone — the 50m atlas produces 1.4 MB of SVG
 * path strings, which mobile Safari does not enjoy.
 *
 * The cost is that 76 countries (Singapore, Hong Kong, Malta, Monaco, Maldives…) have
 * no polygon at this resolution. The map draws those as circle markers instead, so all
 * 250 countries stay visible and tappable — see WorldMap.tsx.
 */
export const RENDER_FEATURES: CountryFeature[] = toFeatures(topo110);

let geocodePromise: Promise<CountryFeature[]> | null = null;

/**
 * Geocoding resolution: 241 features, ~230 KB gzipped. Loaded lazily on first use —
 * only the location picker needs it — then cached for the session.
 *
 * At 110m a pin in Singapore resolves to Malaysia and Monaco to France, so the coarse
 * atlas is unusable for this job even though it is the right one for rendering.
 */
export async function loadGeocodeFeatures(): Promise<CountryFeature[]> {
  if (!geocodePromise) {
    geocodePromise = import('world-atlas/countries-50m.json').then((m) =>
      toFeatures(m.default ?? m),
    );
  }
  return geocodePromise;
}
