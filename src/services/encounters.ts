import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, LIMITS } from '../lib/firebase';
import {
  aggregateDelta,
  deltaToUpdates,
  factsOf,
  recomputeAggregates,
  type AggregateFacts,
} from '../lib/aggregates/delta';
import {
  EMPTY_PRIVATE_AGGREGATES,
  EMPTY_PUBLIC_AGGREGATES,
  SCHEMA_VERSION,
  type CoverageMode,
  type Encounter,
  type EncounterWithId,
  type PrivateAggregates,
  type PublicAggregates,
} from '../types';
import { dayToTimestamp } from '../lib/format';
import { isRealCountry } from '../lib/geo/countries';

export function encountersCol(uid: string) {
  return collection(db, 'users', uid, 'encounters');
}

export function entryRef(uid: string, entryId: string) {
  return doc(db, 'users', uid, 'encounters', entryId);
}

export function mediaRef(uid: string, entryId: string) {
  return doc(db, 'users', uid, 'encounters', entryId, 'media', 'full');
}

export function privateAggRef(uid: string) {
  return doc(db, 'users', uid, 'aggregates', 'private');
}

export function publicAggRef(uid: string) {
  return doc(db, 'users', uid, 'aggregates', 'public');
}

/**
 * Creates the two aggregate documents if they are missing.
 *
 * Onboarding seeds them, so this is a self-heal for accounts created before that existed
 * (and for seeded test data). It matters because every aggregate write is an `update`,
 * which fails outright on a missing document rather than creating one.
 */
export async function ensureAggregates(uid: string): Promise<void> {
  const [privSnap, pubSnap] = await Promise.all([
    getDoc(privateAggRef(uid)),
    getDoc(publicAggRef(uid)),
  ]);
  if (privSnap.exists() && pubSnap.exists()) return;

  const batch = writeBatch(db);
  if (!privSnap.exists()) {
    batch.set(privateAggRef(uid), { ...EMPTY_PRIVATE_AGGREGATES, updatedAt: serverTimestamp() });
  }
  if (!pubSnap.exists()) {
    batch.set(publicAggRef(uid), { ...EMPTY_PUBLIC_AGGREGATES, updatedAt: serverTimestamp() });
  }
  await batch.commit();
}

/** Live subscription to my own log. The owner rule branch needs no query constraint. */
export function watchMyEntries(
  uid: string,
  onData: (entries: EncounterWithId[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(encountersCol(uid), orderBy('date', 'desc')),
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Encounter) }))),
    onError,
  );
}

export function watchPrivateAggregates(
  uid: string,
  onData: (agg: PrivateAggregates) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    privateAggRef(uid),
    (snap) =>
      onData(
        snap.exists()
          ? { ...EMPTY_PRIVATE_AGGREGATES, ...(snap.data() as PrivateAggregates) }
          : EMPTY_PRIVATE_AGGREGATES,
      ),
    onError,
  );
}

export function watchPublicAggregates(
  uid: string,
  onData: (agg: PublicAggregates) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    publicAggRef(uid),
    (snap) =>
      onData(
        snap.exists()
          ? { ...EMPTY_PUBLIC_AGGREGATES, ...(snap.data() as PublicAggregates) }
          : EMPTY_PUBLIC_AGGREGATES,
      ),
    onError,
  );
}

/**
 * A friend's shareable log.
 *
 * The `visibility` filter is NOT a convenience. The rules' friend branch requires
 * `resource.data.visibility == 'friends'`, and Firestore only admits a query it can
 * statically prove satisfies the rule — so dropping this where() clause does not return
 * fewer results, it rejects the entire query with permission-denied.
 */
export async function getFriendEntries(
  friendUid: string,
  max = 50,
): Promise<EncounterWithId[]> {
  const snap = await getDocs(
    query(
      encountersCol(friendUid),
      where('visibility', '==', 'friends'),
      orderBy('date', 'desc'),
      qLimit(max),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Encounter) }));
}

/** A friend's recent activity, for the feed. Same rule, tighter limit. */
export async function getFriendRecent(friendUid: string, max = 3): Promise<EncounterWithId[]> {
  const snap = await getDocs(
    query(
      encountersCol(friendUid),
      where('visibility', '==', 'friends'),
      orderBy('createdAt', 'desc'),
      qLimit(max),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Encounter) }));
}

