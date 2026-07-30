import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthProvider';
import {
  aggregatesLookStale,
  ensureAggregates,
  repairAggregates,
  watchMyEntries,
  watchPrivateAggregates,
  watchPublicAggregates,
} from '../services/encounters';
import { watchFriendships, watchIncomingRequests, watchOutgoingRequests } from '../services/friends';
import {
  EMPTY_PRIVATE_AGGREGATES,
  EMPTY_PUBLIC_AGGREGATES,
  type CoverageMode,
  type EncounterWithId,
  type FriendRequestWithId,
  type PrivateAggregates,
  type PublicAggregates,
  type UserDoc,
  type UserSettings,
} from '../types';
import { buildCoverage, type Coverage } from '../lib/geo/coverage';

interface DataState {
  entries: EncounterWithId[];
  priv: PrivateAggregates;
  pub: PublicAggregates;
  settings: UserSettings;
  mode: CoverageMode;
  /** Memoised on snapshot identity, so panning and zooming recompute nothing. */
  coverage: Coverage;
  friendUids: string[];
  incoming: FriendRequestWithId[];
  outgoing: FriendRequestWithId[];
  loading: boolean;
  error: string | null;
  /** True when the stored counters disagree with the entry list we can see. */
  needsRepair: boolean;
  repair: () => Promise<void>;
}

const DEFAULT_SETTINGS: UserSettings = {
  defaultVisibility: 'private',
  encounterCoverageMode: 'sharedOnly',
  homeCountry: null,
};

const Ctx = createContext<DataState | null>(null);

export function useData(): DataState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [entries, setEntries] = useState<EncounterWithId[]>([]);
  const [priv, setPriv] = useState<PrivateAggregates>(EMPTY_PRIVATE_AGGREGATES);
  const [pub, setPub] = useState<PublicAggregates>(EMPTY_PUBLIC_AGGREGATES);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [friendUids, setFriendUids] = useState<string[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestWithId[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestWithId[]>([]);
  const [entriesReady, setEntriesReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setEntries([]);
      setPriv(EMPTY_PRIVATE_AGGREGATES);
      setPub(EMPTY_PUBLIC_AGGREGATES);
      setSettings(DEFAULT_SETTINGS);
      setFriendUids([]);
      setIncoming([]);
      setOutgoing([]);
      setEntriesReady(false);
      return;
    }

    // Every listener needs an error callback. Without one, a permission-denied
    // (revoked friendship, signed-out race) leaves the UI silently frozen on stale
    // data instead of reporting it.
    const onErr = (e: Error) => setError(e.message);

    // Aggregate writes are updates, which fail on a missing document — so make sure
    // both exist before the user can create anything.
    void ensureAggregates(uid).catch(() => undefined);

    const unsubs = [
      watchMyEntries(
        uid,
        (list) => {
          setEntries(list);
          setEntriesReady(true);
        },
        onErr,
      ),
      watchPrivateAggregates(uid, setPriv, onErr),
      watchPublicAggregates(uid, setPub, onErr),
      watchFriendships(uid, setFriendUids, onErr),
      watchIncomingRequests(uid, setIncoming, onErr),
      watchOutgoingRequests(uid, setOutgoing, onErr),
      onSnapshot(
        doc(db, 'users', uid),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data() as UserDoc;
            setSettings({ ...DEFAULT_SETTINGS, ...d.settings });
          }
        },
        onErr,
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  const mode = settings.encounterCoverageMode;

  // Reference identity is a correct and free cache key: Firestore hands back new
  // snapshot objects only when the data actually changed.
  const coverage = useMemo(() => buildCoverage(pub, priv), [pub, priv]);

  const needsRepair = useMemo(
    () => entriesReady && aggregatesLookStale(entries, priv),
    [entriesReady, entries, priv],
  );

  const repair = useCallback(async () => {
    if (!uid) return;
    await repairAggregates(uid, entries, pub, mode);
  }, [uid, entries, pub, mode]);

  const value = useMemo<DataState>(
    () => ({
      entries,
      priv,
      pub,
      settings,
      mode,
      coverage,
      friendUids,
      incoming,
      outgoing,
      loading: !!uid && !entriesReady,
      error,
      needsRepair,
      repair,
    }),
    [
      entries, priv, pub, settings, mode, coverage, friendUids, incoming, outgoing,
      uid, entriesReady, error, needsRepair, repair,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
