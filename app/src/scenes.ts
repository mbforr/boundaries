import { BEATS, type Beat } from './beats.generated';
import { LAYERS, type LayerId } from './layers.generated';
import { CAMERAS } from './config';
import type { Camera, Chapter, LabelGroup, Scene, Step } from './engine/types';
import { oklahomaTeaser, oklahomaScenes } from './scenes/oklahoma';
import { yellowstoneScenes, coldOpenArc } from './scenes/yellowstone';
import { censusNesting, watershedNesting, fiveCities } from './scenes/nesting';
import { arizonaClocks } from './scenes/arizona';
import {
  revealStack, manhattanTwice, zipVsZcta, coldOpenFlyout,
} from './scenes/reveal';
import { p2Scenes } from './scenes/p2';

/**
 * The deck, in script order.
 *
 * The 93 counter beats are generated from docs/beats.yaml. 51 have a polygon and snap it
 * on; 42 have no geometry in the stack and render as a typographic card instead — the
 * counter still ticks and the pen still flashes, but no shape is ever faked. Choreographed
 * scenes are spliced in at their script positions by `insertChoreography`.
 */

/** Resolve a beat's layer to a registry key, which is `id` or `id@nyc`. */
export function beatLayerId(beat: Beat): LayerId | null {
  if (!beat.layer) return null;
  const key = beat.scope === 'nyc' ? `${beat.layer}@nyc` : beat.layer;
  if (!(key in LAYERS)) {
    throw new Error(`beat ${beat.n} wants ${key}, which is not in the layer registry`);
  }
  return key as LayerId;
}

/**
 * Framing per beat. National layers sit at country zoom; New York layers are framed by
 * what they actually are — a city-wide boundary needs the metro, a block needs the lot.
 */
const ESB_CLOSE = new Set([
  'census_block', 'census_bg', 'census_tract', 'nyc_landmark_lot', 'fema_flood_nfhl',
  'nyc_election_district', 'nyc_zoning_district', 'nyc_special_purpose_district', 'nyc_bid',
]);
const METRO = new Set([
  'census_place', 'census_cousub', 'census_zcta', 'census_puma', 'nyc_borough',
  'usgs_wbd_huc8', 'usgs_wbd_huc12',
]);

function cameraFor(beat: Beat): Camera {
  if (beat.scope === 'national') return CAMERAS.country;
  if (beat.layer && ESB_CLOSE.has(beat.layer)) return CAMERAS.esbBlock;
  if (beat.layer && METRO.has(beat.layer)) return CAMERAS.nycMetro;
  return CAMERAS.manhattan;
}

/**
 * High-level labels, chosen by how far out the camera sits. They render above the
 * boundary fills, so they orient the viewer without the fills burying them. Neighbourhood
 * labels are never on by default: at the pin they are noise.
 */
function labelsFor(beat: Beat): LabelGroup[] {
  const zoom = cameraFor(beat).zoom;
  if (zoom < 5) return ['state'];
  if (zoom < 8) return ['state', 'place'];
  return ['place'];
}

/** Every beat scene. Polygon beats snap; card beats tick over a dimmed map. */
export function beatScenes(): Scene[] {
  return BEATS.map((beat) => {
    const layerId = beatLayerId(beat);
    const camera = cameraFor(beat);
    const base = {
      id: `beat-${String(beat.n).padStart(2, '0')}`,
      beat: beat.n,
      chapter: beat.chapter as Chapter,
      camera,
      labels: labelsFor(beat),
      counter: beat.n,
      pen: beat.pen,
      caption: beat.label,
    };

    if (!layerId) {
      const enter: Step[] = [
        { t: 'pen', pen: beat.pen },
        { t: 'counter', to: beat.n },
        { t: 'card', title: beat.label, sub: beat.cardSub },
        { t: 'caption', text: null },
      ];
      return {
        ...base,
        layers: [],
        caption: null,
        card: { title: beat.label, sub: beat.cardSub },
        enter,
      } satisfies Scene;
    }

    const filter = lsadFilter(beat);
    return {
      ...base,
      layers: [{ id: layerId, ...(filter ? { filter } : {}) }],
      // No card-clearing step: runSteps clears the card for any scene that does not
      // declare one, so this is the polygon beat's whole choreography.
      enter: [
        { t: 'pen', pen: beat.pen },
        { t: 'caption', text: beat.label },
        { t: 'snap', layer: layerId, tickTo: beat.n, ...(filter ? { filter } : {}) },
      ],
    } satisfies Scene;
  });
}

