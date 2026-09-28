import type { Pen } from '../pens';
import type { LayerId } from '../layers.generated';

export interface Camera {
  center: [number, number];
  zoom: number;
  pitch?: number;
  bearing?: number;
}

/** A mapbox filter expression, applied to both the fill and the outline. */
export type FilterSpec = unknown[];

/**
 * Paint values may be a constant or a mapbox expression. Expressions are how one layer
 * shows two states at once — the Osage beat needs the affirmed reservations at full
 * strength and the disestablished one dimmed, from a single source.
 */
export type PaintValue = number | unknown[];

export interface PaintOverride {
  fillOpacity?: PaintValue;
  lineOpacity?: PaintValue;
  lineWidth?: PaintValue;
  color?: string | unknown[];
  /** Name of a registered map image to use as the fill pattern (see engine/hatch.ts). */
  pattern?: string;
}

/** One layer, visible in a scene's end state. */
export interface LayerView {
  id: LayerId;
  paint?: PaintOverride;
  filter?: FilterSpec;
}

export type Chapter =
  | 'cold-open' | 'why' | 'no-map-dept' | 'six-pens' | 'tier-1' | 'count-you'
  | 'political' | 'legal' | 'rung-5' | 'swarm' | 'reveal' | 'human-turn' | 'close';

export type LabelGroup = 'country' | 'state' | 'place' | 'neighbourhood';

export type OverlayName = 'geoid' | 'clock' | 'penLegend' | 'locked' | 'none';

export interface CardSpec {
  title: string;
  sub?: string;
}

/**
 * A scene's END STATE — complete and declarative.
 *
 * Everything needed to render the scene is here. Nothing is inherited from the previous
 * scene, so applying scene N is a pure function of N: left-arrow, right-arrow and a cold
 * page load at ?scene=<id> all produce the identical frame.
 */
export interface Scene {
  id: string;
  beat?: number;
  chapter: Chapter;
  camera: Camera;
  labels: LabelGroup[];
  layers: LayerView[];
  counter: number | 'blur' | null;
  pen: Pen | null;
  caption: string | null;
  card?: CardSpec;
  overlay?: { name: OverlayName; state: unknown };
  /** Optional choreography played when arriving from the previous scene. */
  enter?: Step[];
}

/**
 * A choreography step. Steps run in order and are interruptible: pressing right during a
 * choreography abandons the remaining steps and snaps to the scene's end state, so a
 * half-finished animation can never survive a keypress.
 */
export type Step =
  | { t: 'fly'; camera: Camera; ms: number; speed?: number; curve?: number }
  | { t: 'jump'; camera: Camera }
  | { t: 'snap'; layer: LayerId; tickTo?: number; filter?: FilterSpec }
  | { t: 'fade'; layer: LayerId; ms: number; to?: number; filter?: FilterSpec }
  | { t: 'pulse'; layer: LayerId; times?: number }
  | { t: 'strike'; layer: LayerId }
  | {
      t: 'paint'; layer: LayerId; ms?: number;
      fillOpacity?: PaintValue; lineOpacity?: PaintValue; filter?: FilterSpec;
    }
  | { t: 'hide'; layer: LayerId }
  | { t: 'caption'; text: string | null }
  | { t: 'counter'; to: number | 'blur' | null }
  | { t: 'pen'; pen: Pen | null }
  | { t: 'card'; title: string | null; sub?: string }
  | { t: 'overlay'; name: OverlayName; state: unknown }
  | { t: 'labels'; groups: LabelGroup[] }
  | { t: 'wait'; ms: number }
  /**
   * Drive a dot east along the AZ-264 corridor, flipping the clock overlay as it crosses
   * a time zone. `driveOff` fades the road away again. See engine/drive.ts — the road is
   * real geometry, and the crossings come from the time zone polygons rather than a list.
   */
  | { t: 'drive'; ms: number; dwell?: number }
  | { t: 'driveOff'; ms?: number }
  | { t: 'idle' };
