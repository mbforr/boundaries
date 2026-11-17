import type { Map as MapboxMap } from 'mapbox-gl';
import type { Theme } from './colors';

export const STYLE: Record<Theme, string> = {
  light: 'mapbox://styles/mapbox/light-v11',
  dark: 'mapbox://styles/mapbox/dark-v11',
};

/**
 * Mute light-v11 toward greyscale, the way the plates restyle dark-v11 at runtime
 * (NOTES.md, matte and key): flat land, grey water, quiet roads, place names kept.
 * Boundary colour should be the only colour on the map.
 *
 * Every write is guarded. Mapbox renames a layer now and then, and a missing layer
 * should cost one restyle, not the page.
 */
const LAND = '#ecebe7';
const WATER = '#d5d7d8';
const ROAD = '#fbfbfa';
const BUILDING = '#e1e0db';
const LABEL = '#6b6b6b';
const PLACE = '#2b2b2b';
const HALO = '#ffffff';

const HIDE = /^(poi-label|airport-label|natural-|waterway-label|road-label|aeroway-|land-structure-|continent-label)/;

export function restyleLight(map: MapboxMap): void {
  const set = (id: string, prop: string, v: unknown, layout = false) => {
    try {
      if (layout) map.setLayoutProperty(id, prop as never, v as never);
      else map.setPaintProperty(id, prop as never, v as never);
    } catch { /* a layer this style version doesn't have */ }
  };
  for (const l of map.getStyle()?.layers ?? []) {
    const id = l.id;
    if (HIDE.test(id)) { set(id, 'visibility', 'none', true); continue; }
    if (l.type === 'background') set(id, 'background-color', LAND);
    else if (id === 'water') set(id, 'fill-color', WATER);
    else if (id === 'waterway') set(id, 'line-color', WATER);
    else if (id === 'landuse' || id === 'national-park') {
      // Parks and land use flatten into the land: green would read as a boundary layer.
      set(id, 'fill-color', LAND);
      set(id, 'fill-opacity', 0);
    } else if (id === 'building') set(id, 'fill-color', BUILDING);
    else if (l.type === 'line' && /^(road|bridge|tunnel)-/.test(id)) {
      set(id, 'line-color', id.endsWith('-rail') ? BUILDING : ROAD);
    } else if (l.type === 'line' && id.startsWith('admin-')) {
      // The basemap's own state and national lines would compete with the layers
      // being explored, which include states. Keep them faint.
      set(id, 'line-color', '#c9c8c3');
      set(id, 'line-opacity', id.endsWith('-bg') ? 0 : 0.8);
    } else if (l.type === 'symbol') {
      const major = /^(settlement-major|state|country)-label/.test(id);
      set(id, 'text-color', major ? PLACE : LABEL);
      set(id, 'text-halo-color', HALO);
      set(id, 'text-halo-width', 1.2);
    }
  }
}

/** The first symbol layer: boundaries go under it so place names stay readable. */
export function labelAnchor(map: MapboxMap): string | undefined {
  return map.getStyle()?.layers.find((l) => l.type === 'symbol' &&
    (map.getLayoutProperty(l.id, 'visibility') ?? 'visible') !== 'none')?.id;
}
