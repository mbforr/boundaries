import { BACKDROP, CAMERAS } from '../config';
import { PENS } from '../pens';
import type { Camera, Scene, Step } from '../engine/types';

/**
 * The P2 gallery: four short scenes that each make one point and get out.
 *
 * There is no Federal Reserve district scene. fedadmin_frb_district is still unbuilt —
 * kansascityfed.org blocks automated access and the only ArcGIS copies are third-party,
 * which fails the repo's sourcing rule. CLAUDE.md is explicit that hand-typing the ~3,143
 * county assignments is not acceptable, so beat 49 stays a card until a real source turns
 * up. Better a card than a map we cannot stand behind.
 */

// ── the gerrymander gallery ──────────────────────────────────────────────────

const IL4 = ['==', ['get', 'std_name'], 'Illinois 4th (119th Congress)'] as unknown[];
const NC12 = ['==', ['get', 'std_name'],
  'North Carolina 12th (113th Congress)'] as unknown[];

const CHICAGO: Camera = { center: [-87.78, 41.87], zoom: 9.6 };
const PIEDMONT: Camera = { center: [-80.35, 35.75], zoom: 7.4 };

/** Two districts, two seconds each. The shapes make the argument on their own. */
export const gerrymanderGallery: Scene[] = [
  {
    id: 'gerry-il4',
    chapter: 'political',
    camera: CHICAGO,
    labels: [],
    layers: [{ id: 'gerrymander', filter: IL4, paint: { fillOpacity: 0.2 } }],
    counter: 18,
    pen: 'politicians',
    caption: 'Illinois 4th, the earmuffs',
    enter: [
      { t: 'pen', pen: 'politicians' },
      { t: 'caption', text: null },
      { t: 'fly', camera: CHICAGO, ms: 3200, curve: 1.4 },
      { t: 'snap', layer: 'gerrymander', filter: IL4 },
      { t: 'wait', ms: 900 },
      { t: 'caption', text: 'Illinois 4th, the earmuffs' },
      { t: 'wait', ms: 900 },
      { t: 'caption', text: 'Two neighbourhoods joined by a highway median.' },
      { t: 'wait', ms: 800 },
      { t: 'caption', text: 'Illinois 4th, the earmuffs' },
    ],
  },
  {
    id: 'gerry-nc12',
    chapter: 'political',
    camera: PIEDMONT,
    labels: [],
    layers: [{ id: 'gerrymander', filter: NC12, paint: { fillOpacity: 0.2 } }],
    counter: 18,
    pen: 'politicians',
    caption: 'North Carolina 12th, as drawn for the 113th Congress',
    enter: [
      { t: 'caption', text: null },
      { t: 'hide', layer: 'gerrymander' },
      { t: 'fly', camera: PIEDMONT, ms: 3000, curve: 1.3 },
      { t: 'snap', layer: 'gerrymander', filter: NC12 },
      { t: 'wait', ms: 1000 },
      { t: 'caption', text: 'North Carolina 12th, as drawn for the 113th Congress' },
      { t: 'wait', ms: 900 },
    ],
  },
];

// ── Paradise, Nevada ─────────────────────────────────────────────────────────

const VEGAS: Camera = { center: [-115.16, 36.13], zoom: 9.9 };
const PARADISE = ['==', ['get', 'std_name'], 'Paradise'] as unknown[];
const BOTH_NV = ['in', ['get', 'std_name'],
  ['literal', ['Paradise', 'Las Vegas']]] as unknown[];
/** The CDP and the city it is not part of, told apart by colour. */
const NV_COLOR = ['match', ['get', 'std_name'],
  'Paradise', '#56B4E9', 'Las Vegas', '#E69F00', '#8a94a0'] as unknown[];

export const paradiseNv: Scene = {
  id: 'paradise-nv',
  chapter: 'count-you',
  camera: VEGAS,
  labels: [],
  layers: [{ id: 'scene_places', filter: BOTH_NV,
             paint: { fillOpacity: 0.18, color: NV_COLOR } }],
  counter: 9,
  pen: 'statisticians',
  caption: 'The Strip is not in Las Vegas.',
  enter: [
    { t: 'pen', pen: 'statisticians' },
    { t: 'caption', text: null },
    { t: 'fly', camera: VEGAS, ms: 3400, curve: 1.4 },
    { t: 'caption', text: 'Paradise, Nevada: a census designated place' },
    { t: 'snap', layer: 'scene_places', filter: PARADISE },
    { t: 'wait', ms: 1000 },
    { t: 'caption', text: 'No mayor. No council. A shape drawn so the Bureau could count.' },
    { t: 'wait', ms: 900 },
    { t: 'caption', text: 'Las Vegas city limits' },
    { t: 'paint', layer: 'scene_places', ms: 600, filter: BOTH_NV, fillOpacity: 0.18 },
    { t: 'wait', ms: 900 },
    { t: 'caption', text: 'The Strip is not in Las Vegas.' },
  ],
};

