import { useState } from 'react';
import { WorldMap } from './WorldMap';
import { Banner, Button, Chevron, Sheet, inputClass } from './ui';
import { EMPTY_COVERAGE } from '../lib/geo/coverage';
import { resolveCountry } from '../lib/geo/resolve';
import { BY_ALPHA2, countryFlag, countryName } from '../lib/geo/countries';
import { CountryPicker } from './CountryPicker';
import type { CountryStatus } from '../types';

export interface PickedLocation {
  lat: number;
  lng: number;
  countryCode: string;
  countryStatus: CountryStatus;
  accuracyKm: number | null;
  source: 'pin' | 'manual';
}

/**
 * Sets an entry's location three ways: drop a pin on the map, use the device's GPS, or
 * pick a country from the list.
 *
 * The country is resolved entirely offline (no geocoding API is reachable, and none is
 * wanted — it would leak exactly the coordinates this app exists to keep private). The
 * resolved country is always shown as an editable value, never applied silently.
 */
export function LocationPicker({
  open,
  onClose,
  onPick,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (loc: PickedLocation) => void;
  initial?: { lat: number; lng: number } | null;
}) {
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(initial ?? null);
  const [resolved, setResolved] = useState<PickedLocation | null>(null);
  const [resolving, setResolving] = useState(false);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const handlePoint = async (lat: number, lng: number) => {
    setPoint({ lat, lng });
    setResolving(true);
    setGeoError(null);
    try {
      const r = await resolveCountry(lat, lng);
      setResolved({
        lat,
        lng,
        countryCode: r.code,
        countryStatus: r.status === 'unresolved' ? 'unresolved' : r.status,
        accuracyKm: r.accuracyKm,
        source: 'pin',
      });
    } catch {
      setGeoError('Could not work out the country for that point. Pick one manually.');
      setResolved({
        lat,
        lng,
        countryCode: 'XX',
        countryStatus: 'unresolved',
        accuracyKm: null,
        source: 'pin',
      });
    } finally {
      setResolving(false);
    }
  };

  const useMyLocation = () => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('This browser cannot share your location.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => void handlePoint(pos.coords.latitude, pos.coords.longitude),
      (err) =>
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. Drop a pin instead.'
            : 'Could not get your location. Drop a pin instead.',
        ),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const chooseCountryManually = (code: string) => {
    const info = BY_ALPHA2[code];
    setCountryPickerOpen(false);
    // Centre the pin on the country when there is no better point available.
    const lat = point?.lat ?? info?.lat ?? 0;
    const lng = point?.lng ?? info?.lng ?? 0;
    setPoint({ lat, lng });
    setResolved({
      lat,
      lng,
      countryCode: code,
      countryStatus: 'manual',
      accuracyKm: null,
      source: point ? 'pin' : 'manual',
    });
  };

  const unresolved = resolved?.countryStatus === 'unresolved';

  return (
    <Sheet open={open} onClose={onClose} title="Where was it?">
      <div className="mb-3 h-48 overflow-hidden rounded-xl bg-ink-3 ring-1 ring-line">
        <WorldMap
          coverage={EMPTY_COVERAGE}
          onPickLocation={(lat, lng) => void handlePoint(lat, lng)}
          markerLatLng={point}
          className="h-full w-full"
        />
      </div>

      <p className="mb-3 text-xs text-muted">
        Tap the map to drop a pin. Pinch or use the buttons to zoom in first for accuracy.
      </p>

      <div className="mb-3 flex gap-2">
        <Button variant="ghost" onClick={useMyLocation} className="flex-1 text-sm">
          📍 Use my location
        </Button>
        <Button variant="ghost" onClick={() => setCountryPickerOpen(true)} className="flex-1 text-sm">
          🌐 Pick country
        </Button>
      </div>

      {geoError && (
        <div className="mb-3">
          <Banner tone="warn">{geoError}</Banner>
        </div>
      )}

      {resolving && <p className="mb-3 text-sm text-muted">Working out the country…</p>}

      {resolved && !resolving && (
        <div className="mb-3">
          {unresolved ? (
            <Banner tone="warn">
              That pin is in the sea. Pick the country manually.
            </Banner>
          ) : (
            <button
              type="button"
              onClick={() => setCountryPickerOpen(true)}
              className={`${inputClass} flex items-center gap-2 text-left`}
            >
              <span className="text-lg">{countryFlag(resolved.countryCode)}</span>
              <span className="flex-1">
                <span className="block">{countryName(resolved.countryCode)}</span>
                <span className="block text-xs text-muted">
                  {resolved.countryStatus === 'nearest'
                    ? `Nearest coast, about ${resolved.accuracyKm} km — tap to change`
                    : resolved.countryStatus === 'manual'
                      ? 'Chosen by you'
                      : 'Tap to change'}
                </span>
              </span>
              <Chevron />
            </button>
          )}
        </div>
      )}

      <Button
        onClick={() => {
          if (resolved && !unresolved) onPick(resolved);
        }}
        disabled={!resolved || unresolved}
        className="w-full"
      >
        Use this location
      </Button>

      <CountryPicker
        open={countryPickerOpen}
        onClose={() => setCountryPickerOpen(false)}
        onPick={chooseCountryManually}
        selected={resolved?.countryCode ?? null}
      />
    </Sheet>
  );
}
