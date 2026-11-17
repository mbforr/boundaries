import { CATALOG, type CatalogRow } from '../catalog.generated';
import type { Pen } from '../pens';

export type GroupBy = 'pen' | 'chapter';
export type ScopeFilter = 'all' | 'mapped' | 'missing';

export interface State {
  /** Types switched on, by video number. Only mapped types can be on. */
  on: Set<number>;
  /** The type shown in the drawer. */
  sel: number | null;
  group: GroupBy;
  scope: ScopeFilter;
  q: string;
  collapsed: Set<Pen>;
}

export const BY_N = new Map<number, CatalogRow>(CATALOG.map((r) => [r.n, r]));
export const MAPPED = CATALOG.filter((r) => r.status === 'mapped');

/**
 * A layer id names a type in the URL only when no other type shares its file.
 * census_place (#5, #9) and census_cbsa (#14, #17) are written as numbers instead.
 */
const LAYER_USES = new Map<string, number[]>();
for (const r of MAPPED) {
  if (r.layer) LAYER_USES.set(r.layer, [...(LAYER_USES.get(r.layer) ?? []), r.n]);
}

function token(n: number): string {
  const r = BY_N.get(n);
  if (r?.layer && LAYER_USES.get(r.layer)?.length === 1) return r.layer;
  return String(n);
}

function untoken(t: string): number[] {
  if (/^\d+$/.test(t)) return [Number(t)];
  // A shared layer id switches on every type drawn from it.
  return LAYER_USES.get(t) ?? [];
}

/** `?on=census_tract,nyc_zoning_district&sel=61&group=pen&scope=all&q=` */
export function readUrl(): State {
  const p = new URLSearchParams(location.search);
  const on = new Set<number>();
  for (const t of (p.get('on') ?? '').split(',').filter(Boolean)) {
    for (const n of untoken(t.trim())) if (BY_N.get(n)?.status === 'mapped') on.add(n);
  }
  const sel = Number(p.get('sel'));
  const scope = p.get('scope');
  return {
    on,
    sel: BY_N.has(sel) ? sel : null,
    group: p.get('group') === 'chapter' ? 'chapter' : 'pen',
    scope: scope === 'mapped' || scope === 'missing' ? scope : 'all',
    q: p.get('q') ?? '',
    collapsed: new Set(),
  };
}

export function writeUrl(s: State): void {
  const p = new URLSearchParams(location.search);
  const set = (k: string, v: string | null) => (v ? p.set(k, v) : p.delete(k));
  set('on', [...s.on].sort((a, b) => a - b).map(token).join(','));
  set('sel', s.sel === null ? null : String(s.sel));
  set('group', s.group === 'pen' ? null : s.group);
  set('scope', s.scope === 'all' ? null : s.scope);
  set('q', s.q.trim() || null);
  const qs = p.toString().replace(/%2C/g, ',');
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

/** Does a row pass the scope filter and the search box? */
export function visible(r: CatalogRow, s: State): boolean {
  if (s.scope !== 'all' && r.status !== s.scope) return false;
  const q = s.q.trim().toLowerCase();
  if (!q) return true;
  if (/^#?\d+$/.test(q)) return r.n === Number(q.replace('#', ''));
  return [r.label, r.authority, r.dataset, r.keeper, r.layer]
    .some((v) => v?.toLowerCase().includes(q));
}
