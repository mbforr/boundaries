import mapboxgl, { type Map as MapboxMap, type MapMouseEvent } from 'mapbox-gl';
import { ESB } from '../config';
import { PENS } from '../pens';
import { requireToken, watchTokenErrors } from '../token';
import type { CatalogRow } from '../catalog.generated';
import { STYLE, labelAnchor, restyleLight } from './basemap';
import { ink, type Theme } from './colors';
import { escapeHtml } from './html';
import { BY_N } from './state';

/** The opening view: the Empire State Building at a Manhattan zoom. */
export const HOME = { center: ESB, zoom: 11.2 };
const COUNTRY = { center: [-97, 39.5] as [number, number], zoom: 3.4 };
const PAINT = { fill: 0.18, line: 1.5 };

export interface MapHooks {
  /** A type's file started or finished loading. */
  onLoading(n: number, busy: boolean): void;
  /** A type's file failed to load; the caller switches it back off. */
  onError(n: number, message: string): void;
}

const fillId = (n: number) => `ex:${n}:fill`;
const lineId = (n: number) => `ex:${n}:line`;
const srcId = (path: string) => `ex:${path}`;

/** `{LSAD: ['M1']}` → a mapbox filter. Two types that share one file differ only here. */
function filterOf(r: CatalogRow): unknown[] | null {
  if (!r.filter) return null;
  const parts = Object.entries(r.filter).map(
    ([prop, vals]) => ['in', ['to-string', ['get', prop]], ['literal', vals]]);
  return parts.length === 1 ? parts[0]! : ['all', ...parts];
}

/**
 * The explorer's map. Owns its own sources and layers rather than reusing the deck's
 * LayerManager, which keys one style layer per file: here #5 and #9 share census_place
 * and #14 and #17 share census_cbsa, but each pair needs its own colour or filter.
 */
export class ExploreMap {
  readonly map: MapboxMap;
  private theme: Theme;
  private on = new Set<number>();
  /** Parsed GeoJSON by path. Kept across theme changes, which wipe every source. */
  private data = new Map<string, Promise<unknown>>();
  private styleReady: Promise<void>;
  private tip: HTMLElement;

  constructor(container: HTMLElement, theme: Theme, private hooks: MapHooks) {
    mapboxgl.accessToken = requireToken();
    this.theme = theme;
    this.map = new mapboxgl.Map({
      container,
      style: STYLE[theme],
      center: HOME.center,
      zoom: HOME.zoom,
      projection: 'mercator',
      attributionControl: false,
      cooperativeGestures: matchMedia('(max-width: 899px)').matches,
    });
    this.map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    this.map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    watchTokenErrors(this.map);
    (window as unknown as { __map: MapboxMap }).__map = this.map;

    this.styleReady = this.onStyle();
    this.tip = document.createElement('div');
    this.tip.className = 'ex-tip';
    this.tip.hidden = true;
    container.appendChild(this.tip);
    this.map.on('mousemove', (e) => this.hover(e));
    this.map.on('mouseout', () => { this.tip.hidden = true; });
    this.map.on('click', (e) => this.hover(e));
  }

  private onStyle(): Promise<void> {
    return new Promise((resolve) => {
      this.map.once('style.load', () => {
        if (this.theme === 'light') restyleLight(this.map);
        resolve();
      });
    });
  }

  /** Switch exactly this set of types on, loading any file not yet fetched. */
  async setOn(next: Set<number>): Promise<void> {
    await this.styleReady;
    for (const n of this.on) if (!next.has(n)) this.hide(n);
    const added = [...next].filter((n) => !this.on.has(n));
    this.on = new Set(next);
    await Promise.all(added.map((n) => this.show(n)));
  }

  private async show(n: number): Promise<void> {
    const r = BY_N.get(n);
    if (!r?.path) return;   // never draw a type with no file
    this.hooks.onLoading(n, true);
    try {
      let p = this.data.get(r.path);
      if (!p) {
        p = fetch(r.path).then((res) => {
          if (!res.ok) throw new Error(`${r.path}: HTTP ${res.status}`);
          return res.json();
        });
        this.data.set(r.path, p);
        p.catch(() => this.data.delete(r.path!));
      }
      const geojson = await p;
      if (!this.on.has(n)) return;   // switched off while loading
      this.addLayers(r, geojson);
    } catch (e) {
      this.on.delete(n);
      this.hooks.onError(n, e instanceof Error ? e.message : String(e));
    } finally {
      this.hooks.onLoading(n, false);
    }
  }

