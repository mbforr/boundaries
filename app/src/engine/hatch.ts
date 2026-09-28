import type { Map as MapboxMap } from 'mapbox-gl';

/**
 * A diagonal hatch, registered as a map image so a fill can use it as a pattern.
 *
 * This exists for exactly one beat: the layers that pass all three rules but cannot be
 * shown, because a private company owns them. Hatching is the cartographic convention for
 * "no data here", and it is the honest way to draw an absence — the alternative would be
 * to draw a shape we do not have the right to draw.
 */
export function addHatch(map: MapboxMap, id = 'hatch', color = '#8a94a0'): void {
  if (map.hasImage(id)) return;
  const size = 16;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'square';
  // Two strokes, offset by the tile size, so the diagonal is continuous when it repeats.
  for (const off of [-size, 0]) {
    ctx.beginPath();
    ctx.moveTo(off, size);
    ctx.lineTo(off + size, 0);
    ctx.stroke();
  }
  map.addImage(id, ctx.getImageData(0, 0, size, size), { pixelRatio: 1 });
}
