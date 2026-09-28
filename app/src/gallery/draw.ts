import { LAYERS, type LayerId } from '../layers.generated';
import { PAINT } from '../config';
import { penPaint } from '../engine/layerManager';
import { bootGallery, ready } from './boot';
import { framingOf } from './bounds';
import { ringsOf, ringFeature, trace, type Order, type Ring } from './rings';
import { Chrome } from './chrome';

/**
 * /draw.html — one layer, drawn by a moving pen.
 *
 * The layer is exploded into its individual rings (see rings.ts), the rings are ordered —
 * west to east by default — and then a nib walks them one after another, leaving the drawn
 * line behind it. A faint ghost of the whole layer shows where it is heading.
 *
 *   ?layer=<id>   which layer, e.g. census_county or census_bg@nyc. See the picker.
 *   ?ms=14000     total duration of the run, whatever the layer's size
 *   ?order=lon    lon | lat | area | file — the draw order, and so the character of it
 *   ?ghost=0      hide the faint preview of the undrawn part
 *   ?frame=full   frame to the layer's true extent, outlying islands included
 *   ?loop=1       restart when it finishes
 *   ?record=1     the deck's record mode, 1920x1080 (&res=4k, &fit=1)
 *
 * On the timing: the run is a FIXED DURATION, so the pen's speed is set by how much
 * geometry the layer has. 51 states trace visibly, ring by ring; 7,518 block groups become
 * a wave crossing the city, because at that density an individual outline is two frames
 * long and there is nothing to see in it. Both are the truth about the layer.
 */
const DEFAULT_LAYER: LayerId = 'census_state';
const DEFAULT_MS = 14000;
/**
 * The reveal is a data-driven paint expression, and changing one of those makes mapbox
 * re-evaluate the property for every feature in every loaded tile. On a 3,235-feature
 * layer that is far too much to do 60 times a second, so it is throttled: the nib and its
 * trail move every frame from a tiny source of their own, while the bulk of the drawn line
 * catches up 20 times a second. At that rate the seam is invisible — the nib is always
 * ahead of it by less than one ring.
 */
const REVEAL_MS = 50;

const TRAIL_SRC = 'gl:trail';
const NIB_SRC = 'gl:nib';

const { map, stage, params } = bootGallery();

const totalMs = Math.max(500, Number(params.get('ms') ?? DEFAULT_MS));
const order = (params.get('order') ?? 'lon') as Order;
const ghost = params.get('ghost') !== '0';
const fullFrame = params.get('frame') === 'full';
const loop = params.get('loop') === '1';

const requested = params.get('layer') as LayerId | null;
let layerId: LayerId = requested && requested in LAYERS ? requested : DEFAULT_LAYER;
if (requested && !(requested in LAYERS)) {
  console.warn(`draw: no layer "${requested}" in the registry; falling back to ${layerId}`);
}

const chrome = new Chrome(stage, [
  'SPACE  pause', 'R  redraw', '→ ←  next / previous layer', 'H  hide this',
].join('<br>'));
const picker = buildPicker();

let rings: Ring[] = [];
/** Bumped by anything that restarts the run, so an in-flight frame loop stands down. */
let epoch = 0;
let paused = false;