export async function getFriendPublicAggregates(
  friendUid: string,
): Promise<PublicAggregates | null> {
  const snap = await getDoc(publicAggRef(friendUid));
  if (!snap.exists()) return null;
  return { ...EMPTY_PUBLIC_AGGREGATES, ...(snap.data() as PublicAggregates) };
}

export async function getFullPhoto(uid: string, entryId: string): Promise<string | null> {
  const snap = await getDoc(mediaRef(uid, entryId));
  return snap.exists() ? ((snap.data() as { dataUrl: string }).dataUrl ?? null) : null;
}

export interface EntryInput {
  visibility: 'private' | 'friends';
  lat: number;
  lng: number;
  placeLabel: string;
  locationSource: 'pin' | 'manual';
  accuracyKm: number | null;
  countryCode: string;
  countryName: string;
  countryNumeric: string;
  continent: string;
  subregion: string;
  countryStatus: Encounter['countryStatus'];
  nationalityCode: string;
  nationalityLabel: string;
  name: string;
  age: number | null;
  metVia: Encounter['metVia'];
  metViaDetail: string | null;
  dateKey: string;
  description: string;
  rating: number;
  tags: string[];
  photo: { thumbDataUrl: string; fullDataUrl: string; w: number; h: number; bytes: number } | null;
  /** True when editing and the existing photo should be kept as-is. */
  keepExistingPhoto?: boolean;
}

/**
 * Client-side mirror of the rules' validEntry(). Rules are not evaluated locally, so an
 * offline write that violates them is accepted into the cache, renders optimistically,
 * and is silently reverted on reaching the server. Validating here turns that into an
 * immediate, explainable error.
 */
export function validateEntry(input: EntryInput): string | null {
  if (!input.name.trim()) return 'A name or nickname is required.';
  if (input.name.trim().length > 60) return 'Name must be 60 characters or fewer.';
  if (!/^[A-Z]{2}$/.test(input.countryCode)) return 'Pick a country.';
  if (input.countryStatus === 'unresolved' && !isRealCountry(input.countryCode)) {
    return 'That pin is not on land — pick the country manually.';
  }
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 10) {
    return 'Rating must be a whole number from 1 to 10.';
  }
  if (input.age !== null && (!Number.isInteger(input.age) || input.age < 18 || input.age > 99)) {
    return 'Age must be a whole number between 18 and 99.';
  }
  if (input.description.length > 2000) return 'Description must be 2000 characters or fewer.';
  if (input.tags.length > 12) return 'At most 12 tags.';
  if (input.tags.join('|').length > 300) return 'Those tags are too long in total.';
  if (input.placeLabel.length > 160) return 'Place name must be 160 characters or fewer.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateKey)) return 'Pick a valid date.';
  if (input.lat < -90 || input.lat > 90 || input.lng < -180 || input.lng > 180) {
    return 'That location is out of range.';
  }
  if (input.photo && input.photo.thumbDataUrl.length > LIMITS.thumbChars) {
    return 'That photo thumbnail is too large.';
  }
  if (input.photo && input.photo.fullDataUrl.length > LIMITS.fullPhotoChars) {
    return 'That photo is too large to store.';
  }
  return null;
}

function toDocument(input: EntryInput, uid: string, existing?: Encounter): Record<string, unknown> {
  const photo = input.photo
    ? {
        thumbDataUrl: input.photo.thumbDataUrl,
        w: input.photo.w,
        h: input.photo.h,
        bytes: input.photo.bytes,
      }
    : input.keepExistingPhoto
      ? (existing?.photo ?? null)
      : null;

  return {
    ownerUid: uid,
    visibility: input.visibility,
    location: {
      lat: input.lat,
      lng: input.lng,
      label: input.placeLabel.trim(),
      source: input.locationSource,
      accuracyKm: input.accuracyKm,
    },
    countryCode: input.countryCode,
    countryName: input.countryName,
    countryNumeric: input.countryNumeric,
    continent: input.continent,
    subregion: input.subregion,
    countryStatus: input.countryStatus,
    nationalityCode: input.nationalityCode,
    nationalityLabel: input.nationalityLabel,
    name: input.name.trim(),
    age: input.age,
    metVia: input.metVia,
    metViaDetail: input.metViaDetail?.trim() || null,
    date: dayToTimestamp(input.dateKey),
    dateKey: input.dateKey,
    description: input.description.trim(),
    rating: input.rating,
    tags: input.tags,
    photo,
    hasFullPhoto: input.photo
      ? true
      : input.keepExistingPhoto
        ? (existing?.hasFullPhoto ?? false)
        : false,
    createdAt: existing?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
    schemaVersion: SCHEMA_VERSION,
  };
}

