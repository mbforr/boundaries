import { LAYERS, type LayerId } from '../layers.generated';
import { ESB, PAINT } from '../config';
import { LayerManager } from '../engine/layerManager';
import { bootGallery, ready } from './boot';
import { bboxCovers } from './bounds';

/**
 * /flash.html — one place, every boundary over it, strobing.
 *
 * The camera holds a single location and pulls back continuously for the whole run while
 * the layers swap underneath it every few hundred milliseconds. No text, no chrome, no
 * counter: the only things on screen are the ground and the boundaries over it.
 *
 * The default location is 350 Fifth Avenue, and that is not arbitrary — it is the one
 * point the whole stack is known to cover, which is the film's premise. Framing each layer
 * to its own extent, which is what this page used to do, cannot work here: the camera
 * never stops moving, so every layer has to be drawn wherever the camera happens to be,
 * and only a location every layer actually covers gives 59 non-empty frames.
 *
 *   ?at=-73.9857,40.7484    where to stand
 *   ?ms=400                 how long each layer holds; 300-500 is the range that reads
 *   ?from=13.5 ?to=3.6      the zoom to pull back through, across the whole run
 *   ?pan=0.125              how far the anchor drifts, as a fraction of the frame
 *   ?order=nest             nest | registry — see the ordering note below
 *   ?scope=nyc ?pen=courts  restrict the reel
 *   ?loop=0                 stop at the end instead of starting over
 *   ?record=1               the deck's record mode, 1920x1080 (&res=4k, &fit=1)
 *
 * SPACE pauses, R restarts. Nothing is drawn for either — there is no text on this page.
 */
const MS_DEFAULT = 400;
const ZOOM_FROM = 13.5;
const ZOOM_TO = 3.6;
/**
 * How far the anchor slides across the frame over the whole run.
 *
 * Deliberately a BOUNDED excursion rather than a rate. The first version accumulated drift
 * per frame at a fixed fraction of the current viewport per second, which keeps the
 * apparent speed constant — but the viewport grows by a factor of about 900 during the
 * pull-back, so almost all of the distance was covered in the last few seconds and the
 * camera ended up a degree and a half out in the Atlantic with New York in the corner.
 * Expressed as a fraction of the frame, the anchor drifts a set distance across it and
 * stops there, at every zoom. An eighth is the value that reads: perceptible as motion
 * over twenty seconds — about 240 px at 1920 — without walking the subject out towards a
 * corner by the end, which a fifth did. At the widest zoom the frame is 110° across, so
 * what looks like a modest fraction is a very long way.
 */
const PAN_AMPLITUDE = 0.125;
/** Layers kept loaded ahead of and behind the cursor. See the note on rhythm in `tick`. */
const AHEAD = 8;
const BEHIND = 3;

const { map, params } = bootGallery();

const ms = Math.max(80, Number(params.get('ms') ?? MS_DEFAULT));
const zoomFrom = Number(params.get('from') ?? ZOOM_FROM);
const zoomTo = Number(params.get('to') ?? ZOOM_TO);
const panAmp = Number(params.get('pan') ?? PAN_AMPLITUDE);
const loop = params.get('loop') !== '0';
const order = params.get('order') ?? 'nest';
const scope = params.get('scope');
const pen = params.get('pen');

const at: [number, number] = (() => {
  const raw = params.get('at');
  if (!raw) return ESB;
  const [lng, lat] = raw.split(',').map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    console.warn(`flash: unreadable ?at=${raw}; standing at the Empire State Building`);
    return ESB;
  }
  return [lng!, lat!];
})();

/**
 * Order the reel to match the camera.
 *
 * This matters more than it sounds. The camera pulls back monotonically for the whole run,
 * so the sequence of layers has to pull back with it: in registry order — which is
 * alphabetical — census_block and nyc_landmark_lot came up near the end, when the camera
 * was already at state scale and a city block is half a pixel, while census_nation came up
 * at the start and was a flat wash of colour over the whole frame. Every layer was on
 * screen; half of them were unreadable at the moment they got.
 *
 * So: finest first. NYC-extent layers ahead of national ones, and within each, more
 * features first — a proxy for smaller features, and a good one here, since these files
 * all cover a fixed area and are subdivisions of it. Blocks, lots and election districts
 * play while the camera is tight; counties, states and the nation arrive once it is wide
 * enough to hold them. `?order=registry` restores the alphabetical run.
 */
