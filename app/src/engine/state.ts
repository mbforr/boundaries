import type { Map as MapboxMap } from 'mapbox-gl';
import type { LayerId } from '../layers.generated';
import { PAINT } from '../config';
import type { LabelGroup, Scene } from './types';
import type { LayerManager } from './layerManager';
import type { Hud } from '../hud';
import type { Overlays } from '../overlays';
import type { Drive } from './drive';
import { filmStyle } from '../filmstyle';

/**
 * Applies a scene's END STATE, idempotently.
 *
 * The critical detail is that this walks the ENTIRE layer registry, not just the layers
 * the scene lists. Anything the scene does not name is explicitly hidden. That is what
 * makes navigation a pure function of the scene index: arriving from the left, from the
 * right, or from a cold page load produces the same frame, because nothing is inherited.
 *
 * The camera jumps. Flying belongs to choreography, never to end-state application.
 */
export async function applyEndState(
  map: MapboxMap,
  layers: LayerManager,
  hud: Hud,
  overlays: Overlays,
  drive: Drive,
  scene: Scene,
): Promise<void> {
  // A layer that fails to load must not take the whole scene down with it: the rest of
  // the frame is still worth showing, and the console error says which one to look at.
  await Promise.all(scene.layers.map((v) =>
    layers.ensure(v.id).catch((e) => {
      console.error(`scene ${scene.id}: layer ${v.id} failed to load`, e);
    })));

  const wanted = new Map<LayerId, (typeof scene.layers)[number]>();
  for (const v of scene.layers) {
    if (wanted.has(v.id)) {
      // One source, one fill, one line. Two views of the same layer cannot both render —
      // use a data-driven paint expression instead of listing the layer twice.
      throw new Error(
        `scene ${scene.id} lists ${v.id} twice; use a paint expression, not two entries`);
    }
    wanted.set(v.id, v);
  }

  for (const id of layers.allIds()) {
    if (!layers.isAdded(id)) continue; // never added, so already invisible
    layers.instant(id); // clear any in-flight transition before writing
    const view = wanted.get(id);
    if (!view) { layers.hide(id); continue; }
    layers.show(id, {
      fillOpacity: view.paint?.fillOpacity ?? PAINT.fillOpacity,
      lineOpacity: view.paint?.lineOpacity ?? PAINT.lineOpacity,
      lineWidth: view.paint?.lineWidth ?? PAINT.lineWidth,
      color: view.paint?.color,
      pattern: view.paint?.pattern,
      filter: view.filter as unknown[] | undefined,
    });
  }

  setLabels(map, scene.labels);

  map.jumpTo({
    center: scene.camera.center,
    zoom: scene.camera.zoom,
    pitch: scene.camera.pitch ?? 0,
    bearing: scene.camera.bearing ?? 0,
  });

  hud.setCounter(scene.counter);
  hud.setPen(scene.pen);
  hud.setCaption(scene.caption);
  hud.setCard(scene.card);
  overlays.apply(scene.overlay);
  /*
   * The road is choreography only and belongs to no scene's end state, so it comes off
   * here unconditionally. That is what keeps it inside the determinism guarantee: arriving
   * at the Arizona scene by driving it and arriving by stepping back onto it both land on
   * the same frame, with no road.
   */
  drive.clear();
}

/**
 * Basemap labels are off by default and opted back in per scene.
 *
 * dark-v11 has no stable public label-group API, so groups are matched by layer id
 * prefix. The ids are stable across v11 patch releases; if Mapbox renames one the effect
 * is a missing label, never a crash.
 */
const US_ONLY = ['==', ['get', 'iso_3166_1'], 'US'];
const originalFilters = new Map<string, unknown>();

const LABEL_GROUPS: Record<LabelGroup, string[]> = {
  country: ['country-label'],
  state: ['state-label'],
  /** Cities and towns. Deliberately not neighbourhoods. */
  place: ['settlement-major-label', 'settlement-minor-label', 'settlement-label'],
  /** Neighbourhoods, for the close-up scenes where a city name is useless. */
  neighbourhood: ['settlement-subdivision-label'],
};

/** Only these groups get the US filter; settlement labels do not all carry the field. */
const US_FILTERED = new Set(['state-label', 'country-label']);

/**
 * Labels sit above the boundary fills, so they have to read against a saturated colour as
 * well as against the dark ground. dark-v11 styles them for the ground alone, which left
 * state names nearly invisible over an orange county fill. A light face and a dark halo
 * work over both.
 */
const LABEL_INK = '#e8ecf1';
const LABEL_HALO = 'rgba(6, 8, 11, 0.9)';

function styleLabel(map: MapboxMap, id: string): void {
  const set = map.setPaintProperty.bind(map) as (l: string, p: string, v: unknown) => void;
  /*
   * On a plate the names are the plate's, not the deck's.
   *
   * This runs on every scene change, so without the check the film look would be undone
   * by the next arrow press — the deck would repaint #e8ecf1 over the pure white the plate
   * had just set. text-opacity is forced because dark-v11 fades `state-label` in and out
   * on a zoom expression, and a half-faded white name on grey land is exactly the
   * blending the look exists to prevent.
   */
  const film = filmStyle();
  if (film) {
    set(id, 'text-color', film.ink);
    set(id, 'text-halo-color', film.halo ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)');
    set(id, 'text-halo-width', film.halo ? 1.3 : 0);
    set(id, 'text-halo-blur', 0);
    set(id, 'text-opacity', 1);
    return;
  }
  set(id, 'text-color', LABEL_INK);
  set(id, 'text-halo-color', LABEL_HALO);
  set(id, 'text-halo-width', 1.6);
  set(id, 'text-halo-blur', 0.4);
}

export function allLabelLayers(map: MapboxMap): string[] {
  return map.getStyle().layers
    .filter((l) => l.type === 'symbol')
    .map((l) => l.id);
}

export function setLabels(map: MapboxMap, groups: LabelGroup[]): void {
  const on = new Set(groups.flatMap((g) => LABEL_GROUPS[g]));
  for (const id of allLabelLayers(map)) {
    const visible = [...on].some((p) => id === p || id.startsWith(p));
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    if (!visible) continue;
    // state-label covers every admin-1 on earth, so "The United States" came framed by
    // Sonora and Minas Gerais. Keep the style's own filter and add the country test.
    styleLabel(map, id);
    if (!US_FILTERED.has(id)) continue;
    if (!originalFilters.has(id)) originalFilters.set(id, map.getFilter(id) ?? null);
    const base = originalFilters.get(id);
    map.setFilter(id, (base ? ['all', base, US_ONLY] : US_ONLY) as never);
  }
}

/** Roads and POIs never appear. Called once at style load. */
export function stripBasemap(map: MapboxMap): void {
  for (const layer of map.getStyle().layers) {
    const id = layer.id;
    const isClutter =
      id.startsWith('poi') || id.startsWith('transit') ||
      id.includes('-label') || id.startsWith('road') || id.startsWith('bridge') ||
      id.startsWith('tunnel') || id.startsWith('aeroway') || id.startsWith('building');
    if (isClutter && map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', 'none');
    }
  }
}
