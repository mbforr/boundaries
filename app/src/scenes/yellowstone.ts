import { BACKDROP, CAMERAS } from '../config';
import type { Scene } from '../engine/types';

/**
 * YELLOWSTONE / THE PERFECT CRIME — the courts' pen.
 *
 * Congress drew the federal court districts to follow state lines. Usually. Yellowstone
 * became a park in 1872, before any of the three states existed, so 28 USC 131 put the
 * whole park into the District of Wyoming — including the strip that is legally Idaho.
 *
 * The District of Wyoming is not constructed here. courts_fed_district already carries it,
 * patched by ../boundaries/scripts/derive.py under that statute, covering all 3,437 sq mi
 * of the park. The reveal just brings it up and then pushes into the sliver.
 *
 * Measured from the data: the Idaho sliver is 57.6 sq mi. The script says "50 square
 * miles", which is the figure Kalt's paper uses; both are on screen-safe ground, but the
 * caption here stays vague about the number and lets the VO carry it.
 */

/** Congress drew the park; the courts drew the district. One file, two pens. */
const KIND_COLOR: unknown[] = [
  'match', ['get', 'kind'],
  'park', '#F0E442',
  'district_of_wyoming', '#CC79A7',
  'idaho_sliver', '#CC79A7',
  'montana_sliver', '#CC79A7',
  '#8a94a0',
];

/** Where the two boundaries coincide, the wider pink line shows around the yellow one. */
const KIND_WIDTH: unknown[] = [
  'match', ['get', 'kind'],
  'district_of_wyoming', 4.2,
  'park', 1.6,
  'idaho_sliver', 2.4,
  1.8,
];

const PARK: unknown[] = ['==', ['get', 'kind'], 'park'];
const DISTRICT: unknown[] = ['==', ['get', 'kind'], 'district_of_wyoming'];
const IDAHO: unknown[] = ['==', ['get', 'kind'], 'idaho_sliver'];

/** Fades everything except the named kind. One source, one paint, so: expressions. */
function only(kind: string, fill = 0.15, line = 0.95): {
  fillOpacity: unknown[]; lineOpacity: unknown[];
} {
  return {
    fillOpacity: ['match', ['get', 'kind'], kind, fill, 0],
    lineOpacity: ['match', ['get', 'kind'], kind, line, 0],
  };
}

const PARK_AND_DISTRICT = {
  fillOpacity: ['match', ['get', 'kind'], 'district_of_wyoming', 0.1, 'park', 0.3, 0],
  lineOpacity: ['match', ['get', 'kind'], 'district_of_wyoming', 0.95, 'park', 0.95, 0],
} as { fillOpacity: unknown[]; lineOpacity: unknown[] };

const ALL_THREE = {
  fillOpacity: ['match', ['get', 'kind'],
                'district_of_wyoming', 0.1, 'park', 0.16, 'idaho_sliver', 0.5, 0],
  lineOpacity: ['match', ['get', 'kind'],
                'district_of_wyoming', 0.8, 'park', 0.8, 'idaho_sliver', 1, 0],
} as { fillOpacity: unknown[]; lineOpacity: unknown[] };