const reel: LayerId[] = (Object.keys(LAYERS) as LayerId[])
  .filter((id) => {
    const def = LAYERS[id];
    if (scope && def.scope !== scope) return false;
    if (pen && def.pen !== pen) return false;
    return true;
  })
  .sort((a, b) => {
    if (order !== 'nest') return 0;
    const A = LAYERS[a], B = LAYERS[b];
    if (A.scope !== B.scope) return A.scope === 'nyc' ? -1 : 1;
    return B.features - A.features;
  });
if (!reel.length) throw new Error(`no layers match scope=${scope ?? '*'} pen=${pen ?? '*'}`);

const layers = new LayerManager(map, () => {});

/**
 * How long a pass lasts — and so how fast the camera pulls back.
 *
 * Not `reel.length * ms`, which is what it was: the reel holds 59 layers but only 54 are
 * over New York, so a pass ran five beats long, wrapped, and replayed census_block and the
 * zoning districts at zoom 4 where a city block is a speck. The run is as long as there
 * are layers to show, and since a layer is only known to be off-target once it has loaded
 * — eight beats ahead of the cursor — this converges within the first second or two and is
 * exact from then on.
 */
function runMs(): number { return Math.max(1, reel.length - offTarget.size) * ms; }

/** Loaded, and found not to cover this place. Learned once, then permanent. */
const offTarget = new Set<LayerId>();
/** Shown already this pass, so a short reel never repeats before the pass ends. */
const seen = new Set<LayerId>();

let start = 0;
let paused = false;
let held = 0;
let heldSince = 0;
/** Which beat we are on. Advanced by the clock, never by the loader. */
let beat = -1;
/** How far through the reel the picker has got. Only eligible layers consume a beat. */
let cursor = 0;
let showing: LayerId | null = null;

/**
 * Where the camera is at time `t` through the run.
 *
 * Zoom is linear in the zoom VALUE, which is exponential in scale, and that is what makes
 * a long pull-back read as steady instead of as rushing at the end.
 */
function camera(t: number): { center: [number, number]; zoom: number } {
  const zoom = zoomFrom + (zoomTo - zoomFrom) * t;
  // Mapbox lays the world out over 512 px at zoom 0, which is what makes this the real
  // width of the frame in degrees rather than a number that only looks like one.
  const degPerPx = 360 / (512 * Math.pow(2, zoom));
  const frameW = map.getContainer().clientWidth * degPerPx;
  const frameH = map.getContainer().clientHeight * degPerPx
    * Math.cos(at[1] * Math.PI / 180);
  const slide = panAmp * t;
  return { center: [at[0] + frameW * slide, at[1] + frameH * slide * 0.4], zoom };
}

/** Put a layer up instantly. No cross-fade: at a 300 ms hold, a fade is most of the beat. */
function swapTo(id: LayerId): void {
  if (showing === id) return;
  if (showing) layers.hide(showing);
  layers.instant(id);
  layers.show(id, {
    fillOpacity: PAINT.fillOpacity,
    lineOpacity: PAINT.lineOpacity,
    lineWidth: PAINT.lineWidth,
  });
  showing = id;
}

/**
 * Keep the loaded set just ahead of the cursor.
 *
 * At a 400 ms hold there is no time to fetch an 18 MB layer on demand, so loading runs
 * ahead of the reel — and the reel never waits for it.
 */
function warm(): void {
  const ids: LayerId[] = [];
  for (let d = 1; d <= AHEAD; d++) ids.push(reel[(cursor + d) % reel.length]!);
  layers.prefetch(ids);

  const keep = new Set<LayerId>(ids);
  for (let d = -BEHIND; d <= 0; d++) keep.add(reel[(cursor + d + reel.length) % reel.length]!);
  for (const id of reel) {
    if (!keep.has(id) && layers.isAdded(id) && id !== showing) layers.drop(id);
  }
}

