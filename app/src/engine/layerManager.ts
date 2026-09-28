import type { Map as MapboxMap } from 'mapbox-gl';
import { LAYERS, type LayerId } from '../layers.generated';
import { PENS, PEN_ORDER, type Pen } from '../pens';
import { PAINT } from '../config';
import { bboxOf, type Bbox } from '../gallery/bounds';

/**
 * A layer's colour. A null pen means the features carry their own — the reveal stack is
 * 49 polygons from six different pens in one file — so it resolves to a match expression
 * on the feature's `pen` property instead of a constant.
 */
export function penPaint(pen: Pen | null): string | unknown[] {
  if (pen) return PENS[pen].color;
  return [
    'match', ['get', 'pen'],
    ...PEN_ORDER.flatMap((p) => [p, PENS[p].color]),
    '#8a94a0',
  ];
}

/**
 * Owns the map's sources and style layers.
 *
 * Sources are added lazily. The full export is ~91 MB, so adding all 51 at boot would
 * stall the first paint for a minute; instead a layer is fetched the first time a scene
 * asks for it, and `prefetch` warms the next few scenes in the background. Every add is
 * cached by a promise, so two scenes asking at once share one fetch.
 */
export class LayerManager {
  private added = new Map<LayerId, Promise<void>>();
  /**
   * Each layer's plain extent, taken while the GeoJSON is already parsed and in hand. Only
   * the four numbers are kept; the features go to mapbox and are forgotten here.
   */
  private extents = new Map<LayerId, Bbox>();
  private loading = 0;
  /**
   * The first symbol layer in the basemap. Boundary layers are inserted before it, so
   * place and state labels draw ON TOP of the fills instead of being buried under them.
   */
  private labelAnchor: string | undefined;

  constructor(
    private map: MapboxMap,
    private onLoadingChange: (busy: boolean) => void,
  ) {}

  /** Call once the style is loaded, before any layer is added. */
  findLabelAnchor(): void {
    this.labelAnchor = this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  }

  fillId(id: LayerId): string { return `bs:${id}:fill`; }
  lineId(id: LayerId): string { return `bs:${id}:line`; }

  /** Every layer the app knows about, whether or not it has been added yet. */
  allIds(): LayerId[] { return Object.keys(LAYERS) as LayerId[]; }

  /** True once the style layers actually exist, not merely once a fetch has started. */
  isAdded(id: LayerId): boolean {
    return this.map.getLayer(this.fillId(id)) !== undefined;
  }

  ensure(id: LayerId): Promise<void> {
    const cached = this.added.get(id);
    if (cached) return cached;
    const p = this.add(id).catch((e) => {
      // Don't cache a failure: one flaky request would blank the layer for the whole
      // session. Forget it so the next scene that needs it tries again.
      this.added.delete(id);
      throw e;
    });
    this.added.set(id, p);
    return p;
  }

  private async add(id: LayerId): Promise<void> {
    const def = LAYERS[id];
    this.loading++;
    this.onLoadingChange(true);
    try {
      const res = await fetch(def.path);
      if (!res.ok) throw new Error(`${def.path}: HTTP ${res.status}`);
      const data = await res.json();
      const box = bboxOf(data);
      if (box) this.extents.set(id, box);
      const src = `bs:${id}`;
      if (!this.map.getSource(src)) {
        this.map.addSource(src, { type: 'geojson', data });
      }
      const color = penPaint(def.pen);
      const before = this.labelAnchor && this.map.getLayer(this.labelAnchor)
        ? this.labelAnchor : undefined;
      if (!this.map.getLayer(this.fillId(id))) {
        this.map.addLayer({
          id: this.fillId(id), type: 'fill', source: src,
          paint: { 'fill-color': color as never, 'fill-opacity': 0 },
          layout: { visibility: 'none' },
        }, before);
      }
      if (!this.map.getLayer(this.lineId(id))) {
        this.map.addLayer({
          id: this.lineId(id), type: 'line', source: src,
          paint: {
            'line-color': color as never,
            'line-width': PAINT.lineWidth,
            'line-opacity': 0,
          },
          layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
        }, before);
      }
    } finally {
      this.loading--;
      this.onLoadingChange(this.loading > 0);
    }
  }