function buildPicker(): HTMLSelectElement {
  const wrap = document.createElement('div');
  wrap.className = 'gl-pick';
  wrap.innerHTML = '<label for="gl-layer">Layer</label>';
  const sel = document.createElement('select');
  sel.id = 'gl-layer';
  for (const id of Object.keys(LAYERS) as LayerId[]) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${LAYERS[id].name}  ·  ${id}`;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => { void load(sel.value as LayerId); });
  wrap.appendChild(sel);
  stage.appendChild(wrap);
  return sel;
}

/** The sources and style layers are created once and re-fed for each layer. */
function install(): void {
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource(TRAIL_SRC, { type: 'geojson', data: empty as never });
  map.addSource(NIB_SRC, { type: 'geojson', data: empty as never });

  // Where the pen has not been yet. Faint, so the shape of the layer is legible as a
  // destination without competing with the line being drawn.
  map.addLayer({
    id: 'gl:ghost', type: 'line', source: TRAIL_SRC,
    paint: { 'line-color': '#7b8794', 'line-width': 1, 'line-opacity': ghost ? 0.14 : 0 },
    layout: { 'line-join': 'round', 'line-cap': 'round' },
  });
  // What the pen has drawn.
  map.addLayer({
    id: 'gl:trail', type: 'line', source: TRAIL_SRC,
    paint: {
      'line-color': '#fff' as never,
      'line-width': PAINT.lineWidth,
      'line-opacity': 0,
    },
    layout: { 'line-join': 'round', 'line-cap': 'round' },
  });
  // The ring currently under the nib, traced point by point.
  map.addLayer({
    id: 'gl:nib-line', type: 'line', source: NIB_SRC,
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#fff', 'line-width': PAINT.lineWidth + 0.6, 'line-opacity': 1 },
    layout: { 'line-join': 'round', 'line-cap': 'round' },
  });
  // The nib itself. White whatever the pen, so it reads as the instrument and not as
  // another boundary.
  map.addLayer({
    id: 'gl:nib-dot', type: 'circle', source: NIB_SRC,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 4.5,
      'circle-color': '#fff',
      'circle-blur': 0.2,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': 'rgba(255,255,255,0.35)',
    },
  });
}

/** Reveal every ring up to and including `seq`. -1 draws nothing. */
function reveal(seq: number): void {
  const set = map.setPaintProperty.bind(map) as (l: string, p: string, v: unknown) => void;
  set('gl:trail', 'line-opacity',
      seq < 0 ? 0 : ['case', ['<=', ['get', 'seq'], seq], PAINT.lineOpacity, 0]);
}

function setNib(feats: unknown[]): void {
  (map.getSource(NIB_SRC) as { setData: (d: unknown) => void })
    .setData({ type: 'FeatureCollection', features: feats });
}

async function load(id: LayerId): Promise<void> {
  const mine = ++epoch;
  layerId = id;
  picker.value = id;
  const url = new URL(location.href);
  url.searchParams.set('layer', id);
  history.replaceState(null, '', url);

  const def = LAYERS[id];
  chrome.setLayer(id, def);
  chrome.setIndex('00');
  chrome.setStatus('loading');
  chrome.setProgress(0);
  setNib([]);
  reveal(-1);

  let data: unknown;
  try {
    const res = await fetch(def.path);
    if (!res.ok) throw new Error(`${def.path}: HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.error(`draw: ${id} failed to load`, e);
    chrome.setStatus('failed to load');
    return;
  }
  if (mine !== epoch) return;

  rings = ringsOf(data, order);
  if (!rings.length) {
    chrome.setStatus('no drawable geometry');
    return;
  }

  (map.getSource(TRAIL_SRC) as { setData: (d: unknown) => void })
    .setData({ type: 'FeatureCollection', features: rings.map(ringFeature) });

  // The trail takes the layer's own pen; a file whose features each carry their own gets
  // the same match expression the deck uses, so the reveal stack draws in six colours.
  const color = penPaint(def.pen);
  (map.setPaintProperty as (l: string, p: string, v: unknown) => void)(
    'gl:trail', 'line-color', color);

  const framing = framingOf(data);
  const bbox = fullFrame ? framing.full : framing.framed;
  // Say so rather than silently cropping — see gallery/bounds.ts.
  if (!fullFrame && framing.trimmed) {
    chrome.appendNote('frame trimmed');
  }
  if (bbox) {
    const cam = map.cameraForBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: { top: 110, right: 110, bottom: 220, left: 110 },
      maxZoom: 15,
    });
    if (cam) map.jumpTo(cam);
  }

  run(mine);
}

function run(mine: number): void {
  const start = performance.now();
  let lastReveal = -Infinity;
  let shown = -1;
  paused = false;
  // Time spent paused, subtracted from the clock so a pause holds the pen still rather
  // than letting the run continue behind the frozen picture and jump on resume.
  let held = 0;
  let heldSince = 0;

  const frame = (now: number) => {
    if (mine !== epoch) return;
    if (paused) {
      if (!heldSince) heldSince = now;
      requestAnimationFrame(frame);
      return;
    }
    if (heldSince) { held += now - heldSince; heldSince = 0; }
    /*
     * Clamped at BOTH ends, and the lower one is not defensive padding.
     *
     * requestAnimationFrame passes the time the frame's work began, which can precede the
     * performance.now() taken when the run was set up a moment earlier. That makes the
     * first frame's elapsed time negative, and an unclamped `i` of -1 indexes off the
     * front of the ring array — the run died on its first frame, intermittently, because
     * whether it happened depended on how long the fetch before it took.
     */
    const t = Math.max(0, Math.min(1, (now - start - held) / totalMs));
    const head = t * rings.length;
    const i = Math.max(0, Math.min(rings.length - 1, Math.floor(head)));
    const f = head - Math.floor(head);

    const ring = rings[i]!;
    const partial = trace(ring, t >= 1 ? 1 : f);
    const tip = partial[partial.length - 1]!;
    setNib([
      { type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: partial } },
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: tip } },
    ]);

    // The bulk of the drawn line catches up on its own, slower clock — see REVEAL_MS.
    if (i - 1 !== shown && now - lastReveal >= REVEAL_MS) {
      shown = i - 1;
      reveal(shown);
      lastReveal = now;
    }

    chrome.setProgress(t);
    chrome.setIndex(String(i + 1).padStart(2, '0'));
    chrome.setStatus(`ring ${(i + 1).toLocaleString()} / ${rings.length.toLocaleString()}`);

    if (t < 1) { requestAnimationFrame(frame); return; }

    // Landed: draw every ring outright and take the nib off the page, so the final frame
    // is the finished layer and not the animation's last step.
    reveal(rings.length - 1);
    setNib([]);
    chrome.setStatus(`${rings.length.toLocaleString()} rings  ·  drawn`);
    if (loop) setTimeout(() => { if (mine === epoch) run(++epoch); }, 1200);
  };
  requestAnimationFrame(frame);
}

function stepLayer(delta: number): void {
  const ids = Object.keys(LAYERS) as LayerId[];
  const at = ids.indexOf(layerId);
  void load(ids[(at + delta + ids.length) % ids.length]!);
}

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement) return; // the picker owns its own keys
  if (e.key === ' ') {
    e.preventDefault();
    paused = !paused;
    chrome.setStatus(paused ? 'paused' : 'drawing');
    return;
  }
  if (e.key === 'r' || e.key === 'R') { void load(layerId); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); stepLayer(1); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); stepLayer(-1); return; }
  if (e.key === 'h' || e.key === 'H') { chrome.toggle(); return; }
});

void ready(map).then(() => {
  install();
  void load(layerId);
});
