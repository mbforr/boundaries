import type { Map as MapboxMap } from 'mapbox-gl';
import { PAINT, TIMING } from '../config';
import type { LayerId } from '../layers.generated';
import type { Scene, Step } from './types';
import type { LayerManager } from './layerManager';
import type { Hud } from '../hud';
import type { Overlays } from '../overlays';
import type { Drive } from './drive';
import { setLabels } from './state';
import { sleep, type Token } from './timeline';

export interface StepCtx {
  map: MapboxMap;
  layers: LayerManager;
  hud: Hud;
  overlays: Overlays;
  drive: Drive;
}

/** Run a scene's choreography. Throws INTERRUPTED if a keypress lands mid-flight. */
export async function runSteps(
  ctx: StepCtx, scene: Scene, steps: Step[], token: Token,
): Promise<void> {
  /*
   * The card belongs to the scene that declares it, so a scene that declares none starts
   * by clearing it. Without this the card is only taken down by the applyEndState at the
   * END of the transition, which meant a card beat followed by a choreography — beat 36,
   * the Alaska Native regional corporations, straight into the McGirt sequence — left the
   * card pasted over the whole sequence and only cleared it once the flying stopped.
   *
   * It is done here, before the layer warm-up await, so the card goes at the keypress
   * rather than after the incoming scene's first fetch lands. The beat scenes clear the
   * caption the same way, as an explicit step; the card cannot be left to each author to
   * remember, because forgetting it looks like a hang rather than a missing line.
   */
  if (!scene.card) ctx.hud.setCard(undefined);
  // The overlays are the same story: the scenes that own one clear it themselves as their
  // first step, but a scene that owns none inherited whatever was on screen — the GEOID
  // readout from the census nesting sequence stayed up over beat 9.
  if (!scene.overlay) ctx.overlays.apply(undefined);

  // Warm everything the choreography touches before the first frame, so a layer never
  // pops in mid-flight because its fetch happened to land late.
  const touched = steps.flatMap((s) => ('layer' in s ? [s.layer as LayerId] : []));
  await Promise.all([...new Set(touched)].map((id) => ctx.layers.ensure(id)));
  token.check();

  for (const step of steps) {
    token.check();
    await runStep(ctx, step, token);
  }
}

