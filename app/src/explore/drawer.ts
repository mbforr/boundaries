import type { CatalogRow, MissingReason } from '../catalog.generated';
import { PENS } from '../pens';
import { escapeHtml, extLink } from './html';

export const REASON: Record<MissingReason, string> = {
  buildable: 'Not in the stack yet',
  no_national_file: 'No national file',
  licensed: 'Privately licensed',
  blocked: 'Blocked',
  derivable: 'Could be derived',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-08-03` → `Aug 3, 2026`. Anything else passes through. */
export function fmtDate(s: string | null): string {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s ?? '';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/**
 * Vintages in the registry carry pipeline notes, like `2026-05-26 (Socrata rowsUpdatedAt)`.
 * The page shows the date; the CSV keeps the note.
 */
export function fmtVintage(s: string | null): string {
  return fmtDate((s ?? '').replace(/\s*\(.*\)$/, ''));
}

function item(term: string, value: string): string {
  return value ? `<div class="ex-dl-row"><dt>${term}</dt><dd>${value}</dd></div>` : '';
}

const t = (s: string | null) => escapeHtml(s ?? '');
const num = (n: number) => `<span class="ex-num">${n.toLocaleString('en-US')}</span>`;

function sourceLink(r: CatalogRow): string {
  if (!r.sourceUrl) return '';
  const warn = r.verified ? '' :
    ' <span class="ex-flag">Not verified: the site blocks automated checks.</span>';
  return extLink(r.sourceUrl, 'Open source') + warn;
}

function esbLine(r: CatalogRow): string {
  if (r.atEsb === null) return '';
  if (r.status === 'missing') {
    return item('At the Empire State Building',
      `Expected: ${t(r.esbValue)}. <span class="ex-muted">Not tested, since there is no file.</span>`);
  }
  return item('At the Empire State Building',
    r.atEsb ? `Yes: ${t(r.esbValue)}` : 'No. The building is outside every one of these.');
}

export function drawerHtml(r: CatalogRow, on: boolean): string {
  const p = PENS[r.pen];
  const chapter = r.chapterPen !== r.pen
    ? `<p class="ex-muted">Counted in the video's ${escapeHtml(PENS[r.chapterPen].label.replace(/^The /, '').toLowerCase())} chapter.</p>`
    : '';
  const head = `<header class="ex-drawer-head">
    <p class="ex-kicker"><span class="ex-sw" style="--c:${p.color}"></span>
      ${escapeHtml(p.label)} · <span class="ex-num">#${r.n}</span> in the video</p>
    <h2 id="ex-drawer-title">${t(r.label)}</h2>
    ${chapter}
    <button class="ex-close" data-act="close" aria-label="Close details">×</button>
  </header>`;

  if (r.status === 'mapped') {
    const scope = r.scope === 'nyc'
      ? '<p class="ex-scope">Mapped for New York City only.</p>' : '';
    const ext = r.extent
      ? `<span class="ex-num">${r.extent.map((v) => v.toFixed(2)).join(', ')}</span>` : '';
    return `${head}${scope}
      <div class="ex-drawer-actions">
        <button class="ex-btn" data-act="toggle-sel" aria-pressed="${on}">${on ? 'Hide on map' : 'Show on map'}</button>
        <button class="ex-btn ex-btn-quiet" data-act="frame">Go to it</button>
      </div>
      <dl class="ex-dl">
        ${item('Published by', t(r.authority))}
        ${item('Dataset', t(r.dataset))}
        ${r.derivation ? item('How it was built', t(r.derivation) + (r.inputUrl ? ` ${extLink(r.inputUrl, 'Input file')}` : '')) : ''}
        ${item('Vintage', t(fmtVintage(r.vintage)))}
        ${item('Retrieved', fmtDate(r.retrieved))}
        ${item('Features', r.features === null ? '' : `${num(r.features)} in this file`)}
        ${item('Extent', ext)}
        ${item('License', t(r.license))}
        ${esbLine(r)}
        ${r.penNote ? item('Why this pen', t(r.penNote)) : ''}
      </dl>
      <p class="ex-source">${sourceLink(r)}</p>`;
  }

  const c = r.candidate;
  let where = '';
  if (c) {
    const label = r.missingReason === 'buildable' || r.missingReason === 'blocked' || r.missingReason === 'derivable'
      ? 'Where the data would come from' : 'Closest reference';
    const link = c.url ? extLink(c.url, c.name) : t(c.name);
    const flag = c.verified ? '' : ' <span class="ex-flag">Not verified: the site blocks automated checks.</span>';
    where = item(label, `${link}<br><span class="ex-muted">${t(c.maintainer)}</span>${flag}`);
  } else if (r.missingReason === 'no_national_file') {
    where = item('Where the data would come from', 'There isn\'t a national file.');
  }
  return `${head}
    <p class="ex-reason"><span class="ex-chip ex-chip-missing">Missing</span> ${REASON[r.missingReason!]}</p>
    <p class="ex-note">${t(r.missingNote)}</p>
    <dl class="ex-dl">
      ${item('Who keeps the line', t(r.keeper))}
      ${where}
      ${esbLine(r)}
      ${r.penNote ? item('Why this pen', t(r.penNote)) : ''}
    </dl>
    <p class="ex-muted ex-never">I don't draw a shape for a type I don't have.</p>`;
}
