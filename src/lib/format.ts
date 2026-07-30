import { Timestamp } from 'firebase/firestore';

/**
 * A calendar day, stored as noon UTC.
 *
 * Noon rather than midnight so that a traveller crossing timezones never sees an entry
 * jump a day. `dateKey` is the string the UI groups and filters on; the Timestamp exists
 * for ordering.
 */
export function dayToTimestamp(dateKey: string): Timestamp {
  return Timestamp.fromDate(new Date(`${dateKey}T12:00:00.000Z`));
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dateKeyOf(d: Date): string {
  // Local calendar day, not UTC — "the day it happened" is the user's day.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatDateKey(key: string): string {
  const [y, m, d] = key.split('-');
  const month = MONTHS[Number(m) - 1] ?? m;
  return `${Number(d)} ${month} ${y}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function yearOf(dateKey: string): number {
  return Number(dateKey.slice(0, 4));
}

export function relativeTime(ts: Timestamp | null | undefined): string {
  if (!ts) return '';
  const diff = Date.now() - ts.toMillis();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/** Rating colour ramp: red at 1 through amber to green at 10. */
export function ratingColor(rating: number): string {
  const clamped = Math.min(10, Math.max(1, rating));
  const hue = ((clamped - 1) / 9) * 130; // 0 = red, 130 = green
  return `hsl(${Math.round(hue)} 72% 48%)`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function pct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function plural(n: number, one: string, many?: string): string {
  return n === 1 ? one : (many ?? `${one}s`);
}

/** Slugifies a display name into a candidate handle for the onboarding prefill. */
export function slugifyHandle(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20);
  return base.length >= 3 ? base : `${base}user`.slice(0, 20);
}
