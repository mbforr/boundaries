import { CATALOG, type CatalogRow } from '../catalog.generated';
import { PENS, PEN_ORDER, type Pen } from '../pens';
import { escapeHtml } from './html';
import { visible, type State } from './state';

export interface Section {
  pen: Pen;
  /** Every row in the section, before the scope filter and search. */
  rows: CatalogRow[];
}

/**
 * Group by who drew the line (PEN_ORDER), or by the video chapter it is counted in,
 * in the order the chapters run. The chapter view reproduces the video's counter.
 */
export function sections(group: State['group']): Section[] {
  if (group === 'pen') {
    return PEN_ORDER.map((pen) => ({ pen, rows: CATALOG.filter((r) => r.pen === pen) }));
  }
  const order: Pen[] = [];
  for (const r of CATALOG) if (!order.includes(r.chapterPen)) order.push(r.chapterPen);
  return order.map((pen) => ({ pen, rows: CATALOG.filter((r) => r.chapterPen === pen) }));
}

const CHIP: Record<string, string> = { national: 'US', nyc: 'NYC' };

function rowHtml(r: CatalogRow, s: State): string {
  const mapped = r.status === 'mapped';
  const chip = mapped ? CHIP[r.scope ?? ''] ?? '' : 'Missing';
  const name = escapeHtml(r.label);
  // In the chapter view a row's swatch still says who drew it.
  const sw = s.group === 'chapter'
    ? `<span class="ex-sw ex-sw-row" style="--c:${PENS[r.pen].color}" title="Drawn by ${PENS[r.pen].label}"></span>` : '';
  const toggle = mapped
    ? `<button class="ex-tog" data-act="toggle" aria-pressed="false"
         aria-label="Show ${name} on the map" style="--c:${PENS[r.pen].color}"></button>`
    : '<span class="ex-tog-none" aria-hidden="true"></span>';
  return `<li class="ex-row" data-n="${r.n}" data-status="${r.status}">
    <button class="ex-row-main" data-act="select" aria-label="${name}, details">
      <span class="ex-num">#${r.n}</span>${sw}<span class="ex-label">${name}</span>
      <span class="ex-chip ex-chip-${mapped ? r.scope : 'missing'}">${chip}</span>
    </button>${toggle}</li>`;
}

function headHtml(sec: Section, s: State): string {
  const p = PENS[sec.pen];
  const mapped = sec.rows.filter((r) => r.status === 'mapped').length;
  const open = !s.collapsed.has(sec.pen);
  const ns = sec.rows.map((r) => r.n);
  const sub = s.group === 'pen'
    ? p.blurb
    : `Counted #${Math.min(...ns)} to #${Math.max(...ns)}. The counter reaches ${Math.max(...ns)}.`;
  const name = s.group === 'pen' ? p.label : `${p.label} chapter`;
  return `<div class="ex-pen-head">
    <button class="ex-pen-title" data-act="collapse" aria-expanded="${open}">
      <span class="ex-sw" style="--c:${p.color}"></span>
      <span class="ex-pen-name">${escapeHtml(name)}</span>
      <span class="ex-pen-count"><span class="ex-num">${mapped}</span> of <span class="ex-num">${sec.rows.length}</span> mapped</span>
      <span class="ex-chev" aria-hidden="true">▾</span>
    </button>
    <p class="ex-pen-blurb">${escapeHtml(sub)}</p>
    ${mapped ? `<button class="ex-btn ex-btn-small" data-act="pen-show">Show this pen</button>` : ''}
  </div>`;
}

export function renderList(el: HTMLElement, s: State): void {
  const html: string[] = [];
  for (const sec of sections(s.group)) {
    const rows = sec.rows.filter((r) => visible(r, s));
    if (!rows.length) continue;
    const open = !s.collapsed.has(sec.pen);
    html.push(`<section class="ex-pen" data-pen="${sec.pen}" style="--c:${PENS[sec.pen].color}">
      ${headHtml(sec, s)}
      <ol class="ex-rows" ${open ? '' : 'hidden'}>${rows.map((r) => rowHtml(r, s)).join('')}</ol>
    </section>`);
  }
  el.innerHTML = html.join('') ||
    '<p class="ex-empty">Nothing matches. Try a different word, or clear the search.</p>';
  syncList(el, s, new Set());
}

/** Update toggles, selection and loading in place, without rebuilding the list. */
export function syncList(el: HTMLElement, s: State, loading: Set<number>): void {
  for (const li of el.querySelectorAll<HTMLElement>('.ex-row')) {
    const n = Number(li.dataset.n);
    li.classList.toggle('is-selected', s.sel === n);
    li.classList.toggle('is-loading', loading.has(n));
    li.querySelector('.ex-row-main')?.setAttribute('aria-current', s.sel === n ? 'true' : 'false');
    const tog = li.querySelector<HTMLButtonElement>('.ex-tog');
    if (tog) {
      tog.setAttribute('aria-pressed', String(s.on.has(n)));
      tog.setAttribute('aria-busy', String(loading.has(n)));
    }
  }
  for (const secEl of el.querySelectorAll<HTMLElement>('.ex-pen')) {
    const pen = secEl.dataset.pen as Pen;
    const sec = sections(s.group).find((x) => x.pen === pen);
    const btn = secEl.querySelector<HTMLButtonElement>('[data-act="pen-show"]');
    if (!sec || !btn) continue;
    const mapped = sec.rows.filter((r) => r.status === 'mapped');
    const allOn = mapped.length > 0 && mapped.every((r) => s.on.has(r.n));
    btn.textContent = allOn ? 'Hide this pen' : 'Show this pen';
  }
}
