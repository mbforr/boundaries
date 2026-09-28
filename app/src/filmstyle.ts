import type { Map as MapboxMap } from 'mapbox-gl';

/**
 * Two looks for the map, for footage that gets composited rather than watched as-is.
 *
 * MATTE — the land at 50% grey or lighter, the place names pure white. dark-v11 is built
 * to sit behind saturated boundary fills on a near-black ground, which is right for the
 * deck and wrong for a plate you are going to lay other things over: the land is almost
 * the same value as the sea, and the names are #e8ecf1 rather than white.
 *
 * KEY — the same land and names, with everything that is not land in a flat chroma green.
 * #00FF00 by default, and the default is the point: the markets pen is #009E73, a green
 * too, and a keyer working on hue would have to separate 164° from 142° if this were the
 * broadcast #00B140. At 120° there is 44° of clearance, and since these frames are
 * synthetic there are no soft edges to spill, so the purest key is also the safest one.
 *
 * Both are applied after `stripBasemap`, which hides every label. The gallery pages want
 * the names turned back on, so they ask for them. The deck does not: it decides per scene
 * which label groups belong on screen, and this look only recolours whatever it shows —
 * see `styleLabel` in engine/state.ts.
 */
export interface FilmStyle {
  /** Land base. The brief was "50% grey and higher", so: #808080 unless told otherwise. */
  land: string;
  /** Everything that is not land. A chroma green in key mode; a dark neutral otherwise. */
  water: string;
  /** Place names. */
  ink: string;
  /** A dark halo behind the names. On by default — it is what stops them blending. */
  halo: boolean;
  /**
   * Keep the basemap's river LINES, which are non-land and so take the key colour.
   *
   * Off by default, and not for tidiness. A waterway line is a hairline, and a hairline in
   * the key colour composites as a hairline hole with a green fringe down both sides of
   * it — worse than not being there. Water POLYGONS, which is every lake, bay and the sea
   * itself, are keyed either way.
   */
  waterways: boolean;
  /**
   * Keep the non-land pixels pure by drawing the water ABOVE the boundary layers.
   *
   * On by default for the key plate, and it is what makes the key usable. The deck's
   * boundaries are semi-transparent fills that cover water as readily as land — a census
   * county includes the bay — so over the sea the key colour came out tinted: measured
   * #13EE33 under a statisticians fill rather than #00FF00, and a different tint under
   * every pen. Raising the water above them means the sea is always exactly the key
   * colour and the boundaries stop at the coastline.
   *
   * The cost is real and worth stating: on this plate a boundary that extends over water
   * is cut off at the shore. That is what you want when the sea is about to be keyed out
   * anyway, and not what you want if you are studying the boundary. `?clip=0` turns it off.
   */
  clip: boolean;
}

export const KEY_GREEN = '#00FF00';
const LAND_GREY = '#808080';
const MATTE_WATER = '#22262b';

/**
 * Basemap fills that tint the land. Flattened to the land colour so the plate is one flat
 * value: without this, parks and landuse leave patches a keyer or a luma pass will find.
 */
const LAND_TINTS = ['national-park', 'landuse', 'land-structure-polygon'];
const LAND_TINT_LINES = ['land-structure-line'];
/** Everything that is not land. `waterway` is a line, the rest are fills. */
const WATER_FILLS = ['water'];
const WATER_LINES = ['waterway'];

/** Names worth keeping: states and settlements. Neighbourhoods stay off, as in the deck. */
const NAME_LAYERS = ['state-label', 'settlement-major-label', 'settlement-minor-label',
                     'settlement-label', 'country-label'];

let current: FilmStyle | null = null;

/** Set before the animation module is imported; read by whoever applies the style. */
export function setFilmStyle(style: FilmStyle | null): void { current = style; }

/** The style in force, or null when this is an ordinary page. */
export function filmStyle(): FilmStyle | null { return current; }