  /**
   * Remove a layer's style layers and source outright, and forget the fetch.
   *
   * The deck never calls this — it preloads and keeps. The gallery does, because showing
   * all 59 layers in one run means every source in the export is live at once otherwise,
   * and the export is 94 MB before mapbox tiles it. A sliding window keeps the reel flat.
   */
  drop(id: LayerId): void {
    for (const l of [this.fillId(id), this.lineId(id)]) {
      if (this.map.getLayer(l)) this.map.removeLayer(l);
    }
    const src = `bs:${id}`;
    if (this.map.getSource(src)) this.map.removeSource(src);
    this.added.delete(id);
    // The extent is kept: it is four numbers, it cannot change, and re-deriving it would
    // mean re-parsing the file on the next pass round the reel.
  }

  /** The layer's extent, once added. See gallery/bounds.ts — containment tests only. */
  bbox(id: LayerId): Bbox | undefined { return this.extents.get(id); }

  /** Warm layers we are about to need, without blocking the current scene. */
  prefetch(ids: LayerId[]): void {
    for (const id of ids) if (!this.added.has(id)) void this.ensure(id);
  }

  hide(id: LayerId): void {
    if (!this.added.has(id)) return;
    for (const l of [this.fillId(id), this.lineId(id)]) {
      if (this.map.getLayer(l)) this.map.setLayoutProperty(l, 'visibility', 'none');
    }
  }

  show(id: LayerId, opts: {
    fillOpacity: number | unknown[]; lineOpacity: number | unknown[];
    lineWidth: number | unknown[];
    color?: string | unknown[]; filter?: unknown[]; pattern?: string;
  }): void {
    const fill = this.fillId(id), line = this.lineId(id);
    if (!this.map.getLayer(fill)) return;
    const color = opts.color ?? penPaint(LAYERS[id].pen);
    this.map.setLayoutProperty(fill, 'visibility', 'visible');
    this.map.setLayoutProperty(line, 'visibility', 'visible');
    this.map.setPaintProperty(fill, 'fill-color', color as never);
    // A null pattern clears the previous scene's — never leave one behind.
    this.map.setPaintProperty(fill, 'fill-pattern', (opts.pattern ?? null) as never);
    this.map.setPaintProperty(fill, 'fill-opacity', opts.fillOpacity as never);
    this.map.setPaintProperty(line, 'line-color', color as never);
    this.map.setPaintProperty(line, 'line-opacity', opts.lineOpacity as never);
    this.map.setPaintProperty(line, 'line-width', opts.lineWidth as never);
    // A null filter clears any previous scene's filter — never leave one behind.
    this.map.setFilter(fill, (opts.filter ?? null) as never);
    this.map.setFilter(line, (opts.filter ?? null) as never);
  }

  /**
   * Animate a paint property via its `-transition` sibling. Resolves when it lands.
   * ms = 0 sets the value instantly, which is how end states are applied.
   */
  transition(layerId: string, prop: string, to: number | unknown[], ms: number): Promise<void> {
    if (!this.map.getLayer(layerId)) return Promise.resolve();
    const set = this.map.setPaintProperty.bind(this.map) as
      (l: string, p: string, v: unknown) => void;
    set(layerId, `${prop}-transition`, { duration: ms, delay: 0 });
    set(layerId, prop, to);
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  /** Clear any running transition so the next paint write is instantaneous. */
  instant(id: LayerId): void {
    for (const l of [this.fillId(id), this.lineId(id)]) {
      if (!this.map.getLayer(l)) continue;
      const prop = l.endsWith(':fill') ? 'fill-opacity' : 'line-opacity';
      (this.map.setPaintProperty as (a: string, b: string, c: unknown) => void)(
        l, `${prop}-transition`, { duration: 0, delay: 0 });
    }
  }
}
