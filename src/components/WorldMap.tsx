import { useCallback, useMemo, useRef, useState } from 'react';
import { geoEqualEarth, geoPath } from 'd3-geo';
import { RENDER_FEATURES, type CountryFeature } from '../lib/geo/atlas';
import {
  ALPHA2_BY_NUMERIC,
  BY_ALPHA2,
  NUMERIC_BY_ALPHA2,
  alpha2ForFeature,
  normaliseNumericId,
} from '../lib/geo/countries';
import type { Coverage } from '../lib/geo/coverage';

export type MapLayer = 'combined' | 'visited' | 'entries';

const VIEW_W = 800;
const VIEW_H = 480;

/**
 * Projection and path strings are computed ONCE at module scope, not per render.
 *
 * This is what keeps the map smooth: pan and zoom are a CSS transform on the <g>
 * element, never a re-projection, so interacting with the map does no geometry work at
 * all. Re-rendering only swaps `fill` attributes.
 */
const projection = geoEqualEarth().fitExtent(
  [
    [8, 8],
    [VIEW_W - 8, VIEW_H - 8],
  ],
  { type: 'FeatureCollection', features: RENDER_FEATURES } as never,
);

/** Rounds path coordinates to 1dp — ~40% smaller path strings, no visible difference. */
const pathGen = geoPath(projection);
function roundPath(d: string): string {
  return d.replace(/-?\d+\.\d+/g, (m) => Number(m).toFixed(1));
}

interface RenderedCountry {
  code: string | null;
  numeric: string | null;
  name: string;
  d: string;
}

const RENDERED: RenderedCountry[] = RENDER_FEATURES.map((f: CountryFeature) => {
  const d = pathGen(f as never);
  return {
    code: alpha2ForFeature(f.id, f.properties?.name),
    numeric: normaliseNumericId(f.id),
    name: f.properties?.name ?? '',
    d: d ? roundPath(d) : '',
  };
}).filter((r) => r.d);

const RENDERABLE_NUMERICS = new Set(
  RENDERED.map((r) => r.numeric).filter((n): n is string => !!n),
);

/**
 * The 110m atlas cannot draw ~76 countries — Singapore, Hong Kong, Malta, Monaco, the
 * Maldives, Andorra, Mauritius, Seychelles and so on. Precisely the kind of place this
 * app is used, so they get a circle marker at their centroid instead of being silently
 * dropped from the map. All 250 countries stay visible and tappable.
 */
const DOT_COUNTRIES = Object.values(BY_ALPHA2)
  .filter((c) => {
    const numeric = NUMERIC_BY_ALPHA2[c.cca2];
    return !numeric || !RENDERABLE_NUMERICS.has(numeric);
  })
  .map((c) => {
    const p = projection([c.lng, c.lat]);
    return p ? { code: c.cca2, x: p[0], y: p[1] } : null;
  })
  .filter((d): d is { code: string; x: number; y: number } => !!d);

const NEUTRAL = '#1b2338';
const NEUTRAL_UNMAPPED = '#161d30';
const STROKE = '#2b3550';

