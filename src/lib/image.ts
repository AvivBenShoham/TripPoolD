import { LIMITS } from './firebase';

/**
 * Canvas-based image pipeline.
 *
 * There is no Cloud Storage on this project (new Firebase projects need the paid Blaze
 * plan for it), so photos live in Firestore documents. That means a hard ceiling: the
 * 1 MiB document cap covers field names and overhead, and base64 inflates bytes by 4/3,
 * so the practical limit is roughly 525 KB of JPEG.
 *
 * A useful side effect: the canvas round-trip discards all EXIF, including GPS
 * coordinates. For an app whose whole premise is location privacy, the original file's
 * embedded location never reaching the network is worth stating in the UI.
 */

export interface ProcessedImage {
  thumbDataUrl: string;
  fullDataUrl: string;
  w: number;
  h: number;
  bytes: number;
  mime: 'image/jpeg';
}

const THUMB_EDGE = 320;
const FULL_LADDER: { edge: number; quality: number }[] = [
  { edge: 1600, quality: 0.82 },
  { edge: 1600, quality: 0.72 },
  { edge: 1280, quality: 0.72 },
  { edge: 1280, quality: 0.62 },
  { edge: 1024, quality: 0.62 },
  { edge: 800, quality: 0.6 },
];

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    // imageOrientation matters: without it, iPhone portrait shots land sideways.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    // Desktop Chrome and Firefox cannot decode HEIC. iOS Safari can, which is the
    // target device, so this is a "you're on a laptop" message rather than a failure.
    throw new Error(
      'That image format could not be read in this browser. If it is a HEIC photo from an iPhone, convert it to JPEG first.',
      { cause: err },
    );
  }
}

function drawScaled(bitmap: ImageBitmap, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

/**
 * Resizes to a thumbnail (denormalised onto the entry document for map and list
 * rendering) plus a full image (stored in a separate media document, fetched on demand).
 *
 * The full image walks down a quality/size ladder until it fits the budget, and throws
 * a specific error if even the smallest step is too large — better than writing a
 * document the security rules will reject.
 */
export async function processImage(file: Blob): Promise<ProcessedImage> {
  const bitmap = await decode(file);
  try {
    const thumbCanvas = drawScaled(bitmap, THUMB_EDGE);
    let thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.62);
    if (thumbDataUrl.length > LIMITS.thumbChars) {
      thumbDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.45);
    }
    if (thumbDataUrl.length > LIMITS.thumbChars) {
      thumbDataUrl = drawScaled(bitmap, 200).toDataURL('image/jpeg', 0.5);
    }

    for (const step of FULL_LADDER) {
      const canvas = drawScaled(bitmap, step.edge);
      const dataUrl = canvas.toDataURL('image/jpeg', step.quality);
      if (dataUrl.length <= LIMITS.fullPhotoChars) {
        return {
          thumbDataUrl,
          fullDataUrl: dataUrl,
          w: canvas.width,
          h: canvas.height,
          bytes: Math.round((dataUrl.length * 3) / 4),
          mime: 'image/jpeg',
        };
      }
    }
    throw new Error(
      'That photo is too large to store even after compression. Try cropping it first.',
    );
  } finally {
    // 48 MP source images will exhaust memory on an older phone otherwise.
    bitmap.close();
  }
}

/** Same pipeline for avatars, which have a much smaller budget. */
export async function processAvatar(file: Blob): Promise<string> {
  const bitmap = await decode(file);
  try {
    for (const [edge, quality] of [
      [256, 0.7],
      [192, 0.6],
      [128, 0.55],
    ] as const) {
      const dataUrl = drawScaled(bitmap, edge).toDataURL('image/jpeg', quality);
      if (dataUrl.length <= LIMITS.avatarChars) return dataUrl;
    }
    throw new Error('That avatar is too large. Try a smaller crop.');
  } finally {
    bitmap.close();
  }
}

/**
 * Best-effort fetch of a Google account photo into a stored thumbnail.
 * lh3.googleusercontent.com normally allows CORS, but if it does not, the caller falls
 * back to storing the URL itself — which is why PublicProfile has both fields.
 */
export async function avatarThumbFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    return await processAvatar(await res.blob());
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