/**
 * Is this layer worth a beat right now?
 *
 * Two ways to fail. It may not have finished loading — the clock does not wait, so it
 * simply comes round again next pass. Or it may not cover the place we are standing: six
 * of the derived layers are registered national but are regional in fact (the District of
 * Wyoming, the McGirt reservations, Navajo and Hopi, the gerrymanders, the Tulsa and Las
 * Vegas scene props), and standing in New York they would each take a beat in which the
 * screen holds nothing at all.
 */
function eligible(id: LayerId): boolean {
  if (offTarget.has(id)) return false;
  if (!layers.isAdded(id)) return false;
  const box = layers.bbox(id);
  if (box && !bboxCovers(box, at[0], at[1])) { offTarget.add(id); return false; }
  return true;
}

/**
 * The next layer to put up, scanning forward from the cursor.
 *
 * Scanning rather than indexing keeps the beat regular: a layer that is not ready, or not
 * over this place, is passed over WITHOUT consuming the beat, so the montage never holds a
 * frame for double the interval and never shows an empty one.
 *
 * The cursor retires layers that can never play again — already seen, or known to be off
 * this place — and that is load-bearing rather than tidiness. The warm window is anchored
 * to the cursor, so a cursor that only moved when something was SHOWN could park forever:
 * at `?at=` a location outside New York, the thirty NYC-extent layers at the head of the
 * reel are all off-target, nothing was ever shown, the cursor never moved, and the warm
 * window kept refetching the same eight useless layers while the national ones below them
 * were never requested at all. The montage ran for a full pass with a blank screen.
 */
function pick(): LayerId | null {
  for (let guard = 0; guard < reel.length; guard++) {
    const id = reel[cursor]!;
    if (!seen.has(id) && !offTarget.has(id)) break;
    cursor = (cursor + 1) % reel.length;
  }
  for (let d = 0; d < reel.length; d++) {
    const i = (cursor + d) % reel.length;
    const id = reel[i]!;
    if (seen.has(id) || !eligible(id)) continue;
    seen.add(id);
    if (i === cursor) cursor = (cursor + 1) % reel.length;
    return id;
  }
  return null;
}

function tick(now: number): void {
  if (!start) start = now;
  if (paused) {
    if (!heldSince) heldSince = now;
    requestAnimationFrame(tick);
    return;
  }
  if (heldSince) { held += now - heldSince; heldSince = 0; }

  /*
   * Nothing up yet means the run has not begun. Hold the clock at zero — camera at the
   * near zoom, beat 0 — and keep trying, rather than letting the pull-back play out over
   * an empty screen while the first layers are still arriving.
   */
  if (!showing) {
    start = now;
    warm();
    const first = pick();
    if (first) swapTo(first);
    requestAnimationFrame(tick);
    return;
  }

  const elapsed = Math.max(0, now - start - held);
  const t = Math.min(1, elapsed / runMs());

  const cam = camera(t);
  map.jumpTo({ center: cam.center, zoom: cam.zoom });

  // The clock owns the rhythm: one beat every `ms`, whatever the loader is doing.
  const want = Math.floor(elapsed / ms);
  if (want !== beat) {
    beat = want;
    warm();
    const id = pick();
    if (id) swapTo(id);
  }

  if (t >= 1) {
    if (!loop) return;
    start = now;
    held = 0;
    beat = -1;
    cursor = 0;
    seen.clear();
  }
  requestAnimationFrame(tick);
}

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); paused = !paused; return; }
  if (e.key === 'r' || e.key === 'R') {
    start = 0; held = 0; heldSince = 0; beat = -1; cursor = 0; seen.clear();
  }
});

void ready(map).then(() => {
  layers.findLabelAnchor();
  map.jumpTo({ center: at, zoom: zoomFrom });
  // Warm the front of the reel before the clock starts, so the opening seconds are not the
  // one stretch of the run with nothing on screen.
  layers.prefetch(reel.slice(0, AHEAD));
  requestAnimationFrame(tick);
});
