import mapboxgl from 'mapbox-gl';
import './styles.css';

import { MAP_STYLE, CAMERAS, TIMING } from './config';
import { DECK } from './scenes';
import { LayerManager } from './engine/layerManager';
import { applyEndState, stripBasemap } from './engine/state';
import { runSteps } from './engine/steps';
import { Timeline, isInterrupt } from './engine/timeline';
import { Hud } from './hud';
import { Overlays } from './overlays';
import { Drive } from './engine/drive';
import { readRecordOpts, applyRecordMode } from './record';
import { addHatch } from './engine/hatch';
import { applyFilmStyle } from './filmstyle';
import { requireToken, watchTokenErrors } from './token';
import { Cues } from './cues';
import { beatLayerId } from './scenes';
import { BEATS } from './beats.generated';
import type { LayerId } from './layers.generated';

mapboxgl.accessToken = requireToken();

const params = new URLSearchParams(location.search);
const record = readRecordOpts(params);
const stage = document.getElementById('stage')!;
const hudRoot = document.getElementById('hud')!;

const hud = new Hud(hudRoot);
const overlays = new Overlays(stage);
const timeline = new Timeline();
const cues = new Cues();

const map = new mapboxgl.Map({
  container: 'map',
  style: MAP_STYLE,
  center: CAMERAS.country.center,
  zoom: CAMERAS.country.zoom,
  attributionControl: false,
  logoPosition: 'bottom-right',
  projection: { name: 'mercator' },
  fadeDuration: 0, // deterministic frames: no cross-fade between tile loads
  preserveDrawingBuffer: true,
});

/*
 * The map must never handle the arrow keys.
 *
 * Mapbox pans on arrow keys by default, and its handler sits on the map container, so it
 * fires while the event is still bubbling toward the window listener below — the deck's
 * own preventDefault comes too late. The result was the map sliding sideways at the same
 * time as the scene advanced. Arrows drive the deck; the map does not get a vote.
 *
 * Mouse pan and zoom stay enabled outside record mode, for framing a shot by hand.
 */
map.keyboard.disable();

// A token the build has but Mapbox refuses draws an empty stage and says nothing. See
// token.ts — this is what puts the reason on screen instead.
watchTokenErrors(map);

const layers = new LayerManager(map, (busy) => hud.setBusy(busy));

/**
 * Exposed for the headless smoke test in scripts/smoke.py. Harmless in a recording.
 * `__navigating` matters: a keypress during a choreography lands the current scene
 * instead of advancing, so anything driving the deck has to wait rather than guess.
 */
interface Probe {
  __map: unknown; __scene: () => string; __navigating: () => boolean;
  __index: () => number; __deckLength: () => number;
  __audit: () => { scene: string; bad: string[] };
  __deck: () => DeckRow[];
}

/** One row of the deck, flattened for scripts/scene_index.py. */
interface DeckRow {
  i: number; id: string; beat: number | null; chapter: string;
  pen: string | null; counter: number | string | null;
  caption: string | null; card: string | null; cardSub: string | null;
  layers: string[]; steps: number;
}
const probe = window as unknown as Probe;
probe.__map = map;
probe.__scene = () => DECK[index]!.id;
probe.__navigating = () => navigating;
probe.__index = () => index;
probe.__deckLength = () => DECK.length;
/**
 * The whole deck, flattened.
 *
 * scripts/scene_index.py reads this to build SCENES.md rather than re-deriving the deck
 * order in Python. The splice of 14 choreographed sequences into the 93 beats lives in
 * scenes.ts and is not worth having a second implementation of — one that could disagree
 * with the deck and produce an index nobody notices is wrong.
 */
