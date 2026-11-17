import { CATALOG, type CatalogRow } from '../catalog.generated';
import { PENS, PEN_ORDER } from '../pens';
import { REASON, fmtVintage } from './drawer';
import { escapeHtml, extLink } from './html';

const t = (s: string | null) => escapeHtml(s ?? '');

function cells(r: CatalogRow): string {
  if (r.status === 'mapped') {
    const where = r.scope === 'nyc' ? 'Mapped, NYC only' : 'Mapped, US';
    const link = extLink(r.sourceUrl, 'Source') + (r.verified ? '' : ' <span class="ex-flag">not verified</span>');
    return `<td>${where}</td><td>${t(r.authority)}</td><td>${t(r.dataset)}</td>
      <td class="ex-num">${t(fmtVintage(r.vintage))}</td><td>${t(r.license)}</td><td>${link}</td>`;
  }
  const c = r.candidate;
  const link = c?.url
    ? extLink(c.url, 'Candidate') + (c.verified ? '' : ' <span class="ex-flag">not verified</span>')
    : '';
  return `<td>Missing: ${REASON[r.missingReason!].toLowerCase()}</td><td>${t(r.keeper)}</td>
    <td>${t(c?.name ?? null)}</td><td></td><td></td><td>${link}</td>`;
}

/** All 93 rows, grouped by who drew the line. */
export function renderSources(el: HTMLElement): void {
  const body = PEN_ORDER.map((pen) => {
    const rows = CATALOG.filter((r) => r.pen === pen);
    return `<tbody>
      <tr class="ex-src-pen"><th colspan="8" scope="colgroup">
        <span class="ex-sw" style="--c:${PENS[pen].color}"></span>${escapeHtml(PENS[pen].label)}
        <span class="ex-muted"><span class="ex-num">${rows.length}</span> types</span></th></tr>
      ${rows.map((r) => `<tr class="${r.status === 'missing' ? 'is-missing' : ''}">
        <td class="ex-num">${r.n}</td><th scope="row">${t(r.label)}</th>${cells(r)}</tr>`).join('')}
    </tbody>`;
  }).join('');
  el.innerHTML = `<div class="ex-table-wrap" tabindex="0" role="region" aria-label="Sources table">
    <table class="ex-table">
      <thead><tr><th scope="col">#</th><th scope="col">Boundary</th><th scope="col">Status</th>
        <th scope="col">Authority</th><th scope="col">Dataset</th><th scope="col">Vintage</th>
        <th scope="col">License</th><th scope="col">Link</th></tr></thead>
      ${body}
    </table></div>`;
}
