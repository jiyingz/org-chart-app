// Three-way merge of two copies of the graph (this device vs. GitHub) against the last version
// both agreed on. Items are matched by ID, so independent edits on different devices combine
// cleanly; only the same item edited differently on both sides becomes a conflict.
import { normalizePrimary } from '../model/ops';
import { emptyGraph, type CollectionKey, type GraphData, type Note, type Notes } from '../model/types';

const COLLECTIONS: CollectionKey[] = ['orgs', 'teams', 'people', 'relationships'];

type Item = { id: string; name?: string; notes?: Notes; updatedAt?: string };

export const stableStringify = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
};

const eq = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

/** Bookkeeping fields that should never cause a conflict by themselves. */
const IGNORED = new Set(['updatedAt', 'notes']);

export interface Conflict {
  collection: CollectionKey;
  id: string;
  label: string;
  local: Item | null;
  remote: Item | null;
}

export interface MergeResult {
  merged: GraphData;
  conflicts: Conflict[];
}

const mergeNoteList = (base: Note[], local: Note[], remote: Note[]): Note[] => {
  const baseIds = new Set(base.map((n) => n.id));
  const localIds = new Set(local.map((n) => n.id));
  const remoteIds = new Set(remote.map((n) => n.id));
  const out = new Map<string, Note>();
  for (const n of [...local, ...remote]) {
    // A note that existed before and is now missing on one side was deleted there.
    if (baseIds.has(n.id) && (!localIds.has(n.id) || !remoteIds.has(n.id))) continue;
    out.set(n.id, n);
  }
  return [...out.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};

const mergeNotes = (base?: Notes, local?: Notes, remote?: Notes): Notes | undefined => {
  if (!local && !remote) return undefined;
  const b = base ?? { notable: [], other: [] };
  const l = local ?? { notable: [], other: [] };
  const r = remote ?? { notable: [], other: [] };
  return { notable: mergeNoteList(b.notable, l.notable, r.notable), other: mergeNoteList(b.other, l.other, r.other) };
};

/** Field-by-field merge of one item changed on both sides. Returns null if the same field differs. */
const mergeFields = (base: Item, local: Item, remote: Item): Item | null => {
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  const out: Record<string, unknown> = {};
  const B = base as unknown as Record<string, unknown>;
  const L = local as unknown as Record<string, unknown>;
  const R = remote as unknown as Record<string, unknown>;
  for (const k of keys) {
    if (IGNORED.has(k)) continue;
    if (eq(L[k], R[k])) out[k] = L[k];
    else if (eq(L[k], B[k])) out[k] = R[k];
    else if (eq(R[k], B[k])) out[k] = L[k];
    else return null;
  }
  out.notes = mergeNotes(base.notes, local.notes, remote.notes);
  out.updatedAt = [local.updatedAt ?? '', remote.updatedAt ?? ''].sort().pop();
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as Item;
};

const withoutNotes = (i: Item | undefined) => (i ? { ...i, notes: undefined, updatedAt: undefined } : i);

export const threeWayMerge = (base: GraphData | null, local: GraphData, remote: GraphData): MergeResult => {
  const b = base ?? emptyGraph();
  const merged = emptyGraph();
  const conflicts: Conflict[] = [];

  for (const key of COLLECTIONS) {
    const bm = new Map((b[key] as Item[]).map((i) => [i.id, i]));
    const lm = new Map((local[key] as Item[]).map((i) => [i.id, i]));
    const rm = new Map((remote[key] as Item[]).map((i) => [i.id, i]));
    const order = [...new Set([...lm.keys(), ...rm.keys()])];
    const out: Item[] = [];
    for (const id of order) {
      const B = bm.get(id);
      const L = lm.get(id);
      const R = rm.get(id);
      if (eq(L, R)) {
        if (L) out.push(L);
      } else if (eq(L, B)) {
        if (R) out.push(R); // only the other device changed it (or deleted it)
      } else if (eq(R, B)) {
        if (L) out.push(L); // only this device changed it (or deleted it)
      } else if (L && R && B) {
        const m = mergeFields(B, L, R);
        if (m) out.push(m);
        else {
          conflicts.push({ collection: key, id, label: L.name ?? R.name ?? id, local: L, remote: R });
          out.push(L); // placeholder until the user picks
        }
      } else if (L && R) {
        // Added independently on both sides with the same id — practically impossible; keep this device's.
        out.push(L);
      } else {
        // Deleted on one side, edited on the other. An edit to notes only isn't worth resurrecting for,
        // but any real edit means the item is still wanted, so keep it.
        const survivor = (L ?? R)!;
        if (!eq(withoutNotes(survivor), withoutNotes(B))) out.push(survivor);
      }
    }
    (merged[key] as Item[]) = out;
  }
  return { merged: repair(merged), conflicts };
};

/** Resolve conflicts with the user's picks ('local' | 'remote' per conflict id). */
export const applyResolutions = (
  result: MergeResult,
  picks: Record<string, 'local' | 'remote'>,
): GraphData => {
  const d: GraphData = structuredClone(result.merged);
  for (const c of result.conflicts) {
    const choice = picks[c.id] === 'remote' ? c.remote : c.local;
    const list = d[c.collection] as Item[];
    const idx = list.findIndex((i) => i.id === c.id);
    if (choice) {
      if (idx >= 0) list[idx] = choice;
      else list.push(choice);
    } else if (idx >= 0) list.splice(idx, 1);
  }
  return repair(d);
};

/** Fix up references that a merge may have left dangling (e.g. a role in a team deleted elsewhere). */
export const repair = (d: GraphData): GraphData => {
  const orgIds = new Set(d.orgs.map((o) => o.id));
  // Teams whose org vanished go; teams whose parent vanished move up to the org.
  d.teams = d.teams.filter((t) => orgIds.has(t.orgId));
  const teamIds = new Set(d.teams.map((t) => t.id));
  for (const t of d.teams) if (t.parentTeamId && !teamIds.has(t.parentTeamId)) t.parentTeamId = null;
  // Two devices could each move a team under the other; break any cycle, and keep org ids in step.
  const byId = new Map(d.teams.map((t) => [t.id, t]));
  for (const t of d.teams) {
    const seen = new Set([t.id]);
    let p = t.parentTeamId ? byId.get(t.parentTeamId) : undefined;
    while (p) {
      if (seen.has(p.id)) {
        t.parentTeamId = null;
        break;
      }
      seen.add(p.id);
      p = p.parentTeamId ? byId.get(p.parentTeamId) : undefined;
    }
  }
  const rootOrg = (t: (typeof d.teams)[number]): string => {
    let cur = t;
    while (cur.parentTeamId) cur = byId.get(cur.parentTeamId)!;
    return cur.orgId;
  };
  for (const t of d.teams) t.orgId = rootOrg(t);
  for (const p of d.people) {
    const before = p.roles.length;
    p.roles = p.roles.filter((r) => (r.unit.type === 'org' ? orgIds.has(r.unit.id) : teamIds.has(r.unit.id)));
    if (before !== p.roles.length) normalizePrimary(p);
  }
  const personIds = new Set(d.people.map((p) => p.id));
  const exists = (r: { type: string; id: string }) =>
    r.type === 'org' ? orgIds.has(r.id) : r.type === 'team' ? teamIds.has(r.id) : personIds.has(r.id);
  d.relationships = d.relationships.filter((r) => exists(r.a) && exists(r.b));
  return d;
};
