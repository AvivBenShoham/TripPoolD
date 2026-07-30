import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../state/DataProvider';
import { Screen } from '../components/ui';
import { computeBadges, deriveStats } from '../lib/stats';

export function AchievementsScreen() {
  const navigate = useNavigate();
  const { entries, coverage } = useData();
  const stats = useMemo(() => deriveStats(entries), [entries]);
  const badges = useMemo(() => computeBadges(coverage, entries, stats), [coverage, entries, stats]);

  const earned = badges.filter((b) => b.earned);
  const locked = badges.filter((b) => !b.earned);

  return (
    <Screen title="Achievements" back={() => navigate(-1)}>
      <div className="px-4 py-4">
        <p className="mb-4 text-sm text-muted">
          {earned.length} of {badges.length} earned. Some reward logging, others reward travel
          alone — marking countries visited counts on its own.
        </p>

        {!!earned.length && (
          <>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
              Earned
            </h2>
            <div className="mb-6 grid grid-cols-2 gap-2">
              {earned.map((b) => (
                <div
                  key={b.id}
                  className="rounded-2xl bg-ink-2 px-3 py-3 ring-1 ring-accent/40"
                >
                  <div className="text-2xl">{b.icon}</div>
                  <div className="mt-1 text-sm font-medium">{b.title}</div>
                  <div className="text-xs text-muted">{b.description}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {!!locked.length && (
          <>
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
              Still to go
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {locked.map((b) => (
                <div key={b.id} className="rounded-2xl bg-ink-2 px-3 py-3 ring-1 ring-line">
                  <div className="text-2xl opacity-40 grayscale">{b.icon}</div>
                  <div className="mt-1 text-sm font-medium text-muted">{b.title}</div>
                  <div className="text-xs text-muted/70">{b.description}</div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-3">
                    <div
                      className="h-full rounded-full bg-accent/60"
                      style={{ width: `${Math.round(b.progress * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="h-4" />
      </div>
    </Screen>
  );
}