/**
 * Beats 14 and 17 are the same file. census_cbsa carries both metropolitan (LSAD M1) and
 * micropolitan (M2) areas, and the script counts them as two different kinds of boundary,
 * which they are.
 */
function lsadFilter(beat: Beat): unknown[] | null {
  if (beat.layer !== 'census_cbsa') return null;
  if (beat.n === 14) return ['==', ['get', 'LSAD'], 'M1'];
  if (beat.n === 17) return ['==', ['get', 'LSAD'], 'M2'];
  return null;
}

/** Splice choreographed scenes in after the beat they follow. */
export function insertChoreography(
  scenes: Scene[], extra: { afterBeat: number; scenes: Scene[] }[],
): Scene[] {
  // Several entries may target the same beat (a P1 sequence and a P2 one), so they are
  // merged in declaration order rather than the last one winning.
  const byBeat = new Map<number, Scene[]>();
  for (const e of extra) {
    byBeat.set(e.afterBeat, [...(byBeat.get(e.afterBeat) ?? []), ...e.scenes]);
  }
  const out: Scene[] = [];
  const used = new Set<number>();
  for (const scene of scenes) {
    out.push(scene);
    if (scene.beat !== undefined && byBeat.has(scene.beat)) {
      out.push(...byBeat.get(scene.beat)!);
      used.add(scene.beat);
    }
  }
  const orphans = [...byBeat.keys()].filter((b) => !used.has(b));
  if (orphans.length) {
    throw new Error(`choreography targets beats that do not exist: ${orphans.join(', ')}`);
  }
  return out;
}

/**
 * Where each choreographed sequence sits in the script.
 *
 * The Oklahoma turn lands twice, as the script does it: a short pivot out of the political
 * layers after beat 30, then the McGirt sequence after beat 36, once the tribal boundary
 * and the Alaska Native corporations have both ticked.
 */
const CHOREOGRAPHY: { afterBeat: number; scenes: Scene[] }[] = [
  { afterBeat: 8, scenes: [censusNesting] },       // the Russian dolls
  { afterBeat: 17, scenes: [fiveCities] },         // once all five definitions have ticked
  { afterBeat: 30, scenes: [oklahomaTeaser] },
  { afterBeat: 36, scenes: oklahomaScenes },
  { afterBeat: 40, scenes: yellowstoneScenes },
  { afterBeat: 61, scenes: [arizonaClocks] },
  { afterBeat: 65, scenes: [zipVsZcta] },
  { afterBeat: 82, scenes: [watershedNesting] },
  { afterBeat: 93, scenes: [revealStack, manhattanTwice] },
  ...p2Scenes,
];

export function buildDeck(): Scene[] {
  // The cold open runs before the counter starts.
  const deck = insertChoreography(beatScenes(), CHOREOGRAPHY);
  // The cold open runs before the counter starts: the lot, then the pull-back, then the
  // arc that plants the Yellowstone promise.
  deck.unshift(coldOpenFlyout, coldOpenArc);

  const ids = new Set<string>();
  for (const s of deck) {
    if (ids.has(s.id)) throw new Error(`duplicate scene id ${s.id}`);
    ids.add(s.id);
    // Catch a scene naming a layer that is not in the registry at build time rather than
    // as a blank frame halfway through a take.
    for (const v of s.layers) {
      if (!(v.id in LAYERS)) throw new Error(`scene ${s.id} names unknown layer ${v.id}`);
    }
  }
  return deck;
}

export const DECK: Scene[] = buildDeck();