// ── Texas and the grid ───────────────────────────────────────────────────────

const TEXAS: Camera = { center: [-99.6, 31.3], zoom: 5.4 };
const ERCOT = ['==', ['get', 'std_geoid'], '5723'] as unknown[];
const TX_GRIDS = ['in', ['get', 'std_geoid'],
  ['literal', ['5723', '5701', '59504', '56669']]] as unknown[];
/** ERCOT green; everything else in Texas that answers to somebody else, orange. */
const GRID_COLOR = ['match', ['get', 'std_geoid'],
  '5723', '#009E73', '5701', '#E69F00', '#56B4E9'] as unknown[];

/**
 * Not "three interconnections". The BA layer carries no interconnection field and the
 * assignment would have to be hand-typed from memory for 71 authorities, so this shows
 * what the data actually says: ERCOT covers 73% of Texas, El Paso Electric 18.6%, and
 * SPP and MISO the panhandle and the east. The script's point survives intact and gains a
 * detail — Texas is not wholly on the Texas grid.
 */
export const texasGrid: Scene = {
  id: 'texas-grid',
  chapter: 'rung-5',
  camera: TEXAS,
  labels: ['state'],
  layers: [
    { id: 'census_state', paint: BACKDROP },
    { id: 'energy_balancing_authority', filter: TX_GRIDS,
      paint: { fillOpacity: 0.16, color: GRID_COLOR } },
  ],
  counter: 43,
  pen: 'markets',
  caption: 'Texas is not entirely on the Texas grid.',
  enter: [
    { t: 'pen', pen: 'markets' },
    { t: 'caption', text: null },
    { t: 'labels', groups: ['state'] },
    { t: 'fly', camera: TEXAS, ms: 3600, curve: 1.4 },
    { t: 'fade', layer: 'census_state', ms: 500, to: BACKDROP.fillOpacity },
    { t: 'caption', text: 'ERCOT: 73% of Texas, and its own grid' },
    { t: 'snap', layer: 'energy_balancing_authority', filter: ERCOT },
    { t: 'wait', ms: 1100 },
    { t: 'caption', text: 'El Paso Electric: in Texas, on the Western grid' },
    { t: 'paint', layer: 'energy_balancing_authority', ms: 600,
      filter: ['in', ['get', 'std_geoid'], ['literal', ['5723', '5701']]],
      fillOpacity: 0.16 },
    { t: 'pulse', layer: 'energy_balancing_authority', times: 2 },
    { t: 'wait', ms: 900 },
    { t: 'caption', text: 'And the panhandle and the east answer to SPP and MISO.' },
    { t: 'paint', layer: 'energy_balancing_authority', ms: 700,
      filter: TX_GRIDS, fillOpacity: 0.16 },
    { t: 'wait', ms: 900 },
    { t: 'caption', text: 'Texas is not entirely on the Texas grid.' },
  ],
};

// ── the layer nobody may publish ─────────────────────────────────────────────

/**
 * Nielsen's 210 media markets pass all three rules and cannot be shown. No real DMA
 * polygon appears here, and none ever will: CLAUDE.md rule 2 forbids scraping them or
 * shipping a mirror, and the limitation is itself the beat. The country gets hatched,
 * which is the cartographic way of saying "no data", and a lock sits on top of it.
 */
export const dmaPlaceholder: Scene = {
  id: 'dma-locked',
  chapter: 'rung-5',
  camera: CAMERAS.country,
  labels: [],
  layers: [{ id: 'census_nation',
             paint: { fillOpacity: 0.5, pattern: 'hatch', lineOpacity: 0.45,
                      color: PENS.markets.color } }],
  counter: 63,
  pen: 'markets',
  caption: 'Nielsen draws about 210 of these.',
  overlay: { name: 'locked', state: 'Privately owned. Not licensable.' },
  enter: [
    { t: 'pen', pen: 'markets' },
    { t: 'caption', text: null },
    { t: 'overlay', name: 'none', state: null },
    { t: 'fly', camera: CAMERAS.country, ms: 3000 },
    { t: 'snap', layer: 'census_nation', tickTo: 63 },
    { t: 'paint', layer: 'census_nation', ms: 500, fillOpacity: 0.5 },
    // The snap paints from the layer's own pen; this scene borrows the shape, not the pen.
    { t: 'wait', ms: 1 },
    { t: 'caption', text: 'Nielsen draws about 210 of these.' },
    { t: 'wait', ms: 900 },
    { t: 'overlay', name: 'locked', state: 'Privately owned. Not licensable.' },
    { t: 'wait', ms: 700 },
  ],
};

export const p2Scenes: { afterBeat: number; scenes: Scene[] }[] = [
  { afterBeat: 9, scenes: [paradiseNv] },
  { afterBeat: 20, scenes: gerrymanderGallery },
  { afterBeat: 43, scenes: [texasGrid] },
  { afterBeat: 63, scenes: [dmaPlaceholder] },
];

export type { Step };
