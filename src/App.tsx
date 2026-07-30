import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './state/AuthProvider';
import { DataProvider } from './state/DataProvider';
import { BottomNav, Button, Spinner } from './components/ui';
import { LoginScreen } from './screens/Login';
import { OnboardingScreen } from './screens/Onboarding';
import { MapScreen } from './screens/Map';
import { LogScreen } from './screens/Log';
import { EntryFormScreen } from './screens/EntryForm';
import { EntryDetailScreen } from './screens/EntryDetail';
import { CountriesScreen } from './screens/Countries';
import { CountryDetailScreen } from './screens/CountryDetail';
import { StatsScreen } from './screens/Stats';
import { AchievementsScreen } from './screens/Achievements';
import { RecapScreen } from './screens/Recap';
import { FriendsScreen } from './screens/Friends';
import { FriendSearchScreen } from './screens/FriendSearch';
import { FriendProfileScreen } from './screens/FriendProfile';
import { SettingsScreen } from './screens/Settings';

/**
 * Phone frame. The app is a fixed 390x844 viewport on a phone and renders centred in a
 * device-sized shell on a desktop, so the layout is identical in both places — which is
 * also what makes the Playwright screenshots representative.
 */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#05070d]">
      <div className="relative flex h-full max-h-[100dvh] w-full max-w-[430px] flex-col overflow-hidden bg-ink sm:h-[844px] sm:max-h-[92vh] sm:rounded-[2.2rem] sm:ring-1 sm:ring-line">
        {children}
      </div>
    </div>
  );
}

/** Routes that render without the tab bar (full-screen flows). */
const CHROMELESS = [/^\/entry\/new$/, /^\/entry\/[^/]+\/edit$/, /^\/login$/, /^\/onboarding$/];

export function App() {
  const { user, loading, needsOnboarding, authError, profileError, retryProfile } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <PhoneFrame>
        <Spinner label="Loading" />
      </PhoneFrame>
    );
  }

  // Auth being unavailable is the first thing you hit on a project where Authentication
  // has not been enabled yet, so it gets a real explanation rather than a stuck spinner.
  if (authError) {
    return (
      <PhoneFrame>
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="text-4xl">🔌</div>
          <h1 className="text-lg font-semibold">Can’t reach sign-in</h1>
          <p className="text-sm text-muted">{authError}</p>
        </div>
      </PhoneFrame>
    );
  }

  // A failed profile read must not be mistaken for "new user" — that would offer an
  // existing account a fresh username.
  if (user && profileError) {
    return (
      <PhoneFrame>
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="text-4xl">📡</div>
          <h1 className="text-lg font-semibold">Could not load your profile</h1>
          <p className="text-sm text-muted">{profileError}</p>
          <Button onClick={retryProfile}>Try again</Button>
        </div>
      </PhoneFrame>
    );
  }

  if (!user) {
    return (
      <PhoneFrame>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </PhoneFrame>
    );
  }

  // One blocking guard covers both paths that leave an authenticated user with no
  // profile: a first-time Google sign-in, and a signup whose claim transaction failed.
  if (needsOnboarding) {
    return (
      <PhoneFrame>
        <Routes>
          <Route path="/onboarding" element={<OnboardingScreen />} />
          <Route path="*" element={<Navigate to="/onboarding" replace />} />
        </Routes>
      </PhoneFrame>
    );
  }

  const showNav = !CHROMELESS.some((re) => re.test(location.pathname));

  return (
    <DataProvider>
      <PhoneFrame>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <Routes>
            <Route path="/" element={<MapScreen />} />
            <Route path="/log" element={<LogScreen />} />
            <Route path="/entry/new" element={<EntryFormScreen />} />
            <Route path="/entry/:id" element={<EntryDetailScreen />} />
            <Route path="/entry/:id/edit" element={<EntryFormScreen />} />
            <Route path="/countries" element={<CountriesScreen />} />
            <Route path="/country/:code" element={<CountryDetailScreen />} />
            <Route path="/stats" element={<StatsScreen />} />
            <Route path="/stats/achievements" element={<AchievementsScreen />} />
            <Route path="/stats/recap/:year" element={<RecapScreen />} />
            <Route path="/friends" element={<FriendsScreen />} />
            <Route path="/friends/search" element={<FriendSearchScreen />} />
            <Route path="/u/:uid" element={<FriendProfileScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/onboarding" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        {showNav && <BottomNav />}
      </PhoneFrame>
    </DataProvider>
  );
}