probe.__deck = () => DECK.map((s, i) => ({
  i,
  id: s.id,
  beat: s.beat ?? null,
  chapter: s.chapter,
  pen: s.pen,
  counter: s.counter,
  caption: s.caption,
  card: s.card?.title ?? null,
  cardSub: s.card?.sub ?? null,
  layers: s.layers.map((v) => v.id),
  steps: s.enter?.length ?? 0,
}));
/**
 * Compare what is actually on the map against what the current scene declares, and
 * return the discrepancies. The engine's whole contract is that these agree, so this is
 * the cheapest way to check every scene without screenshotting every one.
 */
probe.__audit = () => {
  const scene = DECK[index]!;
  const bad: string[] = [];
  const want = new Set(scene.layers.map((v) => v.id));
  for (const id of layers.allIds()) {
    if (!layers.isAdded(id)) {
      if (want.has(id)) bad.push(`${id} should be visible but was never added`);
      continue;
    }
    const vis = map.getLayoutProperty(layers.fillId(id), 'visibility') !== 'none';
    if (vis !== want.has(id)) {
      bad.push(vis ? `${id} is visible but the scene does not list it`
                   : `${id} is listed by the scene but hidden`);
    }
  }
  const counterEl = document.querySelector('#hud-counter') as HTMLElement;
  const shown = counterEl.hidden ? null : counterEl.textContent;
  const expected = scene.counter === null ? null
    : scene.counter === 'blur' ? '000' : String(scene.counter);
  if (shown !== expected) bad.push(`counter shows ${shown}, scene declares ${expected}`);

  const cardEl = document.querySelector('#hud-card') as HTMLElement;
  if (cardEl.hidden === Boolean(scene.card)) {
    bad.push(scene.card ? 'scene declares a card but none is shown'
                        : 'a card is shown but the scene declares none');
  }
  const capEl = document.querySelector('#hud-caption') as HTMLElement;
  const cap = capEl.hidden ? null : capEl.textContent;
  if (cap !== scene.caption) bad.push(`caption is ${JSON.stringify(cap)}, scene declares ${JSON.stringify(scene.caption)}`);

  return { scene: scene.id, bad };
};
const drive = new Drive(map);
const ctx = { map, layers, hud, overlays, drive };

let index = 0;
let navigating = false;
/**
 * Navigation epoch. Bumped by every navigation intent; a navigation that is no longer
 * the current epoch must not write to the map. Without this, interrupting a choreography
 * with the left arrow raced the choreography's own end-state write against goTo's.
 */
let navEpoch = 0;

function sceneIndexFromUrl(): number {
  const want = params.get('scene');
  if (!want) return 0;
  const byId = DECK.findIndex((s) => s.id === want);
  if (byId >= 0) return byId;
  const n = Number(want);
  const byBeat = DECK.findIndex((s) => s.beat === n);
  return byBeat >= 0 ? byBeat : 0;
}

function syncUrl(): void {
  const url = new URL(location.href);
  url.searchParams.set('scene', DECK[index]!.id);
  history.replaceState(null, '', url);
}

function updateIndexReadout(): void {
  const s = DECK[index]!;
  hud.setIndex(`${index + 1}/${DECK.length}  ${s.id}  ${s.chapter}`);
  cues.record({
    type: s.beat === undefined ? 'scene' : 'tick',
    scene: s.id,
    beat: s.beat ?? null,
    pen: s.pen,
    caption: s.caption,
  });
}

/** Warm the layers the next few scenes will need, so nothing pops in mid-beat. */
function prefetchAhead(): void {
  const ids: LayerId[] = [];
  for (let i = index + 1; i <= index + 4 && i < DECK.length; i++) {
    for (const v of DECK[i]!.layers) ids.push(v.id);
  }
  layers.prefetch(ids);
}

/** Jump straight to a scene's end state. Always safe, always identical. */
async function goTo(i: number): Promise<void> {
  timeline.interrupt();
  const epoch = ++navEpoch;
  index = Math.max(0, Math.min(DECK.length - 1, i));
  syncUrl();
  updateIndexReadout();
  await applyEndState(map, layers, hud, overlays, drive, DECK[index]!);
  if (epoch !== navEpoch) return; // a newer navigation started while we were loading
  prefetchAhead();
}

