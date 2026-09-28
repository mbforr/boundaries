import { CAMERAS, TIMING } from '../config';
import type { Scene, Step } from '../engine/types';

/**
 * ARIZONA — an island inside an island.
 *
 * Arizona skips daylight saving. The Navajo Nation, inside Arizona, does not. The Hopi
 * Reservation, inside the Navajo Nation, does. So driving east along AZ-264 in summer, the
 * clock changes under you five times without your ever crossing a state line.
 *
 * Nothing here is invented, and the road least of all. The scene used to draw no road —
 * the reasoning being that a stylised highway would be the one fabricated line in a film
 * about real lines, which was right — and instead flew between four named towns while the
 * clock was retyped beside them. Two things were wrong with that. The camera did the
 * driving, so the crossings were asserted rather than shown. And one of the four towns was
 * wrong: Keams Canyon was captioned Navajo · MDT, but the time zone file puts it in
 * America/Phoenix, which is the opposite hour. It had never been checked against the file
 * the scene itself draws.
 *
 * So the road is now the real AZ-264, from TIGER, fetched by scripts/fetch_scene_props.py
 * with its sha256 in qa/scene_props.md: 265 km, 3,042 vertices, the US-160 junction to
 * Window Rock. It arrives pre-split into six runs of constant time zone, each carrying the
 * nation under it and the hour there — all computed against `fedadmin_time_zone`, the same
 * file painted underneath. The clock changes because the dot crossed a polygon, not
 * because a step said so, and the two can never disagree.
 *
 * The raw classification gives nine runs; three are artefacts of where a polygon edge cuts
 * the centreline — one a single vertex, one seventy metres — and are folded into their
 * neighbours by the script, which prints both counts. The six that remain are between
 * 8.8 and 110 km: Hopi, Navajo, Hopi, Navajo, Hopi, Navajo, west to east.
 */

const PHOENIX: unknown[] = ['==', ['get', 'std_name'], 'America/Phoenix'];
const ZONE_COLOR: unknown[] = [
  'match', ['get', 'std_name'],
  'America/Denver', '#E69F00',
  'America/Phoenix', '#56B4E9',
  '#8a94a0',
];
const AZ_ZONES: unknown[] = ['in', ['get', 'std_name'],
  ['literal', ['America/Denver', 'America/Phoenix']]];

const NAVAJO: unknown[] = ['==', ['get', 'order'], 0];
const BOTH: unknown[] = ['has', 'order'];
const TRIBE_COLOR: unknown[] = ['match', ['get', 'order'], 0, '#CC79A7', 1, '#F0E442', '#888'];

/** A caption and the beat it holds for. Every line of narration gets one. */
const say = (text: string): Step[] => [
  { t: 'caption', text },
  { t: 'wait', ms: TIMING.caption },
];

/** Long enough to read as a drive rather than a wipe: 265 km in twelve seconds. */
const DRIVE_MS = 12000;

export const arizonaClocks: Scene = {
  id: 'arizona-clocks',
  chapter: 'rung-5',
  camera: CAMERAS.arizona,
  labels: ['state'],
  layers: [
    { id: 'fedadmin_time_zone', filter: AZ_ZONES,
      paint: { fillOpacity: 0.12, color: ZONE_COLOR } },
    { id: 'navajo_hopi', filter: BOTH,
      paint: { fillOpacity: 0.1, color: TRIBE_COLOR, lineWidth: 2.2 } },
  ],
  counter: 61,
  pen: 'congress',
  caption: 'Arizona skips daylight saving. The Navajo Nation does not. The Hopi do.',
  // Where the drive ends: Window Rock, on Navajo land, an hour ahead of the state around it.
  overlay: { name: 'clock', state: '2:00 · Navajo Nation · MDT' },
  enter: [
    { t: 'pen', pen: 'congress' },
    { t: 'caption', text: null },
    { t: 'overlay', name: 'none', state: null },
    { t: 'fly', camera: CAMERAS.arizona, ms: 3600, curve: 1.4 },

    { t: 'snap', layer: 'fedadmin_time_zone', tickTo: 61, filter: PHOENIX },
    ...say('Arizona: no daylight saving'),

    { t: 'paint', layer: 'fedadmin_time_zone', ms: 600, filter: AZ_ZONES, fillOpacity: 0.12 },
    { t: 'snap', layer: 'navajo_hopi', filter: NAVAJO },
    ...say('The Navajo Nation observes it. A Mountain Time island.'),

    { t: 'paint', layer: 'navajo_hopi', ms: 500, filter: BOTH, fillOpacity: 0.1 },
    ...say('The Hopi Reservation, inside it, does not'),

    // Drive the corridor. The clock is read off the zone the dot is actually in.
    { t: 'caption', text: 'Driving east on AZ-264, one summer afternoon' },
    { t: 'fly', camera: CAMERAS.az264, ms: 2600, curve: 1.1 },
    /*
     * Lift the zone fills for the drive.
     *
     * 0.12 is right for the wide Arizona view, where the zones are large shapes against
     * black. At corridor zoom the frame is filled edge to edge by one zone or the other,
     * the basemap's desert browns show through, and at that strength orange and blue were
     * the same muddy wash — the alternation the whole beat is about was carried only by
     * the road. applyEndState puts it back to 0.12 when the scene lands.
     */
    { t: 'paint', layer: 'fedadmin_time_zone', ms: 600, fillOpacity: 0.26 },
    { t: 'wait', ms: 500 },
    { t: 'drive', ms: DRIVE_MS },
    { t: 'wait', ms: 700 },
    ...say('165 miles. Five changes of clock. No state line crossed.'),

    { t: 'driveOff', ms: 460 },
    { t: 'fly', camera: CAMERAS.arizona, ms: 2200 },
    { t: 'overlay', name: 'clock', state: '2:00 · Navajo Nation · MDT' },
    { t: 'caption',
      text: 'Arizona skips daylight saving. The Navajo Nation does not. The Hopi do.' },
  ],
};
