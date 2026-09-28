import '../film.css';
import { setFilmStyle, filmStyleFor } from '../filmstyle';

/**
 * The two composite plates — /matte.html and /key.html.
 *
 * Neither is a new animation. Both run one of the gallery's existing pieces with the map
 * restyled and every readout taken off, because what these produce is footage for an edit
 * rather than something to read on screen:
 *
 *   /matte.html?show=flash   grey land, white names, the boundary strobe
 *   /key.html?show=draw      green non-land, the drawing pen
 *   /key.html?show=deck      green non-land, the whole deck, stepped by hand
 *
 * `?show=` picks the piece (flash by default) and every option that piece already
 * understands still applies — ?at=, ?ms=, ?layer=, ?order=, ?scene=, ?record=1 and the
 * rest. On the deck the arrow keys step scenes exactly as they do at /index.html; what
 * comes off is the counter, the caption, the pen swatch, the cards and the overlays.
 *
 * The style is set BEFORE the animation module is imported, because those modules boot
 * their own map on import and `ready` applies whatever style is configured by then.
 */
export async function runFilm(kind: 'matte' | 'key'): Promise<void> {
  const params = new URLSearchParams(location.search);
  setFilmStyle(filmStyleFor(kind, params));

  // Counts, titles, provenance, the layer picker: none of it belongs on a plate. Done in
  // CSS so it covers whatever chrome the imported piece builds, present and future.
  document.body.classList.add('is-film');

  const show = params.get('show') ?? 'flash';
  if (show === 'draw') {
    await import('./draw');
  } else if (show === 'deck') {
    // The deck boots its own map and applies the style from its own load handler, so
    // nothing here waits on it. It needs a #hud element to mount into; the plate pages
    // carry one for exactly this reason, hidden like the rest of the chrome.
    await import('../main');
  } else {
    if (show !== 'flash') {
      console.warn(`film: unknown ?show=${show}; running the flash montage`);
    }
    await import('./flash');
  }
}
