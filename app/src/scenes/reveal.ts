import { CAMERAS, ESB } from '../config';
import { PEN_ORDER } from '../pens';
import type { Scene, Step } from '../engine/types';

/**
 * THE REVEAL — 49 polygons at one address.
 *
 * The counter runs to 68 because that is how many kinds of boundary the building sits
 * inside. Only 49 polygons draw, because that is how many we have the file for. The gap
 * is not hidden: it gets its own caption, and it is the honest half of the answer.
 *
 * The 49 come from qa/esb_final_count.md via app/public/data/esb_stack.geojson, in pen
 * order, each carrying its own pen — so the layer is coloured by feature, not by layer.
 * The count is never recomputed here; the export asserts it against the locked file.
 */

/** Per-pen counts, from the locked file. Rendered by the pen-legend overlay. */
export const PEN_COUNTS: Record<string, number> = {
  congress: 5,
  politicians: 19,
  statisticians: 12,
  courts: 4,
  markets: 2,
  surveyors: 7,
};

/**
 * All 49 polygons overlap at the pin, so their fills composite. At 0.14 each the frame
 * goes solid; 0.008 keeps the ground dark and lets the 49 outlines do the work.
 */
const REVEAL_FILL = 0.008;

const TOTAL_POLYGONS = 49;
const TOTAL_BOUNDARIES = 68;

/**
 * Draw the stack in pen order. The features carry an `order` field already sorted that
 * way, so each step just widens the cut-off — no flicker, nothing redrawn.
 */
function stackSteps(): Step[] {
  const steps: Step[] = [];
  let drawn = 0;
  for (const pen of PEN_ORDER) {
    const n = PEN_COUNTS[pen] ?? 0;
    if (!n) continue;
    drawn += n;
    const upTo = drawn;
    steps.push({ t: 'pen', pen: pen as never });
    steps.push({ t: 'caption', text: null });
    steps.push({
      t: 'paint', layer: 'esb_stack@nyc', ms: 420,
      filter: ['<', ['get', 'order'], upTo],
      fillOpacity: REVEAL_FILL, lineOpacity: 0.9,
    });
    // The counter runs to 68 across 49 draws, so it advances proportionally rather than
    // one tick per polygon — it has to land on 68 exactly at the end.
    steps.push({
      t: 'counter',
      to: Math.round((upTo / TOTAL_POLYGONS) * TOTAL_BOUNDARIES),
    });
    steps.push({ t: 'wait', ms: 340 });
  }
  return steps;
}

export const revealStack: Scene = {
  id: 'reveal-stack',
  chapter: 'reveal',
  camera: CAMERAS.esbNear,
  labels: [],
  layers: [{ id: 'esb_stack@nyc',
             paint: { fillOpacity: REVEAL_FILL, lineOpacity: 0.9, lineWidth: 1.3 } }],
  counter: TOTAL_BOUNDARIES,
  pen: null,
  caption: '49 files. 68 boundaries.',
  overlay: { name: 'penLegend', state: PEN_COUNTS },
  enter: [
    { t: 'caption', text: null },
    { t: 'counter', to: 0 },
    { t: 'overlay', name: 'none', state: null },
    { t: 'fly', camera: CAMERAS.esbNear, ms: 4200, curve: 1.6 },
    ...stackSteps(),
    { t: 'pen', pen: null },
    { t: 'counter', to: TOTAL_BOUNDARIES },
    { t: 'caption', text: '49 files. 68 boundaries.' },
    { t: 'overlay', name: 'penLegend', state: PEN_COUNTS },
    { t: 'wait', ms: 500 },
  ],
};

/**
 * Manhattan, drawn twice, by two agencies that never compared notes: the Census Bureau
 * calls it a county subdivision, the City of New York calls it a borough. Both polygons
 * are in the 49, which is why 48 boundaries need 49 files.
 */
