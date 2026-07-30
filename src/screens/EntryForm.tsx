import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../state/AuthProvider';
import { useData } from '../state/DataProvider';
import { Banner, Button, Chevron, Field, RatingBadge, Screen, inputClass } from '../components/ui';
import { LocationPicker, type PickedLocation } from '../components/LocationPicker';
import { CountryPicker } from '../components/CountryPicker';
import { PhotoPicker } from '../components/PhotoPicker';
import type { ProcessedImage } from '../lib/image';
import { BY_ALPHA2, countryFlag, countryName, demonym } from '../lib/geo/countries';
import { MET_VIA, MET_VIA_LABELS, type MetVia } from '../types';
import { createEntry, deleteEntry, updateEntry, type EntryInput } from '../services/encounters';
import { todayKey } from '../lib/format';

export function EntryFormScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { entries, priv, pub, mode, settings } = useData();

  const existing = useMemo(() => entries.find((e) => e.id === id) ?? null, [entries, id]);
  const isEdit = !!id && !!existing;

  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [placeLabel, setPlaceLabel] = useState('');
  const [nationality, setNationality] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [metVia, setMetVia] = useState<MetVia>('bar');
  const [metViaDetail, setMetViaDetail] = useState('');
  const [dateKey, setDateKey] = useState(todayKey());
  const [description, setDescription] = useState('');
  const [rating, setRating] = useState(7);
  const [tagsText, setTagsText] = useState('');
  const [photo, setPhoto] = useState<ProcessedImage | null>(null);
  const [keepPhoto, setKeepPhoto] = useState(true);
  const [visibility, setVisibility] = useState(settings.defaultVisibility);

  const [locationOpen, setLocationOpen] = useState(false);
  const [nationalityOpen, setNationalityOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from the existing entry when editing.
  useEffect(() => {
    if (!existing) return;
    setLocation({
      lat: existing.location.lat,
      lng: existing.location.lng,
      countryCode: existing.countryCode,
      countryStatus: existing.countryStatus,
      accuracyKm: existing.location.accuracyKm,
      source: existing.location.source,
    });
    setPlaceLabel(existing.location.label);
    setNationality(existing.nationalityCode);
    setName(existing.name);
    setAge(existing.age === null ? '' : String(existing.age));
    setMetVia(existing.metVia);
    setMetViaDetail(existing.metViaDetail ?? '');
    setDateKey(existing.dateKey);
    setDescription(existing.description);
    setRating(existing.rating);
    setTagsText(existing.tags.join(', '));
    setVisibility(existing.visibility);
    setKeepPhoto(true);
  }, [existing]);

  /**
   * Nationality defaults to the country the entry happened in, and stays independently
   * overridable — the two are genuinely different facts and conflating them would be
   * wrong for anyone met while travelling.
   */
  const effectiveNationality = nationality ?? location?.countryCode ?? null;

  const tags = useMemo(
    () =>
      tagsText
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12),
    [tagsText],
  );

  const submit = async () => {
    if (!user || !location) return;
    setError(null);
    setBusy(true);
    try {
      const info = BY_ALPHA2[location.countryCode];
      const natCode = effectiveNationality ?? location.countryCode;
      const input: EntryInput = {
        visibility,
        lat: location.lat,
        lng: location.lng,
        placeLabel,
        locationSource: location.source,
        accuracyKm: location.accuracyKm,
        countryCode: location.countryCode,
        countryName: info?.name ?? location.countryCode,
        countryNumeric: info?.ccn3 ?? '',
        continent: info?.region ?? 'Other',
        subregion: info?.subregion ?? '',
        countryStatus: location.countryStatus,
        nationalityCode: natCode,
        nationalityLabel: demonym(natCode),
        name,
        age: age.trim() === '' ? null : Number(age),
        metVia,
        metViaDetail: metViaDetail.trim() || null,
        dateKey,
        description,
        rating,
        tags,
        photo: photo
          ? {
              thumbDataUrl: photo.thumbDataUrl,
              fullDataUrl: photo.fullDataUrl,
              w: photo.w,
              h: photo.h,
              bytes: photo.bytes,
            }
          : null,
        keepExistingPhoto: isEdit && !photo && keepPhoto,
      };

      if (isEdit && existing) {
        await updateEntry(user.uid, id!, existing, input, priv, pub, mode);
        navigate(`/entry/${id}`, { replace: true });
      } else {
        const newId = await createEntry(user.uid, input, priv, pub, mode);
        navigate(`/entry/${newId}`, { replace: true });
      }
    } catch (err) {
      setError((err as Error).message || 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!user || !existing || !id) return;
    setBusy(true);
    try {
      await deleteEntry(user.uid, id, existing, priv, pub, mode);
      navigate('/log', { replace: true });
    } catch (err) {
      setError((err as Error).message || 'Could not delete that.');
      setBusy(false);
    }
  };

  return (
    <Screen
      title={isEdit ? 'Edit entry' : 'New entry'}
      back={() => navigate(-1)}
      right={
        <Button onClick={() => void submit()} disabled={busy || !location || !name.trim()} className="px-4">
          {busy ? '…' : 'Save'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4 px-4 py-4">
        {error && <Banner tone="error">{error}</Banner>}

        <Field label="Location" hint="Sets the country automatically. Fully editable." as="div">
          <button
            type="button"
            onClick={() => setLocationOpen(true)}
            className={`${inputClass} flex items-center gap-2 text-left`}
          >
            {location ? (
              <>
                <span className="text-lg">{countryFlag(location.countryCode)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{countryName(location.countryCode)}</span>
                  <span className="block text-xs text-muted">
                    {location.lat.toFixed(3)}, {location.lng.toFixed(3)}
                  </span>
                </span>
              </>
            ) : (
              <span className="flex-1 text-muted">Drop a pin or pick a country</span>
            )}
            <Chevron />
          </button>
        </Field>

        <Field label="Place" hint="Optional — a bar, a beach, a city.">
          <input
            className={inputClass}
            value={placeLabel}
            onChange={(e) => setPlaceLabel(e.target.value)}
            maxLength={160}
            placeholder="e.g. Bairro Alto, Lisbon"
          />
        </Field>

        <Field label="Name or nickname">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Whatever you'll remember"
            required
          />
        </Field>

        <Field
          label="Nationality"
          as="div"
          hint={
            location && !nationality
              ? `Defaulted to where it happened (${demonym(location.countryCode)}).`
              : undefined
          }
        >
          <button
            type="button"
            onClick={() => setNationalityOpen(true)}
            className={`${inputClass} flex items-center gap-2 text-left`}
          >
            {effectiveNationality ? (
              <>
                <span className="text-lg">{countryFlag(effectiveNationality)}</span>
                <span className="flex-1">{demonym(effectiveNationality)}</span>
              </>
            ) : (
              <span className="flex-1 text-muted">Choose a nationality</span>
            )}
            <Chevron />
          </button>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input
              type="date"
              className={inputClass}
              value={dateKey}
              max={todayKey()}
              onChange={(e) => setDateKey(e.target.value)}
            />
          </Field>
          <Field label="Age" hint="Optional, 18+.">
            <input
              type="number"
              inputMode="numeric"
              className={inputClass}
              value={age}
              min={18}
              max={99}
              onChange={(e) => setAge(e.target.value)}
              placeholder="—"
            />
          </Field>
        </div>

        <Field label="How you met" as="div">
          <div className="flex flex-wrap gap-1.5">
            {MET_VIA.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetVia(m)}
                className={`rounded-full px-3 py-1.5 text-sm ring-1 transition-colors ${
                  metVia === m
                    ? 'bg-accent text-white ring-accent'
                    : 'bg-ink-3 text-muted ring-line'
                }`}
              >
                {MET_VIA_LABELS[m]}
              </button>
            ))}
          </div>
        </Field>

        {(metVia === 'dating_app' || metVia === 'other') && (
          <Field label={metVia === 'dating_app' ? 'Which app' : 'Details'}>
            <input
              className={inputClass}
              value={metViaDetail}
              onChange={(e) => setMetViaDetail(e.target.value)}
              maxLength={60}
              placeholder={metVia === 'dating_app' ? 'e.g. Hinge' : 'Short note'}
            />
          </Field>
        )}

        <Field label="Rating">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={10}
              step={1}
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              className="h-6 flex-1"
              aria-label="Rating from 1 to 10"
            />
            <RatingBadge rating={rating} />
          </div>
        </Field>

        <Field label="Notes" hint={`${description.length}/2000`}>
          <textarea
            className={`${inputClass} min-h-24 resize-y`}
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
            placeholder="Anything worth remembering"
          />
        </Field>

        <Field label="Tags" hint="Comma separated, up to 12.">
          <input
            className={inputClass}
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="holiday, festival"
          />
        </Field>

        <Field label="Photo" as="div">
          <PhotoPicker
            value={photo}
            existingThumb={keepPhoto ? (existing?.photo?.thumbDataUrl ?? null) : null}
            onChange={(img) => {
              setPhoto(img);
              setKeepPhoto(false);
            }}
            onRemove={() => {
              setPhoto(null);
              setKeepPhoto(false);
            }}
          />
        </Field>

        <Field
          label="Visibility"
          as="div"
          hint={
            visibility === 'friends'
              ? 'Friends you have accepted can see this entry.'
              : 'Only you can see this entry. Your country totals may still count it.'
          }
        >
          <div className="flex gap-1 rounded-xl bg-ink-3 p-1 ring-1 ring-line">
            {(['private', 'friends'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisibility(v)}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
                  visibility === v ? 'bg-accent text-white' : 'text-muted'
                }`}
              >
                {v === 'private' ? '🔒 Private' : '👥 Friends'}
              </button>
            ))}
          </div>
        </Field>

        {isEdit && (
          <Button variant="danger" onClick={() => void remove()} disabled={busy}>
            Delete this entry
          </Button>
        )}

        <div className="h-6" />
      </div>

      <LocationPicker
        open={locationOpen}
        onClose={() => setLocationOpen(false)}
        initial={location ? { lat: location.lat, lng: location.lng } : null}
        onPick={(loc) => {
          setLocation(loc);
          setLocationOpen(false);
          // Only prefill nationality when the user has not already chosen one.
          if (!nationality) setNationality(null);
        }}
      />

      <CountryPicker
        open={nationalityOpen}
        onClose={() => setNationalityOpen(false)}
        title="Nationality"
        selected={effectiveNationality}
        onPick={(code) => {
          setNationality(code);
          setNationalityOpen(false);
        }}
      />
    </Screen>
  );
}
