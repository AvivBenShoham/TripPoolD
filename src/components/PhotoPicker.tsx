import { useRef, useState } from 'react';
import { formatBytes, processImage, type ProcessedImage } from '../lib/image';
import { Banner, Button } from './ui';

/**
 * Photo input. Resizing happens locally before anything is stored, which also strips
 * EXIF — including the GPS tags an iPhone embeds. Worth telling the user, since the
 * whole point of the app is that location data stays where they put it.
 */
export function PhotoPicker({
  value,
  existingThumb,
  onChange,
  onRemove,
}: {
  value: ProcessedImage | null;
  existingThumb?: string | null;
  onChange: (img: ProcessedImage) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = value?.thumbDataUrl ?? existingThumb ?? null;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onChange(await processImage(file));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />

      {preview ? (
        <div className="flex items-center gap-3">
          <img
            src={preview}
            alt="Selected photo"
            className="h-20 w-20 rounded-xl object-cover ring-1 ring-line"
          />
          <div className="min-w-0 flex-1 text-xs text-muted">
            {value ? (
              <>
                <p>
                  {value.w}×{value.h} · {formatBytes(value.bytes)}
                </p>
                <p className="mt-1">Location data was stripped when resizing.</p>
              </>
            ) : (
              <p>Existing photo.</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Button variant="subtle" onClick={() => inputRef.current?.click()} className="px-3">
              Replace
            </Button>
            <Button variant="ghost" onClick={onRemove} className="px-3">
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Processing…' : '📷 Add a photo'}
        </Button>
      )}

      {error && (
        <div className="mt-2">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
    </div>
  );
}
