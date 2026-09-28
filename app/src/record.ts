import type { Map as MapboxMap } from 'mapbox-gl';

export interface RecordOpts {
  enabled: boolean;
  width: number;
  height: number;
  /** Scale the stage down to fit the window. Preview only — see applyRecordMode. */
  fit: boolean;
}

export function readRecordOpts(params: URLSearchParams): RecordOpts {
  const enabled = params.get('record') === '1';
  const fourK = params.get('res') === '4k';
  return {
    enabled,
    width: fourK ? 3840 : 1920,
    height: fourK ? 2160 : 1080,
    fit: params.get('fit') === '1',
  };
}

/**
 * Recording mode: a fixed stage, no cursor, no interaction, no Mapbox chrome.
 *
 * The stage is a real 1920x1080 (or 3840x2160) box that is CSS-scaled to fit the window,
 * so the map renders at exactly the recording resolution regardless of the display, and
 * a screen recorder cropped to the stage gets pixel-exact frames.
 *
 * Mapbox attribution is suppressed here and owed in the video description instead, along
 * with ODbL credit to timezone-boundary-builder for the time zone layer.
 */
export function applyRecordMode(stage: HTMLElement, map: MapboxMap, opts: RecordOpts): void {
  if (!opts.enabled) return;
  document.body.classList.add('is-recording');
  stage.style.width = `${opts.width}px`;
  stage.style.height = `${opts.height}px`;

  /*
   * No CSS transform by default, and that is deliberate.
   *
   * Any scale on the stage or an ancestor makes mapbox's canvas sizing fractional — it
   * produced a 1921x1081 backing store inside a 1920x1080 box, so the browser resampled
   * every frame and softened every line in a film made of thin lines. Left untransformed,
   * the canvas is exactly the recording resolution.
   *
   * The cost is that the stage overflows a window smaller than the target, which is the
   * honest situation: you cannot screen-record 1920x1080 on a display that cannot show
   * it. `&fit=1` scales it down to look at, and says so — do not record that.
   */
  if (opts.fit) {
    const shell = document.createElement('div');
    shell.id = 'record-shell';
    stage.parentNode!.insertBefore(shell, stage);
    shell.appendChild(stage);
    const apply = () => {
      const scale = Math.min(window.innerWidth / opts.width, window.innerHeight / opts.height, 1);
      shell.style.width = `${opts.width}px`;
      shell.style.height = `${opts.height}px`;
      shell.style.transform = `scale(${scale})`;
    };
    apply();
    window.addEventListener('resize', apply);
    console.warn(
      'record mode: fit=1 scales the stage to the window, which makes the map canvas ' +
      'fractional. Preview only, record without fit=1.');
  }

  map.scrollZoom.disable();
  map.dragPan.disable();
  map.dragRotate.disable();
  map.doubleClickZoom.disable();
  map.touchZoomRotate.disable();
  map.keyboard.disable(); // already off globally; kept so record mode is self-contained
  map.boxZoom.disable();

  for (const sel of ['.mapboxgl-ctrl-logo', '.mapboxgl-ctrl-attrib', '.mapboxgl-ctrl-bottom-right',
                     '.mapboxgl-ctrl-bottom-left']) {
    stage.querySelectorAll(sel).forEach((el) => el.remove());
  }

  map.resize();
}
