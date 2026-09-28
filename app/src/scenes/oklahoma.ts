import { BACKDROP, CAMERAS } from '../config';
import type { Scene, Step } from '../engine/types';

/**
 * OKLAHOMA / McGIRT — the courts' pen.
 *
 * The point of the beat is that no boundary changed. The court did not draw a line; it
 * said an old line had been there the whole time. So the choreography reveals rather than
 * constructs: the state outline first, then the reservation footprints fading up
 * underneath it one nation at a time.
 *
 * The order is the legal order, not the size order. McGirt v. Oklahoma (2020) decided the
 * Muscogee (Creek) Nation and nothing else; Oklahoma's Court of Criminal Appeals then
 * applied the reasoning to the rest. Creek goes first for that reason.
 *
 * The layer carries all 25 Oklahoma OTSAs. Only the affirmed ones are ever shown under the
 * 43% caption — the full set covers 76% of the state, which is a different claim.
 */

const AFFIRMED_ORDER = [
  ['Creek'],
  ['Cherokee'],
  ['Choctaw'],
  ['Chickasaw'],
  ['Seminole'],
  ['Quapaw', 'Ottawa', 'Peoria', 'Miami', 'Wyandotte', 'Eastern Shawnee'],
];

/** Cumulative filter: everything revealed so far, so nothing ever flickers off. */
function revealed(upTo: number): unknown[] {
  const names = AFFIRMED_ORDER.slice(0, upTo + 1).flat();
  return ['in', ['get', 'NAME'], ['literal', names]];
}

const ALL_AFFIRMED: unknown[] = ['==', ['get', 'mcgirt_status'], 'affirmed'];
/** Everything the courts ruled on, either way. Excludes the western statistical areas. */
const RULED: unknown[] = ['in', ['get', 'mcgirt_status'],
                          ['literal', ['affirmed', 'disestablished']]];

// One source cannot carry two paints, so the struck-out Osage and the affirmed nations
// are separated by expression rather than by listing ok_mcgirt twice.
const STRUCK_FILL: unknown[] =
  ['match', ['get', 'mcgirt_status'], 'affirmed', 0.24, 'disestablished', 0.06, 0];
const STRUCK_LINE: unknown[] =
  ['match', ['get', 'mcgirt_status'], 'affirmed', 1, 'disestablished', 0.3, 0];

/** After beat 30, the turn out of the political layers and into the legal ones. */
export const oklahomaTeaser: Scene = {
  id: 'ok-teaser',
  chapter: 'political',
  camera: CAMERAS.oklahoma,
  labels: ['state'],
  layers: [{ id: 'census_state', paint: { fillOpacity: 0.04 } }],
  counter: 30,
  pen: null,
  caption: 'The next layer decides who can charge you with a crime.',
  enter: [
    { t: 'caption', text: null },
    { t: 'labels', groups: ['state'] },
    { t: 'fly', camera: CAMERAS.oklahoma, ms: 4200, curve: 1.5 },
    { t: 'fade', layer: 'census_state', ms: 500, to: BACKDROP.fillOpacity },
    { t: 'wait', ms: 300 },
    { t: 'caption', text: 'The next layer decides who can charge you with a crime.' },
  ],
};

/** After beat 36, the McGirt sequence proper. */
export const oklahomaScenes: Scene[] = [
  {
    id: 'ok-nations',
    chapter: 'legal',
    camera: CAMERAS.oklahoma,
    labels: ['state'],
    layers: [
      { id: 'census_state', paint: BACKDROP },
      { id: 'ok_mcgirt', filter: ALL_AFFIRMED },
    ],
    counter: 36,
    pen: 'courts',
    caption: 'Reservation land, never legally dissolved',
    enter: [
      { t: 'pen', pen: 'courts' },
      { t: 'caption', text: 'Muscogee (Creek) Nation' },
      { t: 'fly', camera: CAMERAS.oklahoma, ms: 2600 },
      ...AFFIRMED_ORDER.flatMap((group, i): Step[] => [
        { t: 'caption', text: i === 5 ? 'and the small nations of the northeast' : `${group[0]} Nation` },
        { t: 'fade', layer: 'ok_mcgirt', ms: 520, filter: revealed(i) },
        { t: 'wait', ms: 420 },
      ]),
      { t: 'caption', text: 'Reservation land, never legally dissolved' },
    ],
  },
  {
    id: 'ok-tulsa',
    chapter: 'legal',
    camera: CAMERAS.tulsa,
    labels: [],
    layers: [
      { id: 'ok_mcgirt', filter: ALL_AFFIRMED },
      { id: 'scene_places', paint: { fillOpacity: 0.1, color: '#E69F00' },
        filter: ['==', ['get', 'std_name'], 'Tulsa'] },
    ],
    counter: 36,
    pen: 'courts',
    caption: 'The Muscogee and Cherokee lines run right through Tulsa.',
    enter: [
      { t: 'caption', text: null },
      { t: 'fly', camera: CAMERAS.tulsa, ms: 3400, curve: 1.3 },
      { t: 'snap', layer: 'scene_places', filter: ['==', ['get', 'std_name'], 'Tulsa'] },
      { t: 'wait', ms: 900 },
      { t: 'caption', text: 'The Muscogee and Cherokee lines run right through Tulsa.' },
      { t: 'wait', ms: 600 },
    ],
  },
  {
    id: 'ok-osage',
    chapter: 'legal',
    camera: CAMERAS.oklahoma,
    labels: ['state'],
    layers: [
      { id: 'census_state', paint: BACKDROP },
      {
        id: 'ok_mcgirt',
        filter: RULED,
        paint: { fillOpacity: STRUCK_FILL, lineOpacity: STRUCK_LINE },
      },
    ],
    counter: 36,
    pen: 'courts',
    caption: '43% of Oklahoma',
    enter: [
      { t: 'caption', text: null },
      { t: 'fly', camera: CAMERAS.oklahoma, ms: 3000 },
      { t: 'caption', text: 'The Osage reservation' },
      // Osage alone, at full strength, before the ruling lands on it.
      { t: 'paint', layer: 'ok_mcgirt', ms: 500, filter: RULED,
        fillOpacity: ['match', ['get', 'mcgirt_status'], 'disestablished', 0.26, 0],
        lineOpacity: ['match', ['get', 'mcgirt_status'], 'disestablished', 1, 0] },
      { t: 'wait', ms: 900 },
      { t: 'caption', text: 'ruled disestablished' },
      // It dims, and the affirmed nations come back up around it.
      { t: 'paint', layer: 'ok_mcgirt', ms: 600,
        fillOpacity: STRUCK_FILL, lineOpacity: STRUCK_LINE },
      { t: 'wait', ms: 700 },
      { t: 'caption', text: '43% of Oklahoma' },
    ],
  },
];
