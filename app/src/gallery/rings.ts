import { PEN_ORDER, type Pen } from '../pens';

/**
 * A layer, exploded into the individual rings a pen would actually draw.
 *
 * A polygon's outline is not one stroke: a county with an island is two, a state with a
 * lake is an exterior and a hole. Drawing the layer honestly means drawing every ring, so
 * the unit of animation here is the ring, not the feature.
 */
export interface Ring {
  /** Position in draw order, assigned after sorting. Carried onto the feature. */
  seq: number;
  coords: [number, number][];
  /** Cumulative planar length, one entry per coordinate. cum[0] is 0. */
  cum: number[];
  total: number;
  /** Ring centroid, for ordering and for the sweep. */
  cx: number;
  cy: number;
  /** Shoelace area, unsigned. Orders big shapes before small ones when asked. */
  area: number;
  /** The feature's own pen, for the files that carry one per feature. */
  pen: Pen | null;
}

export type Order = 'lon' | 'lat' | 'area' | 'file';

/**
 * Distance in degrees, with longitude scaled by cos(latitude).
 *
 * The pen should move at a constant speed ACROSS THE SCREEN, and a degree of longitude at
 * 49°N is two thirds of a degree at the equator. Without the cosine the pen visibly
 * hurries through northern geometry. This is for pacing only — nothing here is a
 * measurement anyone should quote.
 */
function dist(a: [number, number], b: [number, number]): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const dx = (b[0] - a[0]) * k;
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function ringOf(coords: [number, number][], pen: Pen | null): Ring | null {
  if (coords.length < 2) return null;
  const cum = [0];
  let total = 0;
  let cx = 0, cy = 0, twice = 0;
  for (let i = 1; i < coords.length; i++) {
    total += dist(coords[i - 1]!, coords[i]!);
    cum.push(total);
  }
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i]!;
    const [x2, y2] = coords[i + 1]!;
    twice += x1 * y2 - x2 * y1;
    cx += x1; cy += y1;
  }
  const n = Math.max(1, coords.length - 1);
  if (total === 0) return null;
  return { seq: 0, coords, cum, total, cx: cx / n, cy: cy / n, area: Math.abs(twice) / 2, pen };
}

function isPen(v: unknown): v is Pen {
  return typeof v === 'string' && (PEN_ORDER as readonly string[]).includes(v);
}

/** Every ring in a FeatureCollection, ordered for drawing. */
export function ringsOf(data: unknown, order: Order): Ring[] {
  const out: Ring[] = [];
  const fc = data as { features?: unknown[] };
  for (const f of fc.features ?? []) {
    const feat = f as { geometry?: { type?: string; coordinates?: unknown };
                        properties?: Record<string, unknown> };
    const geom = feat.geometry;
    if (!geom || !geom.coordinates) continue;
    const pen = isPen(feat.properties?.pen) ? feat.properties!.pen as Pen : null;
    const polys: unknown[] =
      geom.type === 'Polygon' ? [geom.coordinates]
      : geom.type === 'MultiPolygon' ? geom.coordinates as unknown[]
      : geom.type === 'LineString' ? [[geom.coordinates]]
      : geom.type === 'MultiLineString' ? [geom.coordinates as unknown[]]
      : [];
    for (const poly of polys) {
      for (const ring of poly as unknown[]) {
        const r = ringOf(ring as [number, number][], pen);
        if (r) out.push(r);
      }
    }
  }

  /*
   * Draw order is the whole character of the animation. Sorting west to east makes the pen
   * sweep across the country, which is what reads as "drawing a map"; file order makes it
   * jump around, which reads as a machine emitting records — occasionally the more honest
   * picture of what a shapefile actually is, so it stays available.
   */
  const key = (r: Ring) =>
    order === 'lon' ? r.cx
    : order === 'lat' ? -r.cy
    : order === 'area' ? -r.area
    : 0;
  if (order !== 'file') out.sort((a, b) => key(a) - key(b));
  out.forEach((r, i) => { r.seq = i; });
  return out;
}

/** The ring as a GeoJSON LineString feature, carrying its draw order and pen. */
export function ringFeature(r: Ring): unknown {
  return {
    type: 'Feature',
    properties: { seq: r.seq, pen: r.pen },
    geometry: { type: 'LineString', coordinates: r.coords },
  };
}

/**
 * The first `fraction` of a ring, with the final point interpolated so the pen tip lands
 * between vertices rather than snapping from one to the next.
 */
export function trace(r: Ring, fraction: number): [number, number][] {
  const want = Math.max(0, Math.min(1, fraction)) * r.total;
  if (want <= 0) return [r.coords[0]!];

  // The cumulative lengths ascend, so the segment containing the tip is a binary search.
  let lo = 0, hi = r.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (r.cum[mid]! < want) lo = mid + 1; else hi = mid;
  }
  const i = Math.max(1, lo);
  const a = r.coords[i - 1]!;
  const b = r.coords[i]!;
  const seg = r.cum[i]! - r.cum[i - 1]!;
  const t = seg > 0 ? (want - r.cum[i - 1]!) / seg : 0;
  const tip: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  return [...r.coords.slice(0, i), tip];
}
