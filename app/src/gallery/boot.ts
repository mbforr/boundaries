import mapboxgl from 'mapbox-gl';
import '../styles.css';
import './gallery.css';

import { MAP_STYLE, CAMERAS } from '../config';
import { stripBasemap } from '../engine/state';
import { readRecordOpts, applyRecordMode } from '../record';
import { applyFilmStyle } from '../filmstyle';
import { requireToken, watchTokenErrors } from '../token';

/**
 * Shared boot for the two gallery pages — /flash.html and /draw.html.
 *
 * These are contact sheets for the boundary stack, not part of the deck: one
 * shows every layer in the registry in quick succession, the other draws a single layer's
 * outlines with a moving pen. They deliberately reuse the deck's map style, pen palette,
 * record mode and type, so what you see here is what the deck would show.
 *
 * They are separate Vite entry points rather than routes inside the deck because the deck
 * guarantees that navigation is a pure function of the scene index, and a second engine
 * mutating the same map would be exactly the kind of shared state that guarantee exists to
 * rule out. Separate page, separate map, nothing to collide with.
 */
export interface Gallery {
  map: mapboxgl.Map;
  stage: HTMLElement;
  params: URLSearchParams;
}

export function bootGallery(): Gallery {
  mapboxgl.accessToken = requireToken();

  const params = new URLSearchParams(location.search);
  const stage = document.getElementById('stage')!;

  const map = new mapboxgl.Map({
    container: 'map',
    style: MAP_STYLE,
    center: CAMERAS.country.center,
    zoom: CAMERAS.country.zoom,
    attributionControl: false,
    logoPosition: 'bottom-right',
    projection: { name: 'mercator' },
    fadeDuration: 0,
    preserveDrawingBuffer: true,
  });

  // Same reason as the deck: mapbox pans on the arrow keys from a handler on the map
  // container, which fires before a window listener can preventDefault. The arrows drive
  // the reel here too, so the map does not get a vote.
  map.keyboard.disable();
  watchTokenErrors(map);

  applyRecordMode(stage, map, readRecordOpts(params));

  // Same handle the deck exposes for scripts/smoke.py, so these pages can be driven and
  // checked from Playwright the same way rather than only by eye.
  (window as unknown as { __map: unknown }).__map = map;

  return { map, stage, params };
}

/** Resolves once the style is up and the basemap clutter is off. */
export function ready(map: mapboxgl.Map): Promise<void> {
  return new Promise((resolve) => {
    map.on('load', () => {
      stripBasemap(map);
      // After the strip, never before: stripBasemap hides every label, and the plates want
      // the place names back. See gallery/filmstyle.ts.
      applyFilmStyle(map, { names: true });
      resolve();
    });
  });
}
