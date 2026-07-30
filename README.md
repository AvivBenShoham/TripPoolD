# PoolD

A mobile web app, sized for an iPhone, that turns your travels into a personal world map —
in the spirit of Polarsteps. Log the places you have been and the people you met there,
each with a pin, a country, a nationality, a date, your own notes, a 1–10 rating and a
photo. On top of that sits world-coverage tracking, stats and achievements, and a friend
graph so people who accept each other can compare maps.

Everything is private by default. Nothing is visible to anyone until you accept them as a
friend, and each entry has its own visibility switch on top of that.

Built with React 19 + TypeScript + Vite, Tailwind v4, and Firebase (Auth + Firestore).

**Live:** https://avivbenshoham.github.io/TripPoolD/

## Two coverage layers

The map deliberately tracks two different things:

1. **Countries visited** — mark any country as "been there" with nothing else attached.
   This is the Polarsteps-style travel map, and it stands on its own.
2. **Countries with entries** — shaded by how many, on top of the visited layer.

A country with an entry counts as visited automatically; the reverse is not true. A
segmented control on the map switches between *All*, *Visited* and *Logged*.

## Before it will run against your Firebase project

The project (`appdef-45ad0`) needs a few things set up by its owner before sign-in and data
will work:

1. **Firebase console → Authentication → Sign-in method**: enable **Email/Password** and
   **Google**.
2. **Firebase console → Firestore Database → Create database.** If it asks for a Database
   ID, leave it as `(default)` — do not give it a custom name. Everything in this app
   (client SDK, `firebase.json`, the deploy workflow) assumes the default database; a
   custom-named one will silently fail every read and write with a permission error that
   looks identical to the rules never having deployed. Pick a region and start in
   production mode — the rules in this repo are the real ones and are meant to replace the
   defaults immediately.
3. Deploy the rules and indexes:
   ```bash
   npx firebase login
   npx firebase deploy --only firestore:rules,firestore:indexes
   ```
   Confirm it actually deployed: **Firestore Database → Rules tab** in the console should
   show the real rules (starting `rules_version = '2';` with a "PoolD security rules"
   comment), not the stock `allow read, write: if false;`.
4. **Authentication → Settings → Authorized domains**: add `avivbenshoham.github.io`.
   Without it Google sign-in fails on the deployed site (email/password still works).

### If it hangs after sign-in, or says "could not load your data"

Signing in works but nothing after it does → almost always **step 2**, specifically the
Database ID. Auth and Firestore are provisioned independently, and a Firestore database
created under any ID other than `(default)` looks, from the app's perspective, exactly like
no database existing at all: every read is refused with a permission error, because the
`(default)` database the app talks to is empty and rule-less. The app bounds these reads
and reports the failure rather than hanging forever, but the fix is still step 2 — check
the Database ID shown in the console matches `(default)` exactly.

Google sign-in fails on the deployed site while email/password works → step 4. Authorized
domains only gate OAuth popups and redirects, not password sign-in.