/** Advance, playing the next scene's choreography if it has one. */
async function next(): Promise<void> {
  if (index >= DECK.length - 1) return;
  if (navigating) {
    // A press during a choreography lands the current scene immediately; the next press
    // advances. Never queue up a half-finished animation.
    timeline.interrupt();
    return;
  }
  const current = DECK[index]!;
  const target = DECK[index + 1]!;
  if (!target.enter) { await goTo(index + 1); return; }

  /*
   * Cross-fade. Layers the outgoing scene had and the incoming one does not are dissolved
   * out while the new scene's choreography fades its own layers in, so the two overlap
   * instead of one cutting to the other. applyEndState still hides them instantly at the
   * end, but by then they are already at zero, so nothing pops.
   */
  const keep = new Set(target.layers.map((v) => v.id));
  const departing = current.layers.filter((v) => !keep.has(v.id));
  const dissolve = Promise.all(departing.flatMap((v) => [
    layers.transition(layers.fillId(v.id), 'fill-opacity', 0, TIMING.crossfade),
    layers.transition(layers.lineId(v.id), 'line-opacity', 0, TIMING.crossfade),
  ]));

  const epoch = ++navEpoch;
  index += 1;
  syncUrl();
  updateIndexReadout();

  navigating = true;
  const tok = timeline.token();
  try {
    await runSteps(ctx, target, target.enter, tok);
    // Let the dissolve land before the end state hides the departing layers outright.
    await dissolve;
  } catch (e) {
    if (!isInterrupt(e)) throw e;
  } finally {
    navigating = false;
    // Whether the choreography finished or was interrupted, the scene lands on its
    // declared end state — one code path, so a beat can never drift from its own spec.
    // Unless a newer navigation has started, in which case that one owns the map.
    if (epoch === navEpoch) {
      await applyEndState(map, layers, hud, overlays, drive, DECK[index]!);
      prefetchAhead();
    }
  }
}

async function prev(): Promise<void> {
  if (index <= 0) return;
  await goTo(index - 1);
}

map.on('load', async () => {
  stripBasemap(map);
  // No-op unless this page set a plate look before importing the deck — see gallery/film.ts.
  // `names: false` because the deck chooses its own label groups scene by scene.
  applyFilmStyle(map, { names: false });
  layers.findLabelAnchor(); // boundary layers go under the labels, so labels stay legible
  addHatch(map);
  applyRecordMode(stage, map, record);
  index = sceneIndexFromUrl();
  await goTo(index);
  if (!record.enabled) hud.toggleIndex();
});

window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowRight': case ' ': case 'PageDown': e.preventDefault(); void next(); break;
    case 'ArrowLeft':  case 'PageUp':            e.preventDefault(); void prev(); break;
    case 'Home':       e.preventDefault(); void goTo(0); break;
    case 'End':        e.preventDefault(); void goTo(DECK.length - 1); break;
    case 'h': case 'H': hud.toggleVisible(); break;
    case 'i': case 'I': hud.toggleIndex(); break;
    case 'p': case 'P':
      // Preload everything, for an uninterrupted recording pass.
      layers.prefetch(DECK.flatMap((s) => s.layers.map((v) => v.id)));
      break;
    case 'c': case 'C':
      // Dump the cue track for the edit.
      void cues.dump();
      break;
    case 'r': case 'R':
      // Restart the cue clock at the top of a take.
      cues.reset();
      console.info('cue clock reset');
      break;
  }
});

// Fail fast at boot if the crosswalk and the registry have drifted apart.
for (const beat of BEATS) beatLayerId(beat);
console.info(
  `deck: ${DECK.length} scenes · ${BEATS.filter((b) => b.layer).length} polygon beats · ` +
  `${BEATS.filter((b) => !b.layer).length} card beats`,
);