export const yellowstoneScenes: Scene[] = [
  {
    id: 'ys-park',
    chapter: 'legal',
    camera: CAMERAS.yellowstone,
    labels: ['state'],
    layers: [
      { id: 'census_state', paint: BACKDROP },
      { id: 'yellowstone', filter: PARK, paint: { ...only('park', 0.28), color: KIND_COLOR } },
    ],
    counter: 40,
    pen: 'congress',
    caption: 'Yellowstone became a park in 1872.',
    enter: [
      { t: 'caption', text: null },
      { t: 'labels', groups: ['state'] },
      { t: 'fly', camera: CAMERAS.yellowstone, ms: 4200, curve: 1.5 },
      { t: 'pen', pen: 'congress' },
      { t: 'fade', layer: 'census_state', ms: 500, to: BACKDROP.fillOpacity },
      { t: 'snap', layer: 'yellowstone', filter: PARK },
      { t: 'paint', layer: 'yellowstone', ms: 300, ...only('park', 0.28) },
      { t: 'caption', text: 'Yellowstone became a park in 1872.' },
      { t: 'wait', ms: 500 },
      { t: 'caption', text: 'Before Wyoming, Idaho or Montana were states.' },
      { t: 'wait', ms: 700 },
      { t: 'caption', text: 'Yellowstone became a park in 1872.' },
    ],
  },
  {
    id: 'ys-district',
    chapter: 'legal',
    camera: CAMERAS.wyoming,
    labels: ['state'],
    layers: [
      { id: 'census_state', paint: BACKDROP },
      { id: 'yellowstone', filter: ['in', ['get', 'kind'],
        ['literal', ['park', 'district_of_wyoming']]],
        paint: { ...PARK_AND_DISTRICT, color: KIND_COLOR, lineWidth: KIND_WIDTH } },
    ],
    counter: 40,
    pen: 'courts',
    caption: 'District of Wyoming',
    enter: [
      { t: 'pen', pen: 'courts' },
      { t: 'caption', text: null },
      { t: 'fly', camera: CAMERAS.wyoming, ms: 2600, curve: 1.2 },
      // The district comes up around the park, bulging past the state line to swallow it.
      { t: 'paint', layer: 'yellowstone', ms: 900,
        filter: ['in', ['get', 'kind'], ['literal', ['park', 'district_of_wyoming']]],
        ...PARK_AND_DISTRICT },
      { t: 'wait', ms: 600 },
      { t: 'caption', text: 'District of Wyoming' },
      { t: 'wait', ms: 400 },
    ],
  },
  {
    id: 'ys-sliver',
    chapter: 'legal',
    camera: CAMERAS.idahoSliver,
    labels: ['state'],
    layers: [
      { id: 'census_state', paint: BACKDROP },
      { id: 'yellowstone', filter: ['!=', ['get', 'kind'], 'montana_sliver'],
        paint: { ...ALL_THREE, color: KIND_COLOR, lineWidth: KIND_WIDTH } },
    ],
    counter: 40,
    pen: 'courts',
    caption: 'Permanent population: 0.',
    enter: [
      { t: 'caption', text: 'Idaho, inside the District of Wyoming' },
      { t: 'paint', layer: 'yellowstone', ms: 400,
        filter: ['!=', ['get', 'kind'], 'montana_sliver'], ...ALL_THREE },
      { t: 'fly', camera: CAMERAS.idahoSliver, ms: 3600, curve: 1.2 },
      { t: 'pulse', layer: 'yellowstone', times: 2 },
      { t: 'wait', ms: 500 },
      { t: 'caption', text: 'Permanent population: 0.' },
      { t: 'wait', ms: 600 },
    ],
  },
];

/** Cold open: the great-circle line from the pin to the sliver, 1,890 miles. */
export const coldOpenArc: Scene = {
  id: 'cold-arc',
  chapter: 'cold-open',
  camera: CAMERAS.country,
  labels: [],
  layers: [
    { id: 'census_state', paint: BACKDROP },
    { id: 'esb_arc', paint: { lineWidth: 2.2 } },
    { id: 'yellowstone', filter: IDAHO,
      paint: { ...only('idaho_sliver', 0.55), color: KIND_COLOR } },
  ],
  counter: null,
  pen: null,
  caption: '1,890 miles',
  enter: [
    { t: 'caption', text: null },
    { t: 'counter', to: null },
    { t: 'fly', camera: CAMERAS.country, ms: 3200 },
    { t: 'fade', layer: 'census_state', ms: 400, to: BACKDROP.fillOpacity },
    { t: 'fade', layer: 'esb_arc', ms: 900 },
    { t: 'paint', layer: 'yellowstone', ms: 400, filter: IDAHO,
      ...only('idaho_sliver', 0.55) },
    { t: 'pulse', layer: 'yellowstone', times: 2 },
    { t: 'caption', text: '1,890 miles' },
  ],
};

export { DISTRICT };
