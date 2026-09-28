import { PENS, type Pen } from '../pens';
import type { LayerDef } from '../layers.generated';

/**
 * The read-out shared by both gallery pages: which layer this is, whose pen drew it,
 * where it came from, and how far through the run we are.
 *
 * Same corner, same type scale and same pen swatch as the deck's HUD, so a frame grabbed
 * from here sits beside a frame from the deck without looking like another app. `H` hides
 * the whole thing, as in the deck, for a clean capture.
 */
export class Chrome {
  private root: HTMLElement;
  private titleEl: HTMLElement;
  private subEl: HTMLElement;
  private indexEl: HTMLElement;
  private penDot: HTMLElement;
  private penName: HTMLElement;
  private statusEl: HTMLElement;
  private barEl: HTMLElement;

  constructor(parent: HTMLElement, helpText: string) {
    this.root = document.createElement('div');
    this.root.className = 'gl-chrome';
    this.root.innerHTML = `
      <div class="gl-progress"><i></i></div>
      <div class="gl-status"></div>
      <div class="gl-block">
        <div class="gl-title"></div>
        <div class="gl-sub"></div>
        <div class="gl-corner">
          <div class="gl-index">00</div>
          <div class="gl-pen"><i></i><span></span></div>
        </div>
      </div>
      <div class="gl-help">${helpText}</div>`;
    parent.appendChild(this.root);
    this.titleEl = this.root.querySelector('.gl-title')!;
    this.subEl = this.root.querySelector('.gl-sub')!;
    this.indexEl = this.root.querySelector('.gl-index')!;
    this.penDot = this.root.querySelector('.gl-pen i')!;
    this.penName = this.root.querySelector('.gl-pen span')!;
    this.statusEl = this.root.querySelector('.gl-status')!;
    this.barEl = this.root.querySelector('.gl-progress i')!;
  }

  /**
   * Name, provenance line and pen, straight from the generated registry.
   *
   * `key` is the registry key, not `def.id`: the registry strips the scope suffix from the
   * id field, so the national counties layer and the NYC-extent one both call themselves
   * `census_county` and only the key tells them apart. The key is also what ?layer= takes.
   */
  setLayer(key: string, def: LayerDef, note?: string): void {
    this.titleEl.textContent = def.name;
    this.subEl.textContent = [
      key,
      def.authority ?? 'derived',
      def.vintage,
      `${def.features.toLocaleString()} features`,
      note,
    ].filter(Boolean).join('  ·  ');
    this.setPen(def.pen);
  }

  /** Re-state the provenance line without re-reading the registry. */
  appendNote(note: string): void {
    this.subEl.textContent = `${this.subEl.textContent}  ·  ${note}`;
  }

  setPen(pen: Pen | null): void {
    // A null pen means the file carries its own per-feature pens — the reveal stack is the
    // only one — so the swatch says so rather than picking a colour that would be a lie.
    const def = pen ? PENS[pen] : null;
    this.penDot.style.background = def ? def.color : 'transparent';
    this.penDot.style.boxShadow = def ? 'none' : 'inset 0 0 0 1.5px #7b8794';
    this.penName.textContent = def ? def.label : 'Mixed pens';
  }

  setIndex(text: string): void { this.indexEl.textContent = text; }
  setStatus(text: string): void { this.statusEl.textContent = text; }
  setProgress(fraction: number): void {
    this.barEl.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  }

  toggle(): void { this.root.classList.toggle('is-hidden'); }
}
