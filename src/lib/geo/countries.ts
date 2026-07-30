import data from '../../data/countries.json';
import { INTERNATIONAL_WATERS, UNRESOLVED } from '../../types';

export interface CountryInfo {
  cca2: string;
  ccn3: string | null;
  name: string;
  official: string;
  region: string;
  subregion: string;
  area: number;
  flag: string;
  /** Adjectival/demonym form — what the entry form shows as nationality. */
  demonym: string;
  lat: number;
  lng: number;
  independent: boolean;
  unMember: boolean;
}

export const COUNTRIES: CountryInfo[] = data.countries as CountryInfo[];

/**
 * The "% of world" denominator, frozen at generation time (UN member states).
 *
 * Deliberately NOT derived at runtime: the atlas has 177 renderable features and the
 * source package has 250 rows including territories, so deriving it would make every
 * user's coverage percentage jump the next time a dependency is bumped.
 */
export const WORLD_TOTAL: number = data.worldTotal;

export const BY_ALPHA2: Record<string, CountryInfo> = Object.fromEntries(
  COUNTRIES.map((c) => [c.cca2, c]),
);

/** TopoJSON feature.id (ISO numeric, zero-padded) -> alpha-2. */
export const ALPHA2_BY_NUMERIC: Record<string, string> = Object.fromEntries(
  COUNTRIES.filter((c) => c.ccn3).map((c) => [c.ccn3 as string, c.cca2]),
);

export const NUMERIC_BY_ALPHA2: Record<string, string> = Object.fromEntries(
  COUNTRIES.filter((c) => c.ccn3).map((c) => [c.cca2, c.ccn3 as string]),
);

/**
 * Natural Earth ships a few features with id -99 or null — the disputed and
 * partially-recognised entities. They are matched by their feature name instead, so
 * they can be shaded rather than silently vanishing from the map.
 */
export const TOPO_NAME_OVERRIDES: Record<string, string> = data.topoNameOverrides;

/** Six inhabited continents, for the "continents covered" stat. */
export const CONTINENTS = [
  'Africa',
  'Americas',
  'Asia',
  'Europe',
  'Oceania',
  'Antarctic',
] as const;

export function normaliseNumericId(id: string | number | null | undefined): string | null {
  if (id === null || id === undefined) return null;
  const s = String(id);
  if (s === '-99') return null;
  return s.padStart(3, '0');
}

/** Resolves a TopoJSON feature to an alpha-2 code, via numeric id then name. */
export function alpha2ForFeature(
  id: string | number | null | undefined,
  name?: string,
): string | null {
  const numeric = normaliseNumericId(id);
  if (numeric && ALPHA2_BY_NUMERIC[numeric]) return ALPHA2_BY_NUMERIC[numeric];
  if (name && TOPO_NAME_OVERRIDES[name]) return TOPO_NAME_OVERRIDES[name];
  return null;
}

export function countryName(code: string): string {
  if (code === UNRESOLVED) return 'Unknown';
  if (code === INTERNATIONAL_WATERS) return 'International waters';
  return BY_ALPHA2[code]?.name ?? code;
}

export function countryFlag(code: string): string {
  if (code === UNRESOLVED) return '🏳️';
  if (code === INTERNATIONAL_WATERS) return '🌊';
  return BY_ALPHA2[code]?.flag ?? '🏳️';
}

export function demonym(code: string): string {
  return BY_ALPHA2[code]?.demonym ?? countryName(code);
}

export function region(code: string): string {
  return BY_ALPHA2[code]?.region ?? 'Other';
}

/** A real country for coverage purposes — excludes the two sentinel codes. */
export function isRealCountry(code: string): boolean {
  return code !== UNRESOLVED && code !== INTERNATIONAL_WATERS && !!BY_ALPHA2[code];
}

/** Countries the 110m atlas cannot draw; the map renders these as dots instead. */
export function hasRenderableGeometry(code: string, renderableNumerics: Set<string>): boolean {
  const numeric = NUMERIC_BY_ALPHA2[code];
  return !!numeric && renderableNumerics.has(numeric);
}

/** Case-insensitive search over name, official name and code, for the picker. */
export function searchCountries(q: string, limit = 40): CountryInfo[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return COUNTRIES.slice(0, limit);
  const starts: CountryInfo[] = [];
  const contains: CountryInfo[] = [];
  for (const c of COUNTRIES) {
    const name = c.name.toLowerCase();
    if (name.startsWith(needle) || c.cca2.toLowerCase() === needle) starts.push(c);
    else if (name.includes(needle) || c.official.toLowerCase().includes(needle)) contains.push(c);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}
