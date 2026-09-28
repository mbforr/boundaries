import type { Map as MapboxMap } from 'mapbox-gl';

/**
 * The AZ-264 corridor, and a dot driving east along it.
 *
 * This is the one piece of geometry in the deck that is not a boundary, which is why it
 * lives here rather than in the layer registry: a road has no pen, no authority and no
 * vintage, and putting it in the boundary manifest would make it look like one of the 68.
 *
 * It is a REAL road all the same — TIGER's Arizona primary and secondary roads, fetched by
 * scripts/fetch_scene_props.py with provenance in qa/scene_props.md. The scene used to
 * draw no road at all, on the grounds that a stylised highway would be the only fabricated
 * line in a film about real lines. That reasoning was right; the conclusion was avoidable.
 *
 * The file arrives pre-split into runs of constant time zone, each carrying the zone, the
 * nation under it and the wall clock there, all computed against the same time zone file
 * the scene draws. So the clock changing under the dot is not scripted — it is read off
 * the polygons, and it cannot drift out of step with what is on screen.
 */
export interface DriveRun {
  seq: number;
  std_name: string;
  /** MDT or MST. */
  clock: string;
  /** The wall clock on a summer afternoon: 2:00 in Denver, 1:00 in Phoenix. */
  time: string;
  /** Navajo Nation or Hopi, from the reservation polygons. Null outside both. */
  land: string | null;
  t0: number;
  t1: number;
  km: number;
}

const SRC = 'bs:road';
const DOT = 'bs:road:dot';
const LINE_ID = 'bs:road:line';
const CASING_ID = 'bs:road:casing';
const DOT_ID = 'bs:road:dot';

/** Same two colours the scene paints the zones in, so road and ground agree. */
const ZONE_COLOR: unknown[] = [
  'match', ['get', 'std_name'],
  'America/Denver', '#E69F00',
  'America/Phoenix', '#56B4E9',
  '#8a94a0',
];

export class Drive {
  private zoneRuns: DriveRun[] = [];
  /** Every vertex of the corridor, west to east, and the distance to each. */
  private path: [number, number][] = [];
  private cum: number[] = [];
  private total = 0;
  private loading?: Promise<void>;

  constructor(private map: MapboxMap, private url = 'data/derived/az264.geojson') {}

  ensure(): Promise<void> {
    if (!this.loading) {
      this.loading = this.load().catch((e) => {
        // Don't cache the failure: the scene can try again rather than losing the road
        // for the rest of the session.
        this.loading = undefined;
        throw e;
      });
    }
    return this.loading;
  }