/** Blue for visited-only, warm ramp by count for countries with entries. */
function fillFor(
  code: string | null,
  coverage: Coverage,
  layer: MapLayer,
  maxCount: number,
): string {
  if (!code) return NEUTRAL_UNMAPPED;
  const cell = coverage.byCode.get(code);
  if (!cell) return NEUTRAL;

  if (layer === 'visited') return cell.state >= 1 ? '#4661bd' : NEUTRAL;
  if (layer === 'entries' && cell.state < 2) return NEUTRAL;

  if (cell.state === 1) return '#3d5aa8';
  // Perceptual ramp from a single entry to the personal maximum. Using the user's own
  // max rather than a fixed scale keeps the map legible whether they have 3 or 300.
  const t = maxCount <= 1 ? 1 : Math.min(1, Math.log(cell.count) / Math.log(maxCount));
  const light = 42 + t * 22;
  const sat = 68 + t * 14;
  const hue = 340 - t * 12;
  return `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  thumb: string | null;
  rating: number;
}

interface Props {
  coverage: Coverage;
  layer?: MapLayer;
  pins?: MapPin[];
  /** Tapping a country. Receives null when tapping unmapped geography or the sea. */
  onSelectCountry?: (code: string | null) => void;
  /** Enables pin-drop mode: a tap reports geographic coordinates. */
  onPickLocation?: (lat: number, lng: number) => void;
  markerLatLng?: { lat: number; lng: number } | null;
  highlightCode?: string | null;
  interactive?: boolean;
  className?: string;
}

export function WorldMap({
  coverage,
  layer = 'combined',
  pins = [],
  onSelectCountry,
  onPickLocation,
  markerLatLng = null,
  highlightCode = null,
  interactive = true,
  className,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(
    null,
  );
  const pinchStart = useRef<{ dist: number; k: number } | null>(null);

  const maxCount = coverage.maxCount;

  const fills = useMemo(
    () => RENDERED.map((r) => fillFor(r.code, coverage, layer, maxCount)),
    [coverage, layer, maxCount],
  );

  const dotFills = useMemo(
    () => DOT_COUNTRIES.map((d) => fillFor(d.code, coverage, layer, maxCount)),
    [coverage, layer, maxCount],
  );

  const projectedPins = useMemo(
    () =>
      pins
        .map((p) => {
          const xy = projection([p.lng, p.lat]);
          return xy ? { ...p, x: xy[0], y: xy[1] } : null;
        })
        .filter((p): p is MapPin & { x: number; y: number } => !!p),
    [pins],
  );

  const marker = useMemo(() => {
    if (!markerLatLng) return null;
    const xy = projection([markerLatLng.lng, markerLatLng.lat]);
    return xy ? { x: xy[0], y: xy[1] } : null;
  }, [markerLatLng]);

  /** Converts a client point to SVG user space, accounting for the pan/zoom transform. */
  const toSvgPoint = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * VIEW_W;
    const sy = ((clientY - rect.top) / rect.height) * VIEW_H;
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
  }, [view]);

  const handleTap = useCallback(
    (clientX: number, clientY: number) => {
      const pt = toSvgPoint(clientX, clientY);
      if (!pt) return;
      if (onPickLocation) {
        const inverted = projection.invert?.([pt.x, pt.y]);
        if (inverted) onPickLocation(inverted[1], inverted[0]);
        return;
      }
      if (!onSelectCountry) return;
      // Nearest dot wins within a small radius, since a 4px dot is hard to hit.
      let nearest: { code: string; dist: number } | null = null;
      for (const dot of DOT_COUNTRIES) {
        const dist = Math.hypot(dot.x - pt.x, dot.y - pt.y);
        if (dist < 9 && (!nearest || dist < nearest.dist)) nearest = { code: dot.code, dist };
      }
      if (nearest) {
        onSelectCountry(nearest.code);
        return;
      }
      onSelectCountry(null);
    },
    [onPickLocation, onSelectCountry, toSvgPoint],
  );

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive || !drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.current.moved = true;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    setView((v) => ({
      ...v,
      x: drag.current!.ox + (dx / rect.width) * VIEW_W,
      y: drag.current!.oy + (dy / rect.height) * VIEW_H,
    }));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const wasDrag = drag.current?.moved;
    drag.current = null;
    pinchStart.current = null;
    if (!wasDrag) handleTap(e.clientX, e.clientY);
  };

  const zoomBy = (factor: number) => {
    setView((v) => {
      const k = Math.min(8, Math.max(1, v.k * factor));
      // Keep the map centre fixed while zooming.
      const cx = VIEW_W / 2;
      const cy = VIEW_H / 2;
      const scale = k / v.k;
      return { k, x: cx - (cx - v.x) * scale, y: cy - (cy - v.y) * scale };
    });
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (!interactive) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  const onTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!interactive || e.touches.length !== 2) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    pinchStart.current = {
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      k: view.k,
    };
  };

  const onTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!interactive || e.touches.length !== 2 || !pinchStart.current) return;
    const [a, b] = [e.touches[0], e.touches[1]];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const target = Math.min(8, Math.max(1, pinchStart.current.k * (dist / pinchStart.current.dist)));
    setView((v) => {
      const cx = VIEW_W / 2;
      const cy = VIEW_H / 2;
      const scale = target / v.k;
      return { k: target, x: cx - (cx - v.x) * scale, y: cy - (cy - v.y) * scale };
    });
  };

  return (
    <div className={className ?? 'relative h-full w-full'}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-full w-full touch-none select-none"
        style={{ cursor: onPickLocation ? 'crosshair' : interactive ? 'grab' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        role="img"
        aria-label="World coverage map"
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {RENDERED.map((r, i) => (
            <path
              key={`${r.numeric ?? r.name}-${i}`}
              d={r.d}
              fill={fills[i]}
              stroke={highlightCode && r.code === highlightCode ? '#fff' : STROKE}
              strokeWidth={highlightCode && r.code === highlightCode ? 1.4 / view.k : 0.4 / view.k}
              onClick={(e) => {
                if (onPickLocation || drag.current?.moved) return;
                e.stopPropagation();
                onSelectCountry?.(r.code);
              }}
            />
          ))}

          {DOT_COUNTRIES.map((d, i) => {
            const cell = coverage.byCode.get(d.code);
            // Only draw a microstate marker when it actually carries data, otherwise
            // the map gains 76 meaningless specks.
            if (!cell) return null;
            if (layer === 'entries' && cell.state < 2) return null;
            return (
              <circle
                key={d.code}
                cx={d.x}
                cy={d.y}
                r={(cell.state === 2 ? 4.2 : 3.4) / Math.sqrt(view.k)}
                fill={dotFills[i]}
                stroke={highlightCode === d.code ? '#fff' : '#0b0f19'}
                strokeWidth={1 / view.k}
                onClick={(e) => {
                  if (onPickLocation) return;
                  e.stopPropagation();
                  onSelectCountry?.(d.code);
                }}
              />
            );
          })}

          {projectedPins.map((p) => (
            <g key={p.id} pointerEvents="none">
              <circle
                cx={p.x}
                cy={p.y}
                r={3.6 / Math.sqrt(view.k)}
                fill="#fff"
                stroke="#0b0f19"
                strokeWidth={1 / view.k}
              />
            </g>
          ))}

          {marker && (
            <g pointerEvents="none">
              <circle
                cx={marker.x}
                cy={marker.y}
                r={9 / Math.sqrt(view.k)}
                fill="none"
                stroke="#fff"
                strokeWidth={1.6 / view.k}
                opacity={0.7}
              />
              <circle cx={marker.x} cy={marker.y} r={4 / Math.sqrt(view.k)} fill="#f0447d" />
            </g>
          )}
        </g>
      </svg>

      {interactive && (
        <div className="absolute right-2 bottom-2 flex flex-col gap-1">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoomBy(1.4)}
            className="h-9 w-9 rounded-lg bg-ink-2/90 text-lg leading-none text-white ring-1 ring-line backdrop-blur"
          >
            +
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.4)}
            className="h-9 w-9 rounded-lg bg-ink-2/90 text-lg leading-none text-white ring-1 ring-line backdrop-blur"
          >
            −
          </button>
          {(view.k !== 1 || view.x !== 0 || view.y !== 0) && (
            <button
              type="button"
              aria-label="Reset view"
              onClick={() => setView({ k: 1, x: 0, y: 0 })}
              className="h-9 w-9 rounded-lg bg-ink-2/90 text-xs leading-none text-white ring-1 ring-line backdrop-blur"
            >
              ⟲
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { ALPHA2_BY_NUMERIC, RENDERABLE_NUMERICS };
