import { PENS, type Pen } from '../pens';
import { TIMING } from '../config';
import type { CardSpec } from '../engine/types';

/**
 * Three elements and nothing else: the counter, the pen swatch, the caption.
 * Plus the card, which replaces the map's foreground for beats that have no polygon.
 *
 * H hides the whole HUD for clean b-roll passes. I toggles the scene index.
 */
export class Hud {
  private counterEl: HTMLElement;
  private penEl: HTMLElement;
  private penDot: HTMLElement;
  private penName: HTMLElement;
  private captionEl: HTMLElement;
  private cardEl: HTMLElement;
  private indexEl: HTMLElement;
  private busyEl: HTMLElement;
  private rollToken = 0;
  private shown = 0;

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <div class="hud-card" id="hud-card" hidden>
        <div class="hud-card-title"></div>
        <div class="hud-card-sub"></div>
      </div>
      <div class="hud-caption" id="hud-caption"></div>
      <div class="hud-corner">
        <div class="hud-counter" id="hud-counter">0</div>
        <div class="hud-pen" id="hud-pen"><i></i><span></span></div>
      </div>
      <div class="hud-index" id="hud-index" hidden></div>
      <div class="hud-busy" id="hud-busy" hidden></div>`;
    this.counterEl = root.querySelector('#hud-counter')!;
    this.penEl = root.querySelector('#hud-pen')!;
    this.penDot = this.penEl.querySelector('i')!;
    this.penName = this.penEl.querySelector('span')!;
    this.captionEl = root.querySelector('#hud-caption')!;
    this.cardEl = root.querySelector('#hud-card')!;
    this.indexEl = root.querySelector('#hud-index')!;
    this.busyEl = root.querySelector('#hud-busy')!;
  }

  /** Instant, no animation — used by applyEndState. */
  setCounter(value: number | 'blur' | null): void {
    this.rollToken++; // cancel any roll in flight
    if (value === null) { this.counterEl.hidden = true; return; }
    this.counterEl.hidden = false;
    if (value === 'blur') {
      this.counterEl.classList.add('is-blur');
      this.counterEl.textContent = '000';
      return;
    }
    this.counterEl.classList.remove('is-blur');
    this.shown = value;
    this.counterEl.textContent = String(value);
  }

  /** Animated number-roll, used by the snap beat. */
  rollCounter(to: number, ms = TIMING.counterRoll): Promise<void> {
    const mine = ++this.rollToken;
    this.counterEl.hidden = false;
    this.counterEl.classList.remove('is-blur');
    const from = this.shown;
    if (from === to) { this.counterEl.textContent = String(to); return Promise.resolve(); }
    const start = performance.now();
    this.counterEl.classList.add('is-ticking');
    return new Promise((resolve) => {
      const step = () => {
        if (mine !== this.rollToken) { resolve(); return; } // superseded
        const t = Math.min(1, (performance.now() - start) / ms);
        // easeOutCubic — fast off the mark, settles onto the number.
        const eased = 1 - Math.pow(1 - t, 3);
        this.counterEl.textContent = String(Math.round(from + (to - from) * eased));
        if (t < 1) { requestAnimationFrame(step); return; }
        this.shown = to;
        this.counterEl.textContent = String(to);
        this.counterEl.classList.remove('is-ticking');
        resolve();
      };
      requestAnimationFrame(step);
    });
  }

  setPen(pen: Pen | null): void {
    if (!pen) {
      this.penEl.hidden = true;
      // Reset the counter's colour too. Leaving the last pen's colour on it made a
      // penless scene look different depending on which scene you arrived from —
      // caught by scripts/smoke.py --determinism on the reveal.
      this.counterEl.style.color = '';
      return;
    }
    this.penEl.hidden = false;
    const def = PENS[pen];
    this.penDot.style.background = def.color;
    this.penName.textContent = def.label;
    this.counterEl.style.color = def.color;
  }

  flashPen(): void {
    this.penEl.classList.remove('is-flash');
    void this.penEl.offsetWidth; // restart the animation
    this.penEl.classList.add('is-flash');
  }

  setCaption(text: string | null): void {
    this.captionEl.textContent = text ?? '';
    this.captionEl.hidden = !text;
  }

  setCard(card: CardSpec | undefined): void {
    if (!card) { this.cardEl.hidden = true; return; }
    this.cardEl.hidden = false;
    (this.cardEl.querySelector('.hud-card-title') as HTMLElement).textContent = card.title;
    const sub = this.cardEl.querySelector('.hud-card-sub') as HTMLElement;
    sub.textContent = card.sub ?? '';
    sub.hidden = !card.sub;
  }

  setIndex(text: string): void { this.indexEl.textContent = text; }
  toggleIndex(): void { this.indexEl.hidden = !this.indexEl.hidden; }
  toggleVisible(): void { this.root.classList.toggle('is-hidden'); }
  setBusy(busy: boolean): void { this.busyEl.hidden = !busy; }
}