  private async load(): Promise<void> {
    const res = await fetch(this.url);
    if (!res.ok) throw new Error(`${this.url}: HTTP ${res.status}`);
    const data = await res.json() as {
      features: { properties: DriveRun; geometry: { coordinates: [number, number][] } }[];
    };

    const feats = [...data.features].sort((a, b) => a.properties.seq - b.properties.seq);
    this.zoneRuns = feats.map((f) => f.properties);
    this.path = [];
    for (const f of feats) {
      for (const c of f.geometry.coordinates) {
        // Consecutive runs share the vertex where the zone changes; keep it once.
        const last = this.path[this.path.length - 1];
        if (last && last[0] === c[0] && last[1] === c[1]) continue;
        this.path.push(c);
      }
    }

    this.cum = [0];
    for (let i = 1; i < this.path.length; i++) {
      this.cum.push(this.cum[i - 1]! + dist(this.path[i - 1]!, this.path[i]!));
    }
    this.total = this.cum[this.cum.length - 1] ?? 0;

    if (this.map.getSource(SRC)) return;
    this.map.addSource(SRC, { type: 'geojson', data: data as never });
    this.map.addSource(DOT, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] } as never,
    });

    // Under the basemap's labels, like every boundary layer, so place names stay readable.
    const before = this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id;

    // A dark casing under the road: at corridor zoom the line crosses its own zone fill,
    // and without it the road vanishes wherever the two colours match.
    this.map.addLayer({
      id: CASING_ID, type: 'line', source: SRC,
      paint: { 'line-color': '#05070a', 'line-width': 5.4, 'line-opacity': 0 },
      layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
    }, before);
    this.map.addLayer({
      id: LINE_ID, type: 'line', source: SRC,
      paint: { 'line-color': ZONE_COLOR as never, 'line-width': 2.4, 'line-opacity': 0 },
      layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
    }, before);
    this.map.addLayer({
      id: DOT_ID, type: 'circle', source: DOT,
      paint: {
        'circle-radius': 6,
        'circle-color': '#fff',
        'circle-stroke-width': 2,
        'circle-stroke-color': 'rgba(255,255,255,0.28)',
        'circle-opacity': 0,
        'circle-stroke-opacity': 0,
      },
      layout: { visibility: 'none' },
    }, before);
  }

  /** The zone runs, west to east. Empty until `ensure` resolves. */
  runs(): DriveRun[] { return this.zoneRuns; }

  /** The road's own extent, for framing the corridor. */
  bounds(): [[number, number], [number, number]] | null {
    if (!this.path.length) return null;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [x, y] of this.path) {
      if (x < w) w = x; if (x > e) e = x;
      if (y < s) s = y; if (y > n) n = y;
    }
    return [[w, s], [e, n]];
  }

  private opacity(v: number): void {
    const set = this.map.setPaintProperty.bind(this.map) as
      (l: string, p: string, x: unknown) => void;
    if (!this.map.getLayer(LINE_ID)) return;
    for (const id of [CASING_ID, LINE_ID, DOT_ID]) {
      this.map.setLayoutProperty(id, 'visibility', v > 0 ? 'visible' : 'none');
    }
    set(CASING_ID, 'line-opacity', v * 0.85);
    set(LINE_ID, 'line-opacity', v);
    set(DOT_ID, 'circle-opacity', v);
    set(DOT_ID, 'circle-stroke-opacity', v * 0.5);
  }

  /** Fade the road and the dot in or out. ms = 0 is instant. */
  async fade(to: number, ms: number): Promise<void> {
    if (!this.map.getLayer(LINE_ID)) return;
    const set = this.map.setPaintProperty.bind(this.map) as
      (l: string, p: string, x: unknown) => void;
    for (const [id, prop] of [[CASING_ID, 'line-opacity'], [LINE_ID, 'line-opacity'],
                              [DOT_ID, 'circle-opacity'], [DOT_ID, 'circle-stroke-opacity']]) {
      set(id!, `${prop}-transition`, { duration: ms, delay: 0 });
    }
    if (to > 0) for (const id of [CASING_ID, LINE_ID, DOT_ID]) {
      this.map.setLayoutProperty(id, 'visibility', 'visible');
    }
    this.opacity(to);
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    if (to === 0) for (const id of [CASING_ID, LINE_ID, DOT_ID]) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', 'none');
    }
  }

  /**
   * Put the dot at fraction `t` along the corridor and say which run it is in.
   *
   * The position is interpolated between vertices rather than snapped to one, so the dot
   * moves smoothly through the long straight stretches where TIGER puts a vertex every
   * few kilometres.
   */
  at(t: number): DriveRun | null {
    if (!this.path.length) return null;
    const want = Math.max(0, Math.min(1, t)) * this.total;

    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! < want) lo = mid + 1; else hi = mid;
    }
    const i = Math.max(1, lo);
    const a = this.path[i - 1]!;
    const b = this.path[i]!;
    const seg = this.cum[i]! - this.cum[i - 1]!;
    const f = seg > 0 ? (want - this.cum[i - 1]!) / seg : 0;
    const here: [number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

    const src = this.map.getSource(DOT) as { setData: (d: unknown) => void } | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {},
                   geometry: { type: 'Point', coordinates: here } }],
    });

    /*
     * The last run that has started, not the run that contains the point.
     *
     * The runs do not quite tile the interval: each ends at its last vertex and the next
     * begins at the following one, so wherever TIGER has a long straight segment there is
     * a gap between them — the first is 650 m of road near Moenkopi. A containment test
     * matches nothing in those gaps, and falling back to the last run, as this did,
     * reported the clock at Window Rock while the dot was still in the first ten miles.
     */
    const frac = Math.max(0, Math.min(1, t));
    let inRun: DriveRun | null = this.zoneRuns[0] ?? null;
    for (const r of this.zoneRuns) {
      if (frac >= r.t0) inRun = r; else break;
    }
    return inRun;
  }

  /** Take the road off the map outright. Called by applyEndState — see the note there. */
  clear(): void {
    if (!this.map.getLayer(LINE_ID)) return;
    const set = this.map.setPaintProperty.bind(this.map) as
      (l: string, p: string, x: unknown) => void;
    for (const [id, prop] of [[CASING_ID, 'line-opacity'], [LINE_ID, 'line-opacity'],
                              [DOT_ID, 'circle-opacity'], [DOT_ID, 'circle-stroke-opacity']]) {
      set(id!, `${prop}-transition`, { duration: 0, delay: 0 });
    }
    this.opacity(0);
  }
}

/** Kilometres, with longitude scaled by latitude. Good to a metre over a highway. */
function dist(a: [number, number], b: [number, number]): number {
  const kx = 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const dx = (b[0] - a[0]) * kx;
  const dy = (b[1] - a[1]) * 110.57;
  return Math.sqrt(dx * dx + dy * dy);
}