async function runStep(ctx: StepCtx, step: Step, token: Token): Promise<void> {
  const { map, layers, hud, overlays, drive } = ctx;
  switch (step.t) {
    case 'fly': {
      /*
       * speed and curve are only included when actually set.
       *
       * Passing `curve: undefined` does not fall back to mapbox's default — the option
       * object is merged over the defaults, so an explicit undefined overwrites 1.42.
       * The flight math then produces NaN, the map's zoom goes NaN, every zoom-driven
       * style expression fails, and the end-state jumpTo teleports the camera. That was
       * the "map suddenly shifts" bug, and it hit every fly that did not set a curve.
       */
      const opts: Record<string, unknown> = {
        center: step.camera.center,
        zoom: step.camera.zoom,
        pitch: step.camera.pitch ?? 0,
        bearing: step.camera.bearing ?? 0,
        duration: step.ms,
        essential: true, // ignore prefers-reduced-motion: this is a recording
      };
      if (step.speed !== undefined) opts.speed = step.speed;
      if (step.curve !== undefined) opts.curve = step.curve;
      map.flyTo(opts as never);
      await once(map, 'moveend', step.ms + 600, token);
      return;
    }
    case 'jump': {
      map.jumpTo({
        center: step.camera.center, zoom: step.camera.zoom,
        pitch: step.camera.pitch ?? 0, bearing: step.camera.bearing ?? 0,
      });
      return;
    }
    case 'snap': {
      // The core beat: fill in, outline draws, counter rolls, pen flashes — together.
      await layers.ensure(step.layer);
      token.check();
      layers.instant(step.layer);
      layers.show(step.layer, {
        fillOpacity: 0, lineOpacity: 0,
        lineWidth: PAINT.lineWidth, filter: step.filter as unknown[] | undefined,
      });
      hud.flashPen();
      const roll = step.tickTo !== undefined ? hud.rollCounter(step.tickTo) : Promise.resolve();
      await Promise.all([
        layers.transition(layers.fillId(step.layer), 'fill-opacity', PAINT.fillOpacity, TIMING.fill),
        layers.transition(layers.lineId(step.layer), 'line-opacity', PAINT.lineOpacity, TIMING.outline),
        roll,
      ]);
      return;
    }
    case 'fade': {
      await layers.ensure(step.layer);
      token.check();
      layers.instant(step.layer);
      layers.show(step.layer, {
        fillOpacity: 0, lineOpacity: 0,
        lineWidth: PAINT.lineWidth, filter: step.filter as unknown[] | undefined,
      });
      const to = step.to ?? PAINT.fillOpacity;
      await Promise.all([
        layers.transition(layers.fillId(step.layer), 'fill-opacity', to, step.ms),
        layers.transition(layers.lineId(step.layer), 'line-opacity', PAINT.lineOpacity, step.ms),
      ]);
      return;
    }
    case 'pulse': {
      // Restore whatever was there, which may be a match expression over a feature
      // property rather than a number — flattening it to a scalar would repaint every
      // other feature in the layer.
      const fill = layers.fillId(step.layer);
      const before = map.getPaintProperty(fill, 'fill-opacity') ?? PAINT.fillOpacity;
      const times = step.times ?? 2;
      for (let i = 0; i < times; i++) {
        token.check();
        await layers.transition(fill, 'fill-opacity', 0.5, 220);
        token.check();
        await layers.transition(fill, 'fill-opacity', before as number | unknown[], 220);
      }
      return;
    }
    case 'strike': {
      // The Osage beat: dim the layer to a ghost. The X-out itself is an overlay.
      await Promise.all([
        layers.transition(layers.fillId(step.layer), 'fill-opacity', PAINT.dimFillOpacity, 300),
        layers.transition(layers.lineId(step.layer), 'line-opacity', PAINT.dimLineOpacity, 300),
      ]);
      return;
    }
    case 'paint': {
      // Retarget an already-visible layer's paint, optionally widening its filter first
      // so newly-matched features fade in rather than pop.
      await layers.ensure(step.layer);
      token.check();
      const ms = step.ms ?? 320;
      if (step.filter !== undefined) {
        for (const l of [layers.fillId(step.layer), layers.lineId(step.layer)]) {
          if (map.getLayer(l)) map.setFilter(l, step.filter as never);
        }
      }
      await Promise.all([
        step.fillOpacity !== undefined
          ? layers.transition(layers.fillId(step.layer), 'fill-opacity', step.fillOpacity, ms)
          : Promise.resolve(),
        step.lineOpacity !== undefined
          ? layers.transition(layers.lineId(step.layer), 'line-opacity', step.lineOpacity, ms)
          : Promise.resolve(),
      ]);
      return;
    }
    case 'hide': {
      // Dissolve rather than cut. applyEndState still hides it outright at the end, but
      // by then it is already transparent.
      await Promise.all([
        layers.transition(layers.fillId(step.layer), 'fill-opacity', 0, TIMING.crossfade),
        layers.transition(layers.lineId(step.layer), 'line-opacity', 0, TIMING.crossfade),
      ]);
      layers.hide(step.layer);
      return;
    }
    case 'caption': hud.setCaption(step.text); return;
    case 'counter': hud.setCounter(step.to); return;
    case 'pen':     hud.setPen(step.pen); return;
    case 'card':
      hud.setCard(step.title === null ? undefined : { title: step.title, sub: step.sub });
      return;
    case 'overlay': overlays.apply({ name: step.name, state: step.state }); return;
    case 'labels':  setLabels(map, step.groups); return;
    case 'wait':    await sleep(step.ms); return;
    case 'drive': {
      /*
       * The clock is driven by where the dot IS, not by a schedule beside it.
       *
       * Each frame asks the road which zone run the dot has reached, and the overlay is
       * rewritten only when that answer changes. The crossings were computed against the
       * same time zone file the scene is drawing, so the clock cannot flip a mile early:
       * if the polygon moves, the flip moves with it.
       */
      await drive.ensure();
      token.check();
      await drive.fade(1, 260);
      token.check();
      /*
       * The dot pauses at each crossing, and the pause is the point.
       *
       * At a constant speed the drive is honest and illegible: the first two runs are
       * 15.8 km and 12.6 km of a 265 km road, so three of the five clock changes land
       * inside 1.3 seconds and flick past before they can be read, then nothing happens
       * for five seconds. Holding the dot on the boundary for a beat gives every crossing
       * the same weight, exactly as every caption now gets its own beat.
       *
       * What is stylised here is the clock, never the map: the dot pauses ON the real
       * crossing point, and the distance between crossings is still travelled in
       * proportion to its length. The deck already compresses a four-hour drive into
       * twelve seconds; it does not move the boundary.
       */
      const dwell = step.dwell ?? 800;
      const marks = [0, ...drive.runs().slice(1).map((r) => r.t0), 1];
      const moveMs = Math.max(1, step.ms - (marks.length - 1) * dwell);
      const legs = marks.slice(0, -1).map((t0, i) => ({
        t0, t1: marks[i + 1]!, ms: moveMs * (marks[i + 1]! - t0),
      }));

      /** Fraction along the road at `ms` into the drive, pauses included. */
      const positionAt = (ms: number): number => {
        // A pause at the start as well, so the zone the drive BEGINS in gets the same beat
        // as the ones it crosses into. Without it the first run — 15.8 km, the Hopi village
        // of Moenkopi — announced itself and was gone half a second later.
        let left = ms - dwell;
        if (left < 0) return 0;
        for (let i = 0; i < legs.length; i++) {
          const leg = legs[i]!;
          if (left < leg.ms) return leg.t0 + (leg.t1 - leg.t0) * (left / leg.ms);
          left -= leg.ms;
          if (i < legs.length - 1) {
            if (left < dwell) return leg.t1;
            left -= dwell;
          }
        }
        return 1;
      };
      const totalMs = moveMs + (marks.length - 1) * dwell;

      const start = performance.now();
      let shown: number | null = null;
      await new Promise<void>((resolve) => {
        const frame = () => {
          if (token.stale()) { resolve(); return; }
          const elapsed = Math.max(0, performance.now() - start);
          const t = Math.min(1, positionAt(elapsed));
          const done = elapsed >= totalMs;
          const run = drive.at(t);
          if (run && run.seq !== shown) {
            shown = run.seq;
            overlays.apply({ name: 'clock',
                             state: [run.time, run.land, run.clock].filter(Boolean).join(' · ') });
          }
          if (!done) { requestAnimationFrame(frame); return; }
          resolve();
        };
        requestAnimationFrame(frame);
      });
      token.check();
      return;
    }
    case 'driveOff': await drive.fade(0, step.ms ?? 420); return;
    case 'idle':    await once(map, 'idle', 4000, token); return;
  }
}

/** Await a map event, with a ceiling so a dropped event can never wedge the deck. */
function once(
  map: MapboxMap, event: 'moveend' | 'idle', timeoutMs: number, token: Token,
): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      map.off(event, finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    map.once(event, finish);
    // If we were interrupted while waiting, stop waiting — the caller will bail.
    const poll = setInterval(() => {
      if (token.stale()) { clearInterval(poll); finish(); }
      if (done) clearInterval(poll);
    }, 60);
  });
}
