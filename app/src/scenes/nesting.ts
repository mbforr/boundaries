import { BACKDROP, CAMERAS, ESB } from '../config';
import type { Camera, Scene, Step } from '../engine/types';
import type { LayerId } from '../layers.generated';

/**
 * The two layers in the whole stack that nest.
 *
 * Census geography nests because statisticians designed it to in a lab, and you can read
 * the nesting straight off the GEOID: a block id contains its block group, which contains
 * its tract, which contains its county. Watersheds nest for the opposite reason — water
 * runs downhill and the hierarchy follows the terrain.
 *
 * Both scenes use the same shell animation: each level snaps on around the last and the
 * camera pulls back one step, so the containment is something you watch rather than read.
 */

/** One rung of a nesting sequence. */
interface Shell {
  layer: LayerId;
  geoid: string;
  caption: string;
  camera: Camera;
  /** For the census scene, the GEOID prefix still standing at this level. */
  digits?: string;
}

function shellSteps(shells: Shell[], overlay: 'geoid' | null): Step[] {
  const steps: Step[] = [];
  shells.forEach((s, i) => {
    const filter = ['==', ['get', 'std_geoid'], s.geoid];
    if (i > 0) steps.push({ t: 'fly', camera: s.camera, ms: 1500, curve: 1.1 });
    steps.push({ t: 'caption', text: s.caption });
    steps.push({ t: 'snap', layer: s.layer, filter });
    if (overlay === 'geoid' && s.digits) {
      steps.push({ t: 'overlay', name: 'geoid', state: s.digits });
    }
    steps.push({ t: 'wait', ms: 520 });
  });
  return steps;
}

/**
 * Every shell revealed so far stays on screen — that is the point of the shot. Shells are
 * listed innermost first and taper outward, so the small one you are meant to be looking
 * at is the strongest and the containing shells recede behind it.
 */
function shellLayers(shells: Shell[]) {
  return shells.map((s, i) => ({
    id: s.layer,
    filter: ['==', ['get', 'std_geoid'], s.geoid] as unknown[],
    paint: { fillOpacity: Math.max(0.05, 0.22 - i * 0.05) },
  }));
}

// ── census: block -> block group -> tract -> county ──────────────────────────

const CENSUS_SHELLS: Shell[] = [
  { layer: 'census_block@nyc', geoid: '360610076001001', digits: '360610076001001',
    caption: 'Block 1001', camera: { center: ESB, zoom: 16.2 } },
  { layer: 'census_bg@nyc', geoid: '360610076001', digits: '360610076001',
    caption: 'Block Group 1', camera: { center: ESB, zoom: 15.1 } },
  { layer: 'census_tract@nyc', geoid: '36061007600', digits: '36061007600',
    caption: 'Census Tract 76', camera: { center: ESB, zoom: 14.0 } },
  { layer: 'census_county@nyc', geoid: '36061', digits: '36061',
    caption: 'New York County', camera: CAMERAS.manhattan },
];

export const censusNesting: Scene = {
  id: 'census-nesting',
  chapter: 'count-you',
  camera: CAMERAS.manhattan,
  labels: [],
  layers: shellLayers(CENSUS_SHELLS),
  counter: 8,
  pen: 'statisticians',
  caption: 'It nests, because it was designed to.',
  overlay: { name: 'geoid', state: '36061' },
  enter: [
    { t: 'pen', pen: 'statisticians' },
    { t: 'jump', camera: CENSUS_SHELLS[0]!.camera },
    { t: 'overlay', name: 'geoid', state: '360610076001001' },
    ...shellSteps(CENSUS_SHELLS, 'geoid'),
    { t: 'caption', text: 'It nests, because it was designed to.' },
    { t: 'wait', ms: 400 },
  ],
};

// ── water: HUC2 -> HUC8 -> HUC12, run inward, the way water arrives ──────────

const WATER_SHELLS: Shell[] = [
  { layer: 'usgs_wbd_huc2', geoid: '02', caption: 'Mid Atlantic Region, HUC2',
    camera: { center: [-77.5, 40.5], zoom: 5.4 } },
  { layer: 'usgs_wbd_huc8@nyc', geoid: '02030101', caption: 'Lower Hudson, HUC8',
    camera: { center: [-73.95, 41.1], zoom: 8.2 } },
  { layer: 'usgs_wbd_huc12@nyc', geoid: '020301010405',
    caption: 'East River-Hudson River, HUC12', camera: CAMERAS.nycMetro },
];

export const watershedNesting: Scene = {
  id: 'watershed-nesting',
  chapter: 'swarm',
  camera: CAMERAS.nycMetro,
  labels: [],
  layers: shellLayers(WATER_SHELLS),
  counter: 82,
  pen: 'surveyors',
  caption: 'Rivers and census data: the only two that nest.',
  enter: [
    { t: 'pen', pen: 'surveyors' },
    { t: 'fly', camera: WATER_SHELLS[0]!.camera, ms: 2400 },
    ...shellSteps(WATER_SHELLS, null),
    { t: 'caption', text: 'Rivers and census data: the only two that nest.' },
    { t: 'wait', ms: 400 },
  ],
};

// ── five definitions of "city" ───────────────────────────────────────────────

/**
 * The word "city" has five government definitions and they disagree. Each one is a
 * different agency's answer to the same question, so each gets its own tint and pushes
 * the camera out one more step.
 */
const CITY_RINGS: { layer: LayerId; geoid: string; label: string; camera: Camera; beat: number }[] = [
  { layer: 'census_place@nyc', geoid: '3651000', label: 'City limits',
    camera: CAMERAS.nycMetro, beat: 5 },
  { layer: 'census_urban_area', geoid: '63217', label: 'Urban area',
    camera: { center: [-74.0, 40.72], zoom: 8.4 }, beat: 10 },
  { layer: 'census_metdiv', geoid: '35614', label: 'Metropolitan division',
    camera: { center: [-74.0, 40.85], zoom: 7.8 }, beat: 15 },
  { layer: 'census_cbsa', geoid: '35620', label: 'Metropolitan statistical area',
    camera: { center: [-74.2, 40.9], zoom: 7.2 }, beat: 14 },
  { layer: 'census_csa', geoid: '408', label: 'Combined statistical area',
    camera: CAMERAS.northeast, beat: 16 },
];

export const fiveCities: Scene = {
  id: 'five-cities',
  chapter: 'count-you',
  camera: CAMERAS.northeast,
  labels: [],
  layers: CITY_RINGS.map((r, i) => ({
    id: r.layer,
    filter: ['==', ['get', 'std_geoid'], r.geoid] as unknown[],
    // Nested rings read best when the outer ones are fainter than the inner ones.
    paint: { fillOpacity: 0.16 - i * 0.025 },
  })),
  counter: 16,
  pen: 'statisticians',
  caption: 'Five official definitions of "city". They disagree.',
  enter: [
    { t: 'pen', pen: 'statisticians' },
    { t: 'jump', camera: CITY_RINGS[0]!.camera },
    ...CITY_RINGS.flatMap((r, i): Step[] => [
      ...(i > 0 ? [{ t: 'fly', camera: r.camera, ms: 1600, curve: 1.1 } as Step] : []),
      { t: 'caption', text: r.label },
      { t: 'snap', layer: r.layer, filter: ['==', ['get', 'std_geoid'], r.geoid] },
      { t: 'wait', ms: 560 },
    ]),
    { t: 'caption', text: 'Five official definitions of "city". They disagree.' },
    { t: 'wait', ms: 400 },
  ],
};

export { BACKDROP };
