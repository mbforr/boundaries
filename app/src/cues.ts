/**
 * A cue track for the edit.
 *
 * Every counter tick and every scene change is stamped with the milliseconds since the
 * recording started, so the audio pass can be cut against what actually happened on
 * screen rather than by eye. Press C during a take to dump the track as CSV.
 *
 * Each cue is also dispatched as a `bs:cue` CustomEvent, so anything else that wants to
 * react to a beat — a sound bed, an OBS scene switch — can listen without touching the
 * engine.
 */
export interface Cue {
  ms: number;
  type: 'tick' | 'scene';
  scene: string;
  beat: number | null;
  pen: string | null;
  caption: string | null;
}

export class Cues {
  private log: Cue[] = [];
  private origin = performance.now();

  /** Restart the clock, so a cue track lines up with one take rather than the session. */
  reset(): void {
    this.origin = performance.now();
    this.log = [];
  }

  record(cue: Omit<Cue, 'ms'>): void {
    const full: Cue = { ...cue, ms: Math.round(performance.now() - this.origin) };
    this.log.push(full);
    window.dispatchEvent(new CustomEvent('bs:cue', { detail: full }));
  }

  toCsv(): string {
    const rows = this.log.map((c) =>
      [c.ms, c.type, c.scene, c.beat ?? '', c.pen ?? '',
       JSON.stringify(c.caption ?? '')].join(','));
    return ['ms,type,scene,beat,pen,caption', ...rows].join('\n');
  }

  /** Dump to the console and, where the browser allows it, the clipboard. */
  async dump(): Promise<void> {
    const csv = this.toCsv();
    console.info(`%c${this.log.length} cues`, 'font-weight:bold');
    console.info(csv);
    try {
      await navigator.clipboard.writeText(csv);
      console.info('cue track copied to the clipboard');
    } catch {
      console.info('clipboard unavailable, copy the CSV above');
    }
  }

  get length(): number { return this.log.length; }
}