export const manhattanTwice: Scene = {
  id: 'manhattan-twice',
  chapter: 'reveal',
  camera: CAMERAS.manhattan,
  labels: [],
  layers: [
    { id: 'census_cousub@nyc', filter: ['==', ['get', 'std_geoid'], '3606144919'],
      paint: { fillOpacity: 0.16 } },
    { id: 'nyc_borough@nyc', filter: ['==', ['get', 'std_name'], 'Manhattan'],
      paint: { fillOpacity: 0.16 } },
  ],
  counter: TOTAL_BOUNDARIES,
  pen: 'politicians',
  caption: 'Manhattan, drawn twice.',
  enter: [
    { t: 'overlay', name: 'none', state: null },
    { t: 'caption', text: null },
    { t: 'fly', camera: CAMERAS.manhattan, ms: 2600 },
    { t: 'pen', pen: 'politicians' },
    { t: 'caption', text: 'Census Bureau: Manhattan borough' },
    { t: 'snap', layer: 'census_cousub@nyc',
      filter: ['==', ['get', 'std_geoid'], '3606144919'] },
    { t: 'wait', ms: 800 },
    { t: 'caption', text: 'City of New York: the Borough of Manhattan' },
    { t: 'snap', layer: 'nyc_borough@nyc', filter: ['==', ['get', 'std_name'], 'Manhattan'] },
    { t: 'wait', ms: 800 },
    { t: 'caption', text: 'Manhattan, drawn twice.' },
  ],
};

/**
 * ZIP vs ZCTA. The building's own ZIP is 10118; the Census Bureau puts the point in ZCTA
 * 10001, because a single-building ZIP has no area to tabulate.
 *
 * No fake delivery routes are drawn. A ZIP code is a list of stops, so the honest way to
 * show it is to take the polygon away and leave the one lot standing — the absence is the
 * beat, and inventing route lines would be inventing USPS data we do not have.
 */
export const zipVsZcta: Scene = {
  id: 'zip-zcta',
  chapter: 'rung-5',
  camera: CAMERAS.esbBlock,
  labels: [],
  layers: [{ id: 'nyc_landmark_lot@nyc', filter: ['==', ['get', 'std_geoid'], 'LP-02000'],
             paint: { fillOpacity: 0.5, lineWidth: 2.4 } }],
  counter: 65,
  pen: 'statisticians',
  caption: 'ZIP 10118. One building. Not an area.',
  enter: [
    { t: 'pen', pen: 'statisticians' },
    { t: 'caption', text: 'ZCTA 10001: the shape the Census Bureau invented' },
    { t: 'fly', camera: CAMERAS.esbNear, ms: 2400 },
    { t: 'snap', layer: 'census_zcta@nyc', tickTo: 65,
      filter: ['==', ['get', 'std_geoid'], '10001'] },
    { t: 'wait', ms: 1100 },
    { t: 'caption', text: 'The Postal Service never drew it.' },
    { t: 'wait', ms: 700 },
    // The invented polygon goes away and the real thing — one building — is left.
    { t: 'paint', layer: 'census_zcta@nyc', ms: 900, fillOpacity: 0, lineOpacity: 0 },
    { t: 'fly', camera: CAMERAS.esbBlock, ms: 2200 },
    { t: 'hide', layer: 'census_zcta@nyc' },
    { t: 'snap', layer: 'nyc_landmark_lot@nyc',
      filter: ['==', ['get', 'std_geoid'], 'LP-02000'] },
    { t: 'paint', layer: 'nyc_landmark_lot@nyc', ms: 400, fillOpacity: 0.5 },
    { t: 'caption', text: 'ZIP 10118. One building. Not an area.' },
    { t: 'wait', ms: 500 },
  ],
};

/** Cold open: the lot at street pitch, pulling back to the whole country. */
export const coldOpenFlyout: Scene = {
  id: 'cold-flyout',
  chapter: 'cold-open',
  camera: CAMERAS.country,
  labels: [],
  layers: [{ id: 'census_state', paint: { fillOpacity: 0.03, lineOpacity: 0.2 } }],
  counter: 'blur',
  pen: null,
  caption: null,
  enter: [
    { t: 'caption', text: null },
    { t: 'pen', pen: null },
    { t: 'hide', layer: 'census_state' },
    { t: 'jump', camera: { center: ESB, zoom: 16.6, pitch: 60, bearing: -17 } },
    { t: 'snap', layer: 'nyc_landmark_lot@nyc',
      filter: ['==', ['get', 'std_geoid'], 'LP-02000'] },
    { t: 'wait', ms: 900 },
    { t: 'counter', to: 'blur' },
    { t: 'fly', camera: CAMERAS.country, ms: 7000, curve: 1.9 },
    { t: 'hide', layer: 'nyc_landmark_lot@nyc' },
    { t: 'fade', layer: 'census_state', ms: 700, to: 0.03 },
  ],
};
