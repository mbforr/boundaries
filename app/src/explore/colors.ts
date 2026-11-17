import { PENS, type Pen } from '../pens';

export type Theme = 'light' | 'dark';

/**
 * Pen colours for lines drawn on the light map.
 *
 * The video's six colours were picked for a dark ground. On pale land, Congress yellow
 * and statistician blue nearly vanish, so each pen gets a light-ground variant here:
 * the same hue, darkened until a 1.5px stroke reaches 3:1 against the land colour.
 * Derived by `python3 scripts/check_contrast.py --derive`, checked by running it bare.
 * The dark theme uses the video colours unchanged, so a frame matches the counter.
 */
export const LIGHT_INK: Record<Pen, string> = {
  congress: '#90870B',
  politicians: '#B07A00',
  statisticians: '#1B8DCE',
  courts: '#C4659A',
  markets: '#00966D',
  surveyors: '#8F6BF9',
};

/** The colour a pen's lines draw in on the current map. */
export function ink(pen: Pen, theme: Theme): string {
  return theme === 'light' ? LIGHT_INK[pen] : PENS[pen].color;
}
