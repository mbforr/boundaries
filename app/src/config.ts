import type { Camera } from './engine/types';

/** 350 Fifth Avenue. The one constant every scene is measured against. */
export const ESB: [number, number] = [-73.985654, 40.748428];

export const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';

/**
 * Named cameras. Scenes reference these rather than inlining coordinates, so a framing
 * change is one edit and every take stays reproducible.
 */
export const CAMERAS = {
  esbLot:    { center: ESB, zoom: 16.6, pitch: 60, bearing: -17 },
  esbBlock:  { center: ESB, zoom: 14.4, pitch: 0,  bearing: 0 },
  esbNear:   { center: ESB, zoom: 12.6, pitch: 0,  bearing: 0 },
  manhattan: { center: [-73.9712, 40.7616] as [number, number], zoom: 11.1, pitch: 0, bearing: 0 },
  nycMetro:  { center: [-73.9400, 40.7000] as [number, number], zoom: 9.2,  pitch: 0, bearing: 0 },
  northeast: { center: [-74.3000, 40.9000] as [number, number], zoom: 7.0,  pitch: 0, bearing: 0 },
  country:   { center: [-97.0000, 39.5000] as [number, number], zoom: 3.5,  pitch: 0, bearing: 0 },
  oklahoma:  { center: [-96.2000, 35.6000] as [number, number], zoom: 6.4,  pitch: 0, bearing: 0 },
  tulsa:     { center: [-95.9928, 36.1540] as [number, number], zoom: 10.2, pitch: 0, bearing: 0 },
  yellowstone: { center: [-110.5885, 44.4280] as [number, number], zoom: 7.2, pitch: 0, bearing: 0 },
  wyoming:     { center: [-108.4000, 43.2000] as [number, number], zoom: 5.7, pitch: 0, bearing: 0 },
  /*
   * Framed from the geometry, not by eye. The Idaho sliver measures 3.9 km wide by 39.1 km
   * tall, centred at [-111.0735, 44.3096]. The old camera sat at 44.14 — the strip's
   * SOUTHERN TIP, not its middle — at a zoom whose 1080p viewport is only 44.8 km tall, so
   * the strip both overflowed the top of frame and had no margin left to overflow into.
   * At 9.7 the viewport is 72.8 km tall and the strip fills 54% of it, and the centre is
   * pushed east of the strip so it sits at 40% of frame width: clear of the counter and
   * caption in the bottom-left corner, with the body of the park filling the right.
   */
  idahoSliver: { center: [-110.9100, 44.3096] as [number, number], zoom: 9.7, pitch: 0, bearing: 0 },
  arizona:   { center: [-110.4000, 36.0000] as [number, number], zoom: 6.8,  pitch: 0, bearing: 0 },
  /*
   * The AZ-264 corridor, framed from the road's own extent: it runs -111.229 to -109.046,
   * 2.18° of longitude, and at this zoom a 1920-wide frame holds 2.83° — the whole drive
   * from the US-160 junction to Window Rock, with margin at both ends so the dot is never
   * born or buried on the frame edge.
   */
  az264:     { center: [-110.1380, 35.8900] as [number, number], zoom: 8.9,  pitch: 0, bearing: 0 },
} satisfies Record<string, Camera>;

export type CameraName = keyof typeof CAMERAS;

/** Fill opacity for a boundary at rest, and the weight of its outline. */
export const PAINT = {
  fillOpacity: 0.22,
  lineWidth: 1.8,
  lineOpacity: 1,
  dimFillOpacity: 0.06,
  dimLineOpacity: 0.3,
} as const;

/**
 * A layer that is only there for context — the state outlines behind a Yellowstone or
 * Oklahoma shot. Without dimming the OUTLINE too, the backdrop's own edges compete with
 * the boundary the scene is actually about.
 */
export const BACKDROP = { fillOpacity: 0.03, lineOpacity: 0.2, lineWidth: 1 } as const;

/** Beat timings, in ms. One place, so the whole deck retimes together. */
export const TIMING = {
  fill: 420,
  outline: 620,
  counterRoll: 460,
  penFlash: 300,
  beatHold: 120,
  /**
   * How long a departing layer takes to dissolve. It overlaps the incoming layer's fade,
   * so the two cross rather than one cutting to the other.
   */
  crossfade: 560,
  /**
   * How long a caption holds before the next one replaces it.
   *
   * A caption is a line of narration, and the deck used to swap several of them inside a
   * second while the map was still moving — legible on paper, unreadable on screen. Every
   * caption in a choreography now gets this beat to itself.
   */
  caption: 1900,
} as const;