/** Is a country still held by some other entry, or by a manual visited mark? */
function anchorFn(
  priv: PrivateAggregates,
  pub: PublicAggregates,
  excludingCode: string | null,
): (code: string) => boolean {
  return (code: string) => {
    if (pub.visitedManual[code]) return true;
    const n = priv.countryCountsAll[code] ?? 0;
    return code === excludingCode ? n > 1 : n > 0;
  };
}

/**
 * Creates an entry and its aggregates in ONE atomic batch, so the counters can never
 * disagree with the entry list because of a half-applied write.
 */
export async function createEntry(
  uid: string,
  input: EntryInput,
  priv: PrivateAggregates,
  pub: PublicAggregates,
  mode: CoverageMode,
): Promise<string> {
  const problem = validateEntry(input);
  if (problem) throw new Error(problem);

  const ref = doc(encountersCol(uid));
  const payload = toDocument(input, uid);
  const facts: AggregateFacts = {
    countryCode: input.countryCode,
    nationalityCode: input.nationalityCode,
    metVia: input.metVia,
    rating: input.rating,
    visibility: input.visibility,
    dateKey: input.dateKey,
  };

  const delta = aggregateDelta(null, facts, mode, anchorFn(priv, pub, null));
  const { priv: privUpdate, pub: pubUpdate } = deltaToUpdates(delta);

  const batch = writeBatch(db);
  batch.set(ref, payload);
  if (input.photo) {
    batch.set(mediaRef(uid, ref.id), {
      dataUrl: input.photo.fullDataUrl,
      w: input.photo.w,
      h: input.photo.h,
      bytes: input.photo.bytes,
      mime: 'image/jpeg',
      createdAt: serverTimestamp(),
    });
  }
  // update(), not set(merge:true): only update() interprets 'countryCountsAll.PT' as a
  // nested field path. Through set() it would become a literal field name containing a
  // dot, which the rules reject and which would corrupt the shape of the map.
  batch.update(privateAggRef(uid), extendDateKeys(privUpdate, priv, input.dateKey));
  batch.update(publicAggRef(uid), { ...pubUpdate, encounterCoverageMode: mode });
  await batch.commit();
  return ref.id;
}

/** Widens firstEntryDateKey / lastEntryDateKey without needing a read. */
function extendDateKeys(
  update: Record<string, unknown>,
  priv: PrivateAggregates,
  dateKey: string,
): Record<string, unknown> {
  const out = { ...update };
  if (!priv.firstEntryDateKey || dateKey < priv.firstEntryDateKey) out.firstEntryDateKey = dateKey;
  if (!priv.lastEntryDateKey || dateKey > priv.lastEntryDateKey) out.lastEntryDateKey = dateKey;
  return out;
}

export async function updateEntry(
  uid: string,
  entryId: string,
  existing: Encounter,
  input: EntryInput,
  priv: PrivateAggregates,
  pub: PublicAggregates,
  mode: CoverageMode,
): Promise<void> {
  const problem = validateEntry(input);
  if (problem) throw new Error(problem);

  const facts: AggregateFacts = {
    countryCode: input.countryCode,
    nationalityCode: input.nationalityCode,
    metVia: input.metVia,
    rating: input.rating,
    visibility: input.visibility,
    dateKey: input.dateKey,
  };
  const delta = aggregateDelta(
    factsOf(existing),
    facts,
    mode,
    anchorFn(priv, pub, existing.countryCode),
  );
  const { priv: privUpdate, pub: pubUpdate } = deltaToUpdates(delta);

  const batch = writeBatch(db);
  batch.set(entryRef(uid, entryId), toDocument(input, uid, existing));
  if (input.photo) {
    batch.set(mediaRef(uid, entryId), {
      dataUrl: input.photo.fullDataUrl,
      w: input.photo.w,
      h: input.photo.h,
      bytes: input.photo.bytes,
      mime: 'image/jpeg',
      createdAt: serverTimestamp(),
    });
  } else if (!input.keepExistingPhoto && existing.hasFullPhoto) {
    batch.delete(mediaRef(uid, entryId));
  }
  batch.update(privateAggRef(uid), extendDateKeys(privUpdate, priv, input.dateKey));
  batch.update(publicAggRef(uid), { ...pubUpdate, encounterCoverageMode: mode });
  await batch.commit();
}

