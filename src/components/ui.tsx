import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { initials, ratingColor } from '../lib/format';
import { countryFlag, countryName } from '../lib/geo/countries';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

export function Screen({
  title,
  right,
  children,
  scroll = true,
  back,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  back?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      {(title || right || back) && (
        <header className="pt-safe flex shrink-0 items-center gap-2 border-b border-line bg-ink/90 px-4 pb-3 backdrop-blur">
          {back && (
            <button
              type="button"
              onClick={back}
              aria-label="Back"
              className="-ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted active:bg-ink-3"
            >
              ‹
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
          {right}
        </header>
      )}
      <div className={scroll ? 'scroll-y flex-1' : 'relative flex-1 overflow-hidden'}>
        {children}
      </div>
    </div>
  );
}

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`w-full rounded-2xl bg-ink-2 ring-1 ring-line ${onClick ? 'text-left active:bg-ink-3' : ''} ${className}`}
    >
      {children}
    </Tag>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  className = '',
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'subtle';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  /** Set when the visible text alone is ambiguous, e.g. a bare "Save" next to a field. */
  ariaLabel?: string;
}) {
  const styles = {
    primary: 'bg-accent text-white active:bg-accent-2 disabled:bg-ink-3 disabled:text-muted',
    ghost: 'bg-transparent text-white ring-1 ring-line active:bg-ink-3',
    subtle: 'bg-ink-3 text-white active:bg-line',
    danger: 'bg-red-600/90 text-white active:bg-red-500',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-medium transition-colors disabled:opacity-60 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Labelled form row.
 *
 * `as` matters for accessibility, not styling: a `<label>` may only wrap a genuine
 * labelable control (input, select, textarea). Wrapping a `<button>` makes the browser
 * compute the button's accessible name from the surrounding label text instead of its own
 * content, so a screen reader announces "Location" for a control that visibly reads
 * "Drop a pin or pick a country". Button-based rows therefore use `as="div"`.
 */
export function Field({
  label,
  hint,
  children,
  as = 'label',
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  as?: 'label' | 'div';
}) {
  const Tag = as;
  return (
    <Tag className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </Tag>
  );
}

/** Decorative chevron, hidden from the accessibility tree so it stays out of names. */
export function Chevron() {
  return (
    <span className="text-muted" aria-hidden="true">
      ›
    </span>
  );
}

export const inputClass =
  'w-full rounded-xl bg-ink-3 px-3 py-2.5 outline-none ring-1 ring-line placeholder:text-muted/70 focus:ring-2 focus:ring-accent';

export function Banner({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'error' | 'warn' | 'success';
  children: ReactNode;
  action?: ReactNode;
}) {
  const styles = {
    info: 'bg-sky-500/10 text-sky-200 ring-sky-500/30',
    error: 'bg-red-500/10 text-red-200 ring-red-500/30',
    warn: 'bg-amber-500/10 text-amber-100 ring-amber-500/30',
    success: 'bg-emerald-500/10 text-emerald-200 ring-emerald-500/30',
  }[tone];
  return (
    <div
      className={`flex items-start gap-3 rounded-xl px-3 py-2.5 text-sm ring-1 ${styles}`}
      role={tone === 'error' ? 'alert' : undefined}
    >
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}

/** Bottom sheet. Closes on backdrop tap or Escape, and traps initial focus. */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fade-in absolute inset-0 bg-black/55"
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="sheet-enter relative max-h-[82%] overflow-hidden rounded-t-3xl bg-ink-2 ring-1 ring-line outline-none"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1 font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted active:bg-ink-3"
          >
            ✕
          </button>
        </div>
        <div className="scroll-y pb-safe max-h-[70vh] px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

export function RatingBadge({ rating, size = 'md' }: { rating: number; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white ${
        size === 'sm' ? 'h-6 w-6 text-xs' : 'h-8 w-8 text-sm'
      }`}
      style={{ backgroundColor: ratingColor(rating) }}
      aria-label={`Rating ${rating} out of 10`}
    >
      {rating}
    </span>
  );
}

export function Avatar({
  name,
  thumb,
  url,
  size = 40,
}: {
  name: string;
  thumb?: string | null;
  url?: string | null;
  size?: number;
}) {
  const src = thumb || url || null;
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-ink-3 font-semibold text-muted ring-1 ring-line"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  onClick,
  testId,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
  testId?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      data-testid={testId}
      className={`rounded-2xl bg-ink-2 px-3 py-3 text-left ring-1 ring-line ${onClick ? 'active:bg-ink-3' : ''}`}
    >
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
      {sub && <div className="mt-1 text-xs text-accent-2">{sub}</div>}
    </Tag>
  );
}

export function CountryRow({
  code,
  right,
  sub,
  onClick,
}: {
  code: string;
  right?: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-1 py-2.5 text-left ${onClick ? 'active:bg-ink-3' : ''}`}
    >
      <span className="w-7 shrink-0 text-center text-xl leading-none">{countryFlag(code)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{countryName(code)}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
      {right}
    </Tag>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: string;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-14 text-center">
      <div className="text-4xl" aria-hidden>
        {icon}
      </div>
      <h2 className="font-semibold">{title}</h2>
      {body && <p className="text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

const TABS = [
  { to: '/', label: 'Map', icon: '🌍' },
  { to: '/log', label: 'Log', icon: '📖' },
  { to: '/entry/new', label: 'Add', icon: '＋', primary: true },
  { to: '/stats', label: 'Stats', icon: '📊' },
  { to: '/friends', label: 'Friends', icon: '👥' },
];

export function BottomNav() {
  return (
    <nav className="pb-safe flex shrink-0 items-stretch justify-around border-t border-line bg-ink/95 px-2 pt-1.5 backdrop-blur">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 text-[10px] ${
              isActive && !t.primary ? 'text-accent' : 'text-muted'
            }`
          }
        >
          {t.primary ? (
            <span className="-mt-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-2xl leading-none text-white shadow-lg shadow-accent/30">
              {t.icon}
            </span>
          ) : (
            <span className="text-xl leading-none" aria-hidden>
              {t.icon}
            </span>
          )}
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
