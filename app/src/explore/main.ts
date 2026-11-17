import './explore.css';
import { CATALOG } from '../catalog.generated';
import { PEN_ORDER, type Pen } from '../pens';
import type { Theme } from './colors';
import { drawerHtml } from './drawer';
import { renderList, sections, syncList } from './list';
import { ExploreMap } from './map';
import { renderSources } from './sources';
import { BY_N, MAPPED, readUrl, writeUrl, type State } from './state';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ── theme ──────────────────────────────────────────────────────────────────────────
// Follows the system. `?theme=light|dark` pins it, for screenshots and for linking.
const forced = new URLSearchParams(location.search).get('theme');
if (forced === 'light' || forced === 'dark') document.documentElement.dataset.theme = forced;
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const themeNow = (): Theme =>
  forced === 'light' || forced === 'dark' ? forced : darkQuery.matches ? 'dark' : 'light';

// ── counts: every number on the page comes from the catalog ────────────────────────
const total = CATALOG.length;
const missing = CATALOG.filter((r) => r.status === 'missing').length;
const national = MAPPED.filter((r) => r.scope === 'national').length;
const nyc = MAPPED.filter((r) => r.scope === 'nyc').length;
const pens = new Set(CATALOG.map((r) => r.pen)).size;
const n = (v: number) => `<span class="ex-num">${v}</span>`;

$('#ex-byline').textContent = `${total} boundaries · ${pens} pens · one landmark`;
$('#ex-stats').innerHTML = `
  <div><dt>Boundary types</dt><dd>${n(total)}</dd></div>
  <div><dt>Mapped</dt><dd>${n(MAPPED.length)}</dd></div>
  <div><dt>Missing</dt><dd>${n(missing)}</dd></div>
  <div><dt>National / NYC only</dt><dd>${n(national)}<span class="ex-slash">/</span>${n(nyc)}</dd></div>`;
for (const el of document.querySelectorAll<HTMLElement>('[data-count]')) {
  const k = el.dataset.count;
  el.textContent = String({ total, mapped: MAPPED.length, missing, national, nyc }[k as string] ?? '');
}

// ── state ──────────────────────────────────────────────────────────────────────────
const s: State = readUrl();
const loading = new Set<number>();
const list = $('#ex-list');
const drawer = $('#ex-drawer');
const toast = $('#ex-toast');

let xmap: ExploreMap | null = null;
try {
  xmap = new ExploreMap($('#ex-map'), themeNow(), {
    onLoading(k, busy) {
      if (busy) loading.add(k); else loading.delete(k);
      syncList(list, s, loading);
    },
    onError(k, msg) {
      s.on.delete(k);
      console.error(msg);
      say(`Couldn't load #${k}. Try again in a moment.`);
      update();
    },
  });
} catch (e) {
  // No token: token.ts has already said so on screen. The list and sources still work.
  console.error(e);
}

let toastTimer = 0;
function say(msg: string): void {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
}

function renderDrawer(): void {
  const r = s.sel === null ? undefined : BY_N.get(s.sel);
  drawer.hidden = !r;
  document.body.classList.toggle('has-sheet', !!r);
  if (r) drawer.innerHTML = drawerHtml(r, s.on.has(r.n));
}

function renderControls(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-group]')) {
    b.setAttribute('aria-pressed', String(b.dataset.group === s.group));
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-scope]')) {
    b.setAttribute('aria-pressed', String(b.dataset.scope === s.scope));
  }
  $<HTMLButtonElement>('#ex-clear').disabled = s.on.size === 0;
  $('#ex-on-count').textContent = s.on.size ? `${s.on.size} on` : '';
}

/** Apply state everywhere. `full` rebuilds the list (grouping, filter or search changed). */
function update(full = false): void {
  writeUrl(s);
  if (full) renderList(list, s);
  syncList(list, s, loading);
  renderDrawer();
  renderControls();
  void xmap?.setOn(s.on);
}

function switchOn(k: number): void {
  const r = BY_N.get(k);
  if (r?.status !== 'mapped') return;   // missing types never draw
  s.on.add(k);
  if (r.scope === 'nyc' && xmap?.zoomedOut()) {
    xmap.flyHome();
    say('Mapped for New York City only.');
  }
}

function toggle(k: number): void {
  if (s.on.has(k)) s.on.delete(k); else switchOn(k);
  update();
}

// ── events ─────────────────────────────────────────────────────────────────────────
list.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!btn) return;
  const row = btn.closest<HTMLElement>('.ex-row');
  const pen = btn.closest<HTMLElement>('.ex-pen')?.dataset.pen as Pen | undefined;
  switch (btn.dataset.act) {
    case 'toggle': toggle(Number(row?.dataset.n)); break;
    case 'select': {
      const k = Number(row?.dataset.n);
      s.sel = s.sel === k ? null : k;
      update();
      break;
    }
    case 'collapse':
      if (!pen) break;
      if (s.collapsed.has(pen)) s.collapsed.delete(pen); else s.collapsed.add(pen);
      update(true);
      break;
    case 'pen-show': {
      const sec = sections(s.group).find((x) => x.pen === pen);
      const mapped = sec?.rows.filter((r) => r.status === 'mapped') ?? [];
      if (mapped.every((r) => s.on.has(r.n))) mapped.forEach((r) => s.on.delete(r.n));
      else mapped.forEach((r) => switchOn(r.n));
      update();
      break;
    }
  }
});

drawer.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  const r = s.sel === null ? undefined : BY_N.get(s.sel);
  if (!r) return;
  if (act === 'close') { s.sel = null; update(); }
  if (act === 'toggle-sel') toggle(r.n);
  if (act === 'frame') {
    if (!s.on.has(r.n)) switchOn(r.n);
    xmap?.frame(r);
    update();
  }
});

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-group]')) {
  b.addEventListener('click', () => { s.group = b.dataset.group as State['group']; update(true); });
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-scope]')) {
  b.addEventListener('click', () => { s.scope = b.dataset.scope as State['scope']; update(true); });
}
const q = $<HTMLInputElement>('#ex-q');
q.value = s.q;
q.addEventListener('input', () => { s.q = q.value; update(true); });
$('#ex-clear').addEventListener('click', () => { s.on.clear(); update(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && s.sel !== null) { s.sel = null; update(); }
});
darkQuery.addEventListener('change', () => { void xmap?.setTheme(themeNow()); });

// ── go ─────────────────────────────────────────────────────────────────────────────
renderSources($('#ex-sources'));
update(true);
// A deep link with an NYC-only layer opens on the city anyway (HOME), so no toast.

// For scripts/smoke_explore.py: what the page thinks is on, and which pens exist.
(window as unknown as Record<string, unknown>).__explore = {
  state: s, loading, pens: PEN_ORDER, mapReady: !!xmap,
};