  private addLayers(r: CatalogRow, geojson: unknown): void {
    const m = this.map, src = srcId(r.path!), color = ink(r.pen, this.theme);
    if (!m.getSource(src)) m.addSource(src, { type: 'geojson', data: geojson as never });
    const before = labelAnchor(m);
    const filter = filterOf(r);
    // Re-adding moves a type to the top of the boundary stack: newest on top.
    for (const id of [fillId(r.n), lineId(r.n)]) if (m.getLayer(id)) m.removeLayer(id);
    m.addLayer({
      id: fillId(r.n), type: 'fill', source: src,
      paint: { 'fill-color': color, 'fill-opacity': PAINT.fill },
      ...(filter ? { filter: filter as never } : {}),
    }, before);
    m.addLayer({
      id: lineId(r.n), type: 'line', source: src,
      paint: { 'line-color': color, 'line-width': PAINT.line },
      layout: { 'line-join': 'round' },
      ...(filter ? { filter: filter as never } : {}),
    }, before);
  }

  private hide(n: number): void {
    for (const id of [fillId(n), lineId(n)]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
  }

  /** Swap basemaps and redraw what was on. setStyle drops every source and layer. */
  async setTheme(theme: Theme): Promise<void> {
    if (theme === this.theme) return;
    this.theme = theme;
    this.styleReady = this.onStyle();
    this.map.setStyle(STYLE[theme]);
    await this.styleReady;
    const was = this.on;
    this.on = new Set();
    await this.setOn(was);
  }

  /** True when the view is wide enough that NYC is a speck. */
  zoomedOut(): boolean {
    return this.map.getZoom() < 8.5 || !this.map.getBounds()?.contains(ESB);
  }

  flyHome(): void { this.map.flyTo({ ...HOME, essential: true }); }

  /** Frame a type: national layers show the country, NYC layers show the city. */
  frame(r: CatalogRow): void {
    if (r.scope === 'nyc') this.flyHome();
    else this.map.flyTo({ ...COUNTRY, essential: true });
  }

  /** Tooltip: every switched-on type under the pointer, newest on top. */
  private hover(e: MapMouseEvent): void {
    const layers = [...this.on].map(fillId).filter((id) => this.map.getLayer(id));
    if (!layers.length) { this.tip.hidden = true; return; }
    const hits = this.map.queryRenderedFeatures(e.point, { layers });
    const seen = new Set<number>();
    const lines: string[] = [];
    for (const f of hits) {
      const n = Number(f.layer?.id.split(':')[1]);
      if (seen.has(n)) continue;
      seen.add(n);
      const r = BY_N.get(n);
      if (!r) continue;
      // mapbox-gl 3.9's GeoJSONFeature type omits `properties`, though every feature has it.
      const props = (f as unknown as { properties?: Record<string, unknown> }).properties;
      const name = String(props?.std_name ?? props?.NAME ?? 'Unnamed');
      lines.push(
        `<div class="ex-tip-row"><span class="ex-sw" style="--c:${ink(r.pen, this.theme)}"></span>` +
        `<span><b>${escapeHtml(name)}</b><br><span class="ex-muted">` +
        `<span class="ex-num">#${r.n}</span> ${escapeHtml(r.label)} · ${PENS[r.pen].label}` +
        `</span></span></div>`);
    }
    if (!lines.length) { this.tip.hidden = true; return; }
    this.tip.innerHTML = lines.slice(0, 6).join('') +
      (lines.length > 6 ? `<div class="ex-muted">and ${lines.length - 6} more</div>` : '');
    this.tip.hidden = false;
    const { width, height } = this.map.getContainer().getBoundingClientRect();
    const x = Math.min(e.point.x + 14, width - this.tip.offsetWidth - 8);
    const y = e.point.y + 14 + this.tip.offsetHeight > height
      ? e.point.y - this.tip.offsetHeight - 14 : e.point.y + 14;
    this.tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }
}