export async function deleteEntry(
  uid: string,
  entryId: string,
  existing: Encounter,
  priv: PrivateAggregates,
  pub: PublicAggregates,
  mode: CoverageMode,
): Promise<void> {
  const delta = aggregateDelta(
    factsOf(existing),
    null,
    mode,
    anchorFn(priv, pub, existing.countryCode),
  );
  const { priv: privUpdate, pub: pubUpdate } = deltaToUpdates(delta);

  const batch = writeBatch(db);
  if (existing.hasFullPhoto) batch.delete(mediaRef(uid, entryId));
  batch.delete(entryRef(uid, entryId));
  batch.update(privateAggRef(uid), privUpdate);
  batch.update(publicAggRef(uid), pubUpdate);
  await batch.commit();
}

/**
 * Self-healing repair: recompute both aggregate documents from the full entry list.
 *
 * This is option (b) — compute from source — kept as a deliberate, user-invokable
 * action rather than the read path. It uses the same pure fold as the write path, so a
 * repair can never introduce a different opinion about the numbers.
 */
export async function repairAggregates(
  uid: string,
  entries: EncounterWithId[],
  pub: PublicAggregates,
  mode: CoverageMode,
): Promise<void> {
  const facts = entries.map(factsOf);
  const { priv, pub: pubFields } = recomputeAggregates(
    facts,
    mode,
    Object.keys(pub.visitedManual),
  );
  const batch = writeBatch(db);
  batch.set(
    privateAggRef(uid),
    { ...priv, updatedAt: serverTimestamp() },
    { merge: false },
  );
  batch.set(publicAggRef(uid), { ...pub, ...pubFields }, { merge: false });
  await batch.commit();
}

/** Does the stored aggregate disagree with the entry list we can see? */
export function aggregatesLookStale(
  entries: EncounterWithId[],
  priv: PrivateAggregates,
): boolean {
  if (entries.length !== priv.totalEntries) return true;
  const counts: Record<string, number> = {};
  for (const e of entries) counts[e.countryCode] = (counts[e.countryCode] ?? 0) + 1;
  for (const [code, n] of Object.entries(counts)) {
    if ((priv.countryCountsAll[code] ?? 0) !== n) return true;
  }
  return false;
}

/** Marks a country visited with no entry attached — coverage layer one. */
export async function setCountryVisited(
  uid: string,
  code: string,
  visited: boolean,
  priv: PrivateAggregates,
  note: string | null = null,
): Promise<void> {
  if (!isRealCountry(code)) throw new Error('That is not a country that can be marked visited.');
  const hasEntries = (priv.countryCountsAll[code] ?? 0) > 0;

  if (visited) {
    await updateDoc(publicAggRef(uid), {
      [`visitedManual.${code}`]: { firstVisit: null, lastVisit: null, note },
      updatedAt: serverTimestamp(),
    });
    // arrayUnion cannot share a write with a dotted-path set on the same field, so the
    // union is a second, idempotent update rather than part of the set above.
    await updateDoc(publicAggRef(uid), {
      visitedCodes: arrayUnion(code),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  await updateDoc(publicAggRef(uid), {
    [`visitedManual.${code}`]: deleteField(),
    updatedAt: serverTimestamp(),
  });
  // Only drop it from the union if no entry still anchors the country — otherwise
  // un-marking a country would wrongly hide one that still holds entries.
  if (!hasEntries) {
    await updateDoc(publicAggRef(uid), {
      visitedCodes: arrayRemove(code),
      updatedAt: serverTimestamp(),
    });
  }
}
