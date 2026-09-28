/**
 * Bounds of a GeoJSON object, for framing a layer that has no named camera.
 *
 * Two things make this harder than a min/max.
 *
 * THE ANTIMERIDIAN. Every national layer that includes Alaska has Aleutian geometry on
 * both sides of 180°, so a naive min/max gives -180..180 and the "fit" is the entire
 * globe — the US layers were the ones that needed framing most and would have been framed
 * worst. If the naive span exceeds 180°, the data is re-measured with eastern longitudes
 * shifted negative (179 becomes -181), which puts the Aleutians at the western end of the
 * country, where a reader expects them.
 *
 * OUTLIERS. `census_state` is 56 features: the 50 states, DC, and five territories. Its
 * true extent runs from Guam at 145°E to Maine — 151° of longitude — and framing to that
 * renders the United States as a smudge in an ocean.
 *
 * The cure is NOT a percentile, and two dead ends are worth recording. Trimming a fixed 1%
 * tail changed nothing, because Guam and American Samoa are together more than 1% of this
 * layer's 35,124 coordinates. Widening the tail to 2% and accepting it whenever it shrank
 * the frame by a third then cropped layers that have no outliers at all: New York's 14
 * congressional districts were being trimmed, losing real geometry off a compact layer to
 * fix a problem it does not have.
 *
 * What actually distinguishes an outlying island is a GAP — a wide stretch of nothing
 * between it and the body of the layer. So the tail of each axis is searched for an empty
 * run wider than a tenth of that axis's span, and the frame is cut there if one exists.
 * census_state has two (Guam to the Aleutians, American Samoa to Hawaii) and loses both
 * territories while keeping Alaska and Hawaii. New York has none and is left alone. A
 * layer is only ever cut where the data itself is empty.
 *
 * When a cut happens the caller is told, and both gallery pages say so on screen: a frame
 * that silently omits part of a layer would undermine the one thing those pages are for.
 *
 * None of this is a measurement. It decides where to point a camera, nothing else.
 */
export type Bbox = [number, number, number, number]; // w, s, e, n

/** How far in from each end to look for the gap. Beyond this, it is not an outlier. */
const TAIL = 0.04;
/** An empty run must be at least this much of the axis span to count as a gap. */
const GAP = 0.1;

export interface Framing {
  /** The layer's true extent. */
  full: Bbox | null;
  /** Where to point the camera: `full`, unless outliers were cut away. */
  framed: Bbox | null;
  /** True when `framed` is a cut, and so when something is off-frame. */
  trimmed: boolean;
}

/**
 * Plain extent — a min/max walk, no antimeridian shift and no outlier cut.
 *
 * This is the cheap one, and it answers a different question: not "where should the camera
 * point" but "is this place inside this layer at all". /flash.html needs that because six
 * of the derived layers are registered as national but are regional in fact — the District
 * of Wyoming, the McGirt reservations, Navajo and Hopi, the two gerrymanders, and the
 * Tulsa/Las Vegas scene props — and a montage standing in New York must not give them a
 * beat in which nothing is on screen.
 *
 * Containment in this box is necessary, not sufficient: a layer can span a point without
 * covering it. It is exact for the six that matter, whose boxes are nowhere near New York.
 */
export function bboxOf(data: unknown): Bbox | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  let any = false;
  walk(data, (lon, lat) => {
    any = true;
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  });
  return any ? [w, s, e, n] : null;
}

/** True when the point falls inside the box, with a small tolerance. */
export function bboxCovers(b: Bbox, lng: number, lat: number, pad = 0.02): boolean {
  return lng >= b[0] - pad && lng <= b[2] + pad && lat >= b[1] - pad && lat <= b[3] + pad;
}

export function boundsOf(data: unknown, full = false): Bbox | null {
  const f = framingOf(data);
  return full ? f.full : f.framed;
}

export function framingOf(data: unknown): Framing {
  const lons: number[] = [];
  const lats: number[] = [];
  let sawWest = false, sawEast = false;

  walk(data, (lon, lat) => {
    lons.push(lon);
    lats.push(lat);
    if (lon < -100) sawWest = true;
    if (lon > 100) sawEast = true;
  });
  if (!lons.length) return { full: null, framed: null, trimmed: false };

  const [w0, e0] = minMax(lons);
  if (e0 - w0 > 180 && sawWest && sawEast) {
    for (let i = 0; i < lons.length; i++) {
      if (lons[i]! > 0) lons[i] = lons[i]! - 360;
    }
  }

  const [w, e] = minMax(lons);
  const [s, n] = minMax(lats);
  const full: Bbox = [w, s, e, n];

  const x = cutOutliers(lons);
  const y = cutOutliers(lats);
  const trimmed = x.cut || y.cut;
  return { full, framed: trimmed ? [x.lo, y.lo, x.hi, y.hi] : full, trimmed };
}

/**
 * The axis range with far-flung outliers cut off at the gap that separates them.
 *
 * Works on a stride sample rather than the whole array: the biggest layer in the export
 * has millions of coordinates, and sorting that twice per layer would dominate the reel's
 * frame budget. A 40,000-point sample locates a gap a tenth of the map wide to far more
 * precision than a camera can use.
 */
function cutOutliers(xs: number[]): { lo: number; hi: number; cut: boolean } {
  const CAP = 40000;
  const stride = Math.max(1, Math.ceil(xs.length / CAP));
  const sample: number[] = [];
  for (let i = 0; i < xs.length; i += stride) sample.push(xs[i]!);
  sample.sort((a, b) => a - b);

  const last = sample.length - 1;
  const span = sample[last]! - sample[0]!;
  if (span <= 0 || sample.length < 20) {
    return { lo: sample[0]!, hi: sample[last]!, cut: false };
  }
  const minGap = span * GAP;
  const reach = Math.max(1, Math.floor(sample.length * TAIL));

  // Scan inward from each end keeping the INNERMOST qualifying gap: an axis can carry more
  // than one outlying cluster — this longitude carries Guam and then the Aleutians — and
  // the frame wants to start past all of them.
  let lo = sample[0]!;
  let cutLo = false;
  for (let i = 0; i < reach; i++) {
    if (sample[i + 1]! - sample[i]! >= minGap) { lo = sample[i + 1]!; cutLo = true; }
  }
  let hi = sample[last]!;
  let cutHi = false;
  for (let i = last; i > last - reach; i--) {
    if (sample[i]! - sample[i - 1]! >= minGap) { hi = sample[i - 1]!; cutHi = true; }
  }
  return { lo, hi, cut: cutLo || cutHi };
}

function minMax(xs: number[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const x of xs) { if (x < lo) lo = x; if (x > hi) hi = x; }
  return [lo, hi];
}

/** Calls `fn` for every coordinate pair in any GeoJSON value, at any nesting depth. */
export function walk(node: unknown, fn: (lon: number, lat: number) => void): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    if (typeof node[0] === 'number' && typeof node[1] === 'number') {
      fn(node[0], node[1]);
      return;
    }
    for (const child of node) walk(child, fn);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj.features) { walk(obj.features, fn); return; }
  if (obj.geometry) { walk(obj.geometry, fn); return; }
  if (obj.geometries) { walk(obj.geometries, fn); return; }
  if (obj.coordinates) { walk(obj.coordinates, fn); return; }
}
