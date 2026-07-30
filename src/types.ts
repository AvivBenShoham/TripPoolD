import type { Timestamp } from 'firebase/firestore';

export const SCHEMA_VERSION = 1;

export type Visibility = 'private' | 'friends';

/** How much of the encounter layer friends may see. Enforced at publish time. */
export type CoverageMode = 'hidden' | 'sharedOnly' | 'all';

export type CountryStatus = 'contains' | 'nearest' | 'manual' | 'unresolved';

export const MET_VIA = [
  'bar',
  'club',
  'dating_app',
  'street',
  'work',
  'friends',
  'travel',
  'gym',
  'other',
] as const;
export type MetVia = (typeof MET_VIA)[number];

export const MET_VIA_LABELS: Record<MetVia, string> = {
  bar: 'Bar',
  club: 'Club',
  dating_app: 'Dating app',
  street: 'Street',
  work: 'Work',
  friends: 'Through friends',
  travel: 'Travelling',
  gym: 'Gym',
  other: 'Other',
};

/** Sentinel country codes. Both are excluded from coverage and from the map. */
export const UNRESOLVED = 'XX';
export const INTERNATIONAL_WATERS = 'XZ';

export interface UserSettings {
  defaultVisibility: Visibility;
  encounterCoverageMode: CoverageMode;
  homeCountry: string | null;
}

export interface UserDoc {
  email: string;
  authProviders: string[];
  createdAt: Timestamp;
  usernameChangedAt: Timestamp | null;
  settings: UserSettings;
  /** Render-only mirror of /friendships. No security rule reads this. */
  friendUidsCache: string[];
  deletion: { requested: boolean; requestedAt: Timestamp | null; stage: string | null } | null;
  schemaVersion: number;
}

/** Readable by any signed-in user — must never carry anything sensitive. */
export interface PublicProfile {
  uid: string;
  username: string;
  usernameLower: string;
  displayName: string;
  displayNameLower: string;
  avatarThumb: string | null;
  avatarUrl: string | null;
  joinedAt: Timestamp;
  deleted: boolean;
  updatedAt: Timestamp;
}

export interface EntryLocation {
  lat: number;
  lng: number;
  label: string;
  source: 'pin' | 'manual';
  /** Set when the country came from the nearest-coastline snap rather than a hit. */
  accuracyKm: number | null;
}

export interface EntryPhoto {
  thumbDataUrl: string;
  w: number;
  h: number;
  bytes: number;
}

/** One document = one girl. The headline "amount" is simply the document count. */
export interface Encounter {
  ownerUid: string;
  visibility: Visibility;
  location: EntryLocation;

  countryCode: string;
  countryName: string;
  countryNumeric: string;
  continent: string;
  subregion: string;
  countryStatus: CountryStatus;

  nationalityCode: string;
  nationalityLabel: string;

  name: string;
  age: number | null;
  metVia: MetVia;
  metViaDetail: string | null;
  date: Timestamp;
  /** 'YYYY-MM-DD'. The grouping and range-filter key; immune to timezone drift. */
  dateKey: string;
  description: string;
  rating: number;
  tags: string[];

  photo: EntryPhoto | null;
  hasFullPhoto: boolean;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  schemaVersion: number;
}

export type EncounterWithId = Encounter & { id: string };

export interface PrivateAggregates {
  totalEntries: number;
  countryCountsAll: Record<string, number>;
  countryCountsShared: Record<string, number>;
  nationalityCounts: Record<string, number>;
  metViaCounts: Record<string, number>;
  ratingSum: number;
  ratingCount: number;
  ratingSumShared: number;
  ratingCountShared: number;
  unresolvedCount: number;
  firstEntryDateKey: string | null;
  lastEntryDateKey: string | null;
  updatedAt: Timestamp | null;
}

export interface VisitedManualEntry {
  firstVisit: Timestamp | null;
  lastVisit: Timestamp | null;
  note: string | null;
}

/** The one document that backs a friend's entire map + stats view. */
export interface PublicAggregates {
  /** Layer 1: countries visited with no entry attached. Always friend-visible. */
  visitedManual: Record<string, VisitedManualEntry>;
  /** Denormalised union of visitedManual and entry countries. */
  visitedCodes: string[];

  /** Layer 2: encounter coverage, already filtered to what the mode permits. */
  encounterCoverageMode: CoverageMode;
  countryCounts: Record<string, number>;
  encounterTotal: number;
  avgRatingPublished: number | null;

  updatedAt: Timestamp | null;
}

export interface Friendship {
  uids: [string, string];
  initiatorUid: string;
  createdAt: Timestamp;
}

export type FriendRequestStatus = 'pending' | 'declined';

export interface FriendRequest {
  fromUid: string;
  toUid: string;
  status: FriendRequestStatus;
  createdAt: Timestamp;
  respondedAt: Timestamp | null;
  message: string | null;
  fromUsername: string;
  fromDisplayName: string;
  fromAvatarThumb: string | null;
}

export type FriendRequestWithId = FriendRequest & { id: string };

export const EMPTY_PRIVATE_AGGREGATES: PrivateAggregates = {
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

export const EMPTY_PUBLIC_AGGREGATES: PublicAggregates = {
  visitedManual: {},
  visitedCodes: [],
  encounterCoverageMode: 'sharedOnly',
  countryCounts: {},
  encounterTotal: 0,
  avgRatingPublished: null,
  updatedAt: null,
};