The `apiKey` in `src/lib/firebaseConfig.ts` is not a secret — it identifies the project and
is visible in the bundle of every Firebase web app. All real protection comes from
`firestore.rules`. If you later want to restrict which origins may use the key, that is
what [App Check](https://firebase.google.com/docs/app-check) is for.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages automatically via
`.github/workflows/deploy-pages.yml`, which lands at
**https://avivbenshoham.github.io/TripPoolD/**. You can also trigger it by hand from the
Actions tab on any branch. The workflow gates the deploy on `npm run typecheck` and
`npm test`; the security-rules suite is left out because it needs the Java-backed Firestore
emulator and would roughly triple the job time.

Three things make a project page work, and all three are already wired up:

- **Sub-path.** A project site is served from `/TripPoolD/`, not the root, so the workflow
  builds with `BASE_PATH=/TripPoolD/` and the router uses `basename={import.meta.env.BASE_URL}`.
- **Deep links.** GitHub Pages has no rewrite rules, so `scripts/postbuild.mjs` copies
  `dist/index.html` to `dist/404.html`. Pages serves that for any unknown path and the app
  boots and routes normally.
- **Manifest.** `public/manifest.webmanifest` uses relative URLs, which resolve against the
  manifest's own location — so installing to the home screen works under any base path
  without templating.

**One-time setup:** Pages has to be switched on by the repository owner before the first
deploy can succeed — under **Settings → Pages → Build and deployment → Source: GitHub
Actions**. A workflow cannot do this for you: creating a Pages site is not something the
`GITHUB_TOKEN` is permitted to do, even with `pages: write`. Once it is on, re-run the
workflow from the Actions tab (or push anything to `main`) and it deploys.

To host on Firebase instead, `npm run build && npx firebase deploy --only hosting` still
works — `firebase.json` is configured, and the root-served build needs no `BASE_PATH`.

## Local development

Everything works against the Firebase Emulator Suite, so you can run and test the whole app
without touching the console. The Firestore emulator needs a JRE.

```bash
npm install

# terminal 1 — Auth + Firestore emulators
npm run emu

# terminal 2 — the app
npm run dev
```

Then open http://127.0.0.1:5173. When served from localhost the app automatically uses the
emulators, so a dev server or test run can never reach the real project by accident. To
check the real backend from a local build instead, append `?prod=1` to the URL (that will
fail until the console steps above are done).

## Verifying

```bash
npm run typecheck    # tsc, no emit
npm test             # geo + coverage unit tests (31 cases)
npm run test:rules   # security rules against the Firestore emulator (52 cases)
npm run e2e          # full user journey at 390x844, writes screenshots/
```

`npm test` locks in the reverse-geocoding table (Paris→FR, Monaco→MC, Hong Kong→HK, a point
offshore of Copacabana→BR, mid-Atlantic→unresolved) so a dependency bump cannot silently
degrade it. `npm run test:rules` covers the access paths that matter: a stranger cannot read
your entries, a friend sees only entries you marked visible to friends, a friendship cannot
be forged, and usernames are unique by construction.

## How the data is laid out

| Path | What | Who can read it |
|---|---|---|
| `users/{uid}` | private profile and settings | owner only |
| `users/{uid}/encounters/{id}` | a log entry, plus a small thumbnail | owner; friends **iff** `visibility == 'friends'` |
| `users/{uid}/encounters/{id}/media/full` | the full-size photo | same as its parent entry |
| `users/{uid}/aggregates/private` | every counter, including private entries | owner only |
| `users/{uid}/aggregates/public` | visited countries + published counts | owner and accepted friends |
| `publicProfiles/{uid}` | username, display name, avatar — nothing else | any signed-in user |
| `usernames/{handle}` | uniqueness claim | by id only |
| `friendships/{a__b}` | one document per mutual friendship | the two participants |
| `friendRequests/{from__to}` | pending or declined request | sender and recipient |

Entries live in a subcollection under their owner so the document path itself proves
ownership — no field has to be trusted.

### Why there are two aggregate documents

A friend needs to render your map without reading entries they are not allowed to see. So
`aggregates/public` holds only what you have chosen to publish, and `aggregates/private`
holds everything. The gate is applied **when writing**, not when reading, which means the
friend-readable document never contains data a friend should not see — the rules stay
structural instead of hinging on a single boolean at read time.

Settings → *What friends see in your counts* controls it:

- **Hidden** — friends see only which countries you visited, never how many entries. Your
  visited list still includes countries where you have entries, so nothing is inferable
  from a gap.
- **Shared entries only** (default) — counts derived from entries marked visible to
  friends. They could reconstruct these from those entries anyway.
- **All entries** — counts include private entries. Friends see how many and where, never
  any of the entry content.

Which countries you have visited is always visible to friends.

### Aggregates without Cloud Functions

No Blaze plan means no Cloud Functions, so the counters are maintained by the client in the
**same `writeBatch` as the entry** — atomic, with no window in which they disagree.
`src/lib/aggregates/delta.ts` is the single source of truth for the arithmetic and is used
by the create, edit, delete *and* repair paths, so they cannot form different opinions.
Rules bound the shape of these numbers but cannot verify them, so the app also compares the
stored total against the entry list on load and offers a one-tap recompute if they drift.

### Security rules and queries are a matched pair

Firestore rejects a query it cannot statically prove satisfies the rules — it does not
quietly return fewer rows. So reading a friend's log **must** carry the same constraint the
rule demands:

```ts
query(collection(db, 'users', friendUid, 'encounters'),
      where('visibility', '==', 'friends'),   // required, not an optimisation
      orderBy('date', 'desc'), limit(20))
```

Drop that `where` and the whole query fails with `permission-denied`. There is a test for
exactly this.

## Geo, offline

There is no geocoding API call anywhere — partly because none was reachable when this was
built, mostly because sending these coordinates to a third party would defeat the point.
Pin → country resolution runs locally against bundled Natural Earth data:

- **Rendering** uses `countries-110m` (~38 KB gzipped, 177 paths). It is the only
  resolution that stays smooth on a phone; the 50m atlas produces 1.4 MB of SVG path data.
- The ~76 countries with no polygon at that resolution — Singapore, Hong Kong, Malta,
  Monaco, the Maldives, Andorra, Mauritius — are drawn as **circle markers** so all 250
  countries remain visible and tappable.
- **Reverse geocoding** lazily loads `countries-50m` on first use, then: polygon hit-test →
  nearest-coastline snap within 120 km → "that pin is at sea, pick a country". The snap
  matters more than it sounds: even at 50m, a beach pin in Copacabana or Miami Beach lands
  offshore, and a centroid-based fallback puts it in the wrong country entirely.
- Measured 23/24 on a table of real locations. The one miss is Vatican City resolving to
  Italy, which the manual country override covers.
- `WORLD_TOTAL` (the "% of world" denominator) is frozen at generation time rather than
  derived at runtime, so upgrading a dependency cannot move everyone's coverage percentage.

`src/data/countries.json` is generated from `world-countries` by `npm run gen:countries`,
trimmed from 1.4 MB to ~58 KB. It also supplies the demonyms ("French", "Brazilian") used
for nationality labels.

## Photos

Cloud Storage requires the paid Blaze plan on new Firebase projects, so photos are resized
in the browser and stored in Firestore: a ~320px thumbnail denormalised onto the entry for
list and map rendering, and a larger version in a separate `media/full` document fetched
only when you open the entry. A quality/size ladder guarantees it fits the 1 MiB document
limit, and the canvas round-trip strips EXIF — including the GPS tags an iPhone embeds.

Swapping to Cloud Storage later means changing `src/lib/image.ts` and the two media call
sites in `src/services/encounters.ts`.

## Install it on a phone

It ships a web manifest and iOS meta tags, so **Share → Add to Home Screen** in Safari gives
a standalone app with no browser chrome. Firestore's persistent cache keeps the map and log
readable offline, and queues writes until you are back online.
