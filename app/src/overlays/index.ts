import type { OverlayName } from '../engine/types';
import { PENS, PEN_ORDER, type Pen } from '../pens';

/**
 * DOM overlays that sit above the map: the GEOID digits falling off in the census nesting
 * scene, the clock in the Arizona scene, the pen legend in the reveal.
 *
 * Scenes name an overlay and hand it a state object; the overlay renders that state and
 * nothing else, so it obeys the same determinism rule as the map layers.
 */
export class Overlays {
  private el: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'overlays';
    root.appendChild(this.el);
  }

  apply(spec: { name: OverlayName; state: unknown } | undefined): void {
    if (!spec || spec.name === 'none') { this.el.innerHTML = ''; this.el.hidden = true; return; }
    this.el.hidden = false;
    switch (spec.name) {
      case 'geoid':     this.renderGeoid(spec.state as string); break;
      case 'clock':     this.renderClock(spec.state as string); break;
      case 'penLegend': this.renderLegend(spec.state as Record<string, number>); break;
      case 'locked':    this.renderLocked(spec.state as string); break;
    }
  }

  /** GEOID 360610076001001 with the digits that have fallen off greyed, not removed. */
  private renderGeoid(visible: string): void {
    const full = '360610076001001';
    const kept = full.slice(0, visible.length);
    const lost = full.slice(visible.length);
    this.el.innerHTML =
      `<div class="ov-geoid"><b>${kept}</b><s>${lost}</s></div>`;
  }

  /** The absence, stated plainly. Used for the layers nobody is allowed to publish. */
  private renderLocked(label: string): void {
    this.el.innerHTML =
      `<div class="ov-locked"><svg viewBox="0 0 24 24" aria-hidden="true">` +
      `<rect x="4" y="10.5" width="16" height="11" rx="2"/>` +
      `<path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg><span>${label}</span></div>`;
  }

  private renderClock(time: string): void {
    this.el.innerHTML = `<div class="ov-clock">${time}</div>`;
  }

  /** Pen order, not object order, so the legend matches the order the stack drew in. */
  private renderLegend(counts: Record<string, number>): void {
    const rows = PEN_ORDER.filter((p) => counts[p])
      .map((pen: Pen) =>
        `<li><i style="background:${PENS[pen].color}"></i>` +
        `${PENS[pen].label}<b>${counts[pen]}</b></li>`)
      .join('');
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    this.el.innerHTML =
      `<ul class="ov-legend">${rows}<li class="is-total"><i></i>files<b>${total}</b></li></ul>`;
  }
}
