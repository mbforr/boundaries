/**
 * The six pens. One palette, used for fills, outlines, the counter tick and the swatch.
 *
 * Okabe-Ito derived: distinguishable under deuteranopia and protanopia, and all six sit
 * above 4.5:1 contrast on the dark-v11 ground (#0b0d10-ish). Blues are separated by
 * luminance rather than hue so statisticians and surveyors never read as the same pen.
 *
 * The blurbs follow ../boundaries/scripts/layers_md.py PEN_BLURB so the video and the data
 * repo say the same thing about each pen, with the em dashes rewritten as full stops for
 * on-screen legibility.
 */
export type Pen =
  | 'congress'
  | 'statisticians'
  | 'politicians'
  | 'courts'
  | 'markets'
  | 'surveyors';

export interface PenDef {
  color: string;
  label: string;
  blurb: string;
}

export const PENS: Record<Pen, PenDef> = {
  congress: {
    color: '#F0E442',
    label: 'Congress',
    blurb: 'Drawn by Congress and federal agencies. The national frame.',
  },
  politicians: {
    color: '#E69F00',
    label: 'The politicians',
    blurb: 'Drawn by elected bodies to elect more of themselves, or to deliver services.',
  },
  statisticians: {
    color: '#56B4E9',
    label: 'The statisticians',
    blurb:
      'Drawn to count people. No one is governed by these, and everyone is measured by them.',
  },
  courts: {
    color: '#CC79A7',
    label: 'The courts',
    blurb: 'Drawn by statute to decide which judge hears your case.',
  },
  markets: {
    color: '#009E73',
    label: 'The markets',
    blurb: 'Drawn by industry and regulators around infrastructure, not people.',
  },
  surveyors: {
    // Violet, not a second blue. The reveal's legend is the one place all six pens appear
    // together, and #3B9FE0 was indistinguishable from the statisticians' #56B4E9 there.
    color: '#A78BFA',
    label: 'The surveyors',
    blurb: 'Drawn by water, soil and weather. The boundaries nature argued for first.',
  },
};

/** Pen order for the reveal stack and the legend. Matches layers_md.py PEN_ORDER. */
export const PEN_ORDER: Pen[] = [
  'congress',
  'politicians',
  'statisticians',
  'courts',
  'markets',
  'surveyors',
];
