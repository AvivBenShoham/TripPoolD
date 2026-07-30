// Generates src/data/countries.json — a trimmed projection of the `world-countries`
// package (1.4 MB, mostly translations we never render) down to the ~60 KB of fields
// this app actually uses. Committed to the repo so the runtime bundle never pulls the
// full dataset, and so a package bump can't silently change historical country labels.
//
// Run: npm run gen:countries
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import all from 'world-countries/countries.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../src/data/countries.json');

// Natural Earth ships a handful of features with no ISO numeric code (id === -99 or
// null). These are the disputed/partially-recognised entities. We map the ones that
// have a de-facto user-facing identity and leave the rest as unmapped geography.
const TOPO_NAME_OVERRIDES = {
  Kosovo: 'XK',
  'N. Cyprus': 'XN',
  Somaliland: 'XS',
};

const rows = all
  .map((c) => ({
    cca2: c.cca2,
    ccn3: c.ccn3 || null,
    name: c.name.common,
    official: c.name.official,
    region: c.region || 'Other',
    subregion: c.subregion || '',
    area: c.area || 0,
    flag: c.flag,
    // Demonym is what the entry form shows for nationality ("French", "Brazilian").
    // Prefer the masculine form: it is the adjectival form in English for every entry.
    demonym: c.demonyms?.eng?.m || c.name.common,
    lat: c.latlng?.[0] ?? 0,
    lng: c.latlng?.[1] ?? 0,
    independent: !!c.independent,
    unMember: !!c.unMember,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Entities world-countries doesn't carry but Natural Earth draws.
const extra = [
  { cca2: 'XK', ccn3: null, name: 'Kosovo', official: 'Republic of Kosovo', region: 'Europe', subregion: 'Southeast Europe', area: 10908, flag: '🇽🇰', demonym: 'Kosovan', lat: 42.6, lng: 20.9, independent: true, unMember: false },
];
for (const e of extra) if (!rows.some((r) => r.cca2 === e.cca2)) rows.push(e);
rows.sort((a, b) => a.name.localeCompare(b.name));

const payload = {
  // Frozen provenance. WORLD_TOTAL is the "% of world" denominator and must NOT be
  // derived at runtime: deriving it from the atlas (177 features) or from the package
  // (250 rows incl. territories) would make everyone's coverage % jump on a dep bump.
  generatedFrom: 'world-countries@5',
  worldTotal: rows.filter((r) => r.unMember).length,
  topoNameOverrides: TOPO_NAME_OVERRIDES,
  countries: rows,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload));
console.log(
  `wrote ${outPath}: ${rows.length} countries, worldTotal=${payload.worldTotal}, ` +
    `${(JSON.stringify(payload).length / 1024).toFixed(0)} KB`,
);
