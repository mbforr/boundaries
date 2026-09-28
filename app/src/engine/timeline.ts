/**
 * Interrupt control for choreographies.
 *
 * Every choreography run takes a token. Pressing a key bumps the generation, which makes
 * every outstanding token stale; each step checks its token before and after doing work
 * and bails the moment it goes stale. That is what guarantees the invariant: a scene is
 * either mid-choreography or at its exact end state, never anywhere in between.
 */
export class Timeline {
  private generation = 0;

  /** Invalidate every running choreography. */
  interrupt(): void {
    this.generation++;
  }

  token(): Token {
    this.generation++;
    const mine = this.generation;
    return {
      stale: () => this.generation !== mine,
      check: () => {
        if (this.generation !== mine) throw INTERRUPTED;
      },
    };
  }
}

export interface Token {
  stale(): boolean;
  check(): void;
}

export const INTERRUPTED = Symbol('choreography interrupted');

export function isInterrupt(e: unknown): boolean {
  return e === INTERRUPTED;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
