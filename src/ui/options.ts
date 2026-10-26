import { personSummary, unitOptions, unitPath } from '../model/graph';
import type { EntityType, GraphData, Ref, Unit } from '../model/types';
import type { Option } from './Picker';

export const refKey = (r: Ref | Unit) => `${r.type}:${r.id}`;

export const parseKey = (k: string): Ref => {
  const i = k.indexOf(':');
  return { type: k.slice(0, i) as EntityType, id: k.slice(i + 1) };
};

/** Orgs and teams as "Org/Team" paths, for "what team or org are they in". */
export const unitPickerOptions = (d: GraphData, exclude?: (u: Unit) => boolean): Option[] =>
  unitOptions(d)
    .filter((o) => !exclude?.(o.unit))
    .map((o) => ({ key: refKey(o.unit), label: o.label, kind: o.unit.type }));

/** Any people, teams and orgs, for relationships and search. */
export const entityPickerOptions = (d: GraphData, types: EntityType[] = ['person', 'team', 'org']): Option[] => {
  const out: Option[] = [];
  if (types.includes('person'))
    for (const p of [...d.people].sort((a, b) => a.name.localeCompare(b.name)))
      out.push({ key: refKey({ type: 'person', id: p.id }), label: p.name, sub: personSummary(d, p), kind: 'person' });
  if (types.includes('team'))
    for (const t of d.teams) {
      const u: Unit = { type: 'team', id: t.id };
      out.push({ key: refKey(u), label: t.name, sub: `Team · ${unitPath(d, u)}`, kind: 'team' });
    }
  if (types.includes('org'))
    for (const o of d.orgs) out.push({ key: refKey({ type: 'org', id: o.id }), label: o.name, sub: 'Organization', kind: 'org' });
  return out;
};
