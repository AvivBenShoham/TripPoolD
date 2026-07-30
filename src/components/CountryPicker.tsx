import { useMemo, useState } from 'react';
import { Sheet, inputClass } from './ui';
import { COUNTRIES, searchCountries } from '../lib/geo/countries';

/**
 * Searchable country list. Also the manual escape hatch whenever the offline geocoder
 * cannot resolve a pin — a pin dropped at sea, or the one known miss (Vatican City,
 * which the polygon test attributes to Italy).
 */
export function CountryPicker({
  open,
  onClose,
  onPick,
  title = 'Choose a country',
  selected,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (code: string) => void;
  title?: string;
  selected?: string | null;
}) {
  const [q, setQ] = useState('');
  const results = useMemo(() => (q ? searchCountries(q, 60) : COUNTRIES), [q]);

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <input
        className={`${inputClass} mb-3`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search countries"
        autoCapitalize="none"
        aria-label="Search countries"
      />
      <ul className="divide-y divide-line/60">
        {results.map((c) => (
          <li key={c.cca2}>
            <button
              type="button"
              onClick={() => onPick(c.cca2)}
              className="flex w-full items-center gap-3 py-2.5 text-left active:bg-ink-3"
            >
              <span className="w-7 text-center text-xl leading-none">{c.flag}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.name}</span>
                <span className="block text-xs text-muted">{c.demonym}</span>
              </span>
              {selected === c.cca2 && <span className="text-accent">✓</span>}
            </button>
          </li>
        ))}
        {!results.length && (
          <li className="py-6 text-center text-sm text-muted">No country matches that.</li>
        )}
      </ul>
    </Sheet>
  );
}