export function filmStyleFor(kind: 'matte' | 'key', params: URLSearchParams): FilmStyle {
  return {
    land: params.get('land') ?? LAND_GREY,
    water: params.get('water') ?? (kind === 'key' ? KEY_GREEN : MATTE_WATER),
    ink: params.get('ink') ?? '#FFFFFF',
    halo: params.get('halo') !== '0',
    waterways: params.get('waterways') === '1',
    clip: params.get('clip') ? params.get('clip') === '1' : kind === 'key',
  };
}

/**
 * `names`: turn the place labels back on and colour them. The gallery pages want that —
 * nothing else on those pages puts a label up. The deck passes false, because it chooses
 * label groups scene by scene and turning them all on here would override that.
 */
export function applyFilmStyle(map: MapboxMap, opts: { names?: boolean } = {}): void {
  if (!current) return;
  const style = current;
  const setPaint = map.setPaintProperty.bind(map) as
    (l: string, p: string, v: unknown) => void;
  const has = (id: string) => map.getLayer(id) !== undefined;

  if (has('land')) setPaint('land', 'background-color', style.land);

  for (const id of LAND_TINTS) {
    if (!has(id)) continue;
    setPaint(id, 'fill-color', style.land);
    setPaint(id, 'fill-opacity', 1);
    // A pattern would survive the flat colour and speckle the plate.
    setPaint(id, 'fill-pattern', null);
  }
  for (const id of LAND_TINT_LINES) {
    if (has(id)) setPaint(id, 'line-color', style.land);
  }

  for (const id of WATER_FILLS) {
    if (!has(id)) continue;
    setPaint(id, 'fill-color', style.water);
    setPaint(id, 'fill-opacity', 1);
    setPaint(id, 'fill-pattern', null);
  }
  for (const id of WATER_LINES) {
    if (!has(id)) continue;
    if (style.waterways) setPaint(id, 'line-color', style.water);
    else map.setLayoutProperty(id, 'visibility', 'none');
  }

  /*
   * The basemap's own admin lines come off.
   *
   * They are drawn in a pale grey that survives into the keyed area along coastal borders,
   * and on a plate whose whole purpose is that the non-land is one flat value, a stray
   * line is a hole in the key. The deck draws every boundary it actually means to show.
   */
  for (const layer of map.getStyle().layers) {
    if (layer.id.startsWith('admin-') && has(layer.id)) {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
  }

  if (style.clip) keepWaterAboveBoundaries(map);

  // stripBasemap hid every label on the way in; the names are wanted here.
  if (!opts.names) return;
  for (const id of NAME_LAYERS) {
    if (!has(id)) continue;
    map.setLayoutProperty(id, 'visibility', 'visible');
    setPaint(id, 'text-color', style.ink);
    /*
     * Opacity as well as colour, or the state names stay grey.
     *
     * dark-v11 fades `state-label` in and out on a zoom expression, so setting the colour
     * to pure white changed nothing visible at mid zooms — the names read as mid-grey on
     * grey land, which is the exact blending this look exists to avoid. The names are
     * either shown or not; they are never half shown.
     */
    setPaint(id, 'text-opacity', 1);
    setPaint(id, 'text-halo-color', style.halo ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)');
    setPaint(id, 'text-halo-width', style.halo ? 1.3 : 0);
    setPaint(id, 'text-halo-blur', 0);
  }
}

/**
 * Hold the water layer directly beneath the labels, above everything else.
 *
 * Re-asserted on `styledata` rather than done once, because the boundary layers are added
 * lazily — the deck fetches a layer the first time a scene asks for it, and every one of
 * those lands above the water again. The guard is what stops this recursing: moveLayer
 * fires styledata, so it only moves when the water is not already in place.
 */
function keepWaterAboveBoundaries(map: MapboxMap): void {
  const fix = (): void => {
    const layers = map.getStyle().layers;
    const water = layers.findIndex((l) => l.id === 'water');
    const label = layers.findIndex((l) => l.type === 'symbol');
    if (water < 0 || label < 0) return;
    if (water === label - 1) return; // already directly under the labels
    map.moveLayer('water', layers[label]!.id);
  };
  fix();
  map.on('styledata', fix);
}
