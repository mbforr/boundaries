import type { Map as MapboxMap } from 'mapbox-gl';

/**
 * The Mapbox token, and what to say when it does not work.
 *
 * Two different failures look identical from the outside — a page that does not draw a map
 * — and they have opposite fixes, so the point of this file is to tell them apart on
 * screen rather than in a console nobody has open.
 *
 * MISSING. `VITE_MAPBOX_TOKEN` is read at BUILD time: Vite inlines it into the bundle, so
 * the value that matters is the one present when `vite build` ran. Setting it in a
 * dashboard after a deploy changes nothing until the next build — which is the single most
 * common way this goes wrong, and why the message says so.
 *
 * REJECTED. The token is in the bundle and Mapbox refuses it: 401 or 403 on every tile.
 * Almost always a URL restriction that does not list the domain being served from. Before
 * this, that case drew a blank stage and said nothing at all.
 */
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

function panel(title: string, lines: string[]): void {
  const el = document.createElement('div');
  el.setAttribute('data-token-error', '');
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'background:#0a0c0f', 'color:#f5f6f7',
    "font:16px/1.65 'Helvetica Neue',Helvetica,Inter,Arial,sans-serif",
    'padding:3rem', 'overflow:auto',
  ].join(';');
  const esc = (s: string) => s.replace(/[&<>]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  el.innerHTML =
    `<h1 style="font-size:1.6rem;font-weight:700;letter-spacing:-0.02em;margin:0 0 1rem">`
    + `${esc(title)}</h1>`
    + lines.map((l) => `<p style="max-width:70ch;margin:0 0 0.8rem">${l}</p>`).join('');
  document.body.appendChild(el);
}

/** The token, or a visible explanation and a thrown error. */
export function requireToken(): string {
  const token = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
  if (token) return token;

  const local = LOCAL.has(location.hostname);
  panel('No Mapbox token in this build', local ? [
    'Copy <code>app/.env.example</code> to <code>app/.env</code>, put a public '
    + '(<code>pk.</code>) token in it, and restart the dev server.',
    '<a style="color:#56B4E9" href="https://account.mapbox.com/access-tokens/">'
    + 'account.mapbox.com/access-tokens</a>',
  ] : [
    'Set <code>VITE_MAPBOX_TOKEN</code> in your host\'s environment variables — on Vercel '
    + 'that is Settings → Environment Variables, for the Production environment.',
    '<strong>Then redeploy.</strong> The token is read when the site is built, not when it '
    + 'is opened, so adding the variable does not fix an existing deployment — the next '
    + 'build has to pick it up.',
    'It must be a public <code>pk.</code> token. A secret <code>sk.</code> token will not '
    + 'work in a browser and must never be put in a build.',
  ]);
  throw new Error('missing VITE_MAPBOX_TOKEN');
}

/**
 * Surface a token Mapbox refuses.
 *
 * Mapbox reports this as an ordinary map error per failed request, so this fires once and
 * then stops listening — otherwise a restricted token paints the same panel a hundred
 * times over as each tile fails.
 */
export function watchTokenErrors(map: MapboxMap): void {
  let shown = false;
  map.on('error', (e: unknown) => {
    if (shown) return;
    const err = (e as { error?: { status?: number; message?: string } }).error;
    const status = err?.status;
    const unauthorised = status === 401 || status === 403
      || /401|403|[Uu]nauthorized|[Ff]orbidden/.test(err?.message ?? '');
    if (!unauthorised) return;
    shown = true;

    panel(`Mapbox rejected this token (HTTP ${status ?? '401/403'})`, [
      `The token is in the build — it is being sent and refused, on `
      + `<code>${location.hostname}</code>.`,
      'Nearly always a <strong>URL restriction</strong> on the token that does not list '
      + 'this domain. Open the token at <a style="color:#56B4E9" '
      + 'href="https://account.mapbox.com/access-tokens/">account.mapbox.com/access-tokens'
      + '</a> and either clear the restrictions or add this host. A Vercel project serves '
      + 'from several hostnames — the production domain, a <code>-git-branch-</code> one '
      + 'and a per-deployment one — so the entry needs to cover them, e.g. '
      + '<code>https://*.vercel.app/*</code> alongside any custom domain.',
      'The other possibilities: the token was deleted or rotated in the Mapbox account, or '
      + 'it is a secret <code>sk.</code> token, which a browser may not use.',
    ]);
  });
}
