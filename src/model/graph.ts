// Read-only helpers for looking things up in a GraphData.
import type { GraphData, Org, Person, Ref, Relationship, Role, Team, Unit } from './types';

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const nowIso = (): string => new Date().toISOString();

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export const getOrg = (d: GraphData, id: string): Org | undefined => d.orgs.find((o) => o.id === id);
export const getTeam = (d: GraphData, id: string): Team | undefined => d.teams.find((t) => t.id === id);
export const getPerson = (d: GraphData, id: string): Person | undefined => d.people.find((p) => p.id === id);

export const getEntity = (d: GraphData, ref: Ref): Org | Team | Person | undefined =>
  ref.type === 'org' ? getOrg(d, ref.id) : ref.type === 'team' ? getTeam(d, ref.id) : getPerson(d, ref.id);

export const sameRef = (a: Ref | Unit, b: Ref | Unit): boolean => a.type === b.type && a.id === b.id;

export const entityName = (d: GraphData, ref: Ref): string => getEntity(d, ref)?.name ?? '(deleted)';

/** Teams directly under an org (parentTeamId null) or under a team. */
export const childTeams = (d: GraphData, unit: Unit): Team[] =>
  unit.type === 'org'
    ? d.teams.filter((t) => t.orgId === unit.id && t.parentTeamId === null)
    : d.teams.filter((t) => t.parentTeamId === unit.id);

/** Every team below `teamId` (not including itself). */
export const descendantTeamIds = (d: GraphData, teamId: string): Set<string> => {
  const out = new Set<string>();
  const walk = (id: string) => {
    for (const t of d.teams) {
      if (t.parentTeamId === id && !out.has(t.id)) {
        out.add(t.id);
        walk(t.id);
      }
    }
  };
  walk(teamId);
  return out;
};

export const orgIdOfUnit = (d: GraphData, unit: Unit): string | undefined =>
  unit.type === 'org' ? unit.id : getTeam(d, unit.id)?.orgId;

/** "Google/Ads/Search" style path. */
export const unitPath = (d: GraphData, unit: Unit): string => {
  if (unit.type === 'org') return getOrg(d, unit.id)?.name ?? '(deleted)';
  const parts: string[] = [];
  let team = getTeam(d, unit.id);
  const seen = new Set<string>();
  while (team && !seen.has(team.id)) {
    seen.add(team.id);
    parts.unshift(team.name);
    team = team.parentTeamId ? getTeam(d, team.parentTeamId) : undefined;
  }
  const t = getTeam(d, unit.id);
  const org = t ? getOrg(d, t.orgId) : undefined;
  if (!t) return '(deleted)';
  return [org?.name ?? '?', ...parts].join('/');
};

export interface UnitOption {
  unit: Unit;
  label: string;
}

/** All orgs and teams, each org followed by its teams depth-first, labelled with full paths. */
export const unitOptions = (d: GraphData): UnitOption[] => {
  const out: UnitOption[] = [];
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  const walk = (unit: Unit) => {
    for (const t of childTeams(d, unit).sort(byName)) {
      const u: Unit = { type: 'team', id: t.id };
      out.push({ unit: u, label: unitPath(d, u) });
      walk(u);
    }
  };
  for (const o of [...d.orgs].sort(byName)) {
    const u: Unit = { type: 'org', id: o.id };
    out.push({ unit: u, label: o.name });
    walk(u);
  }
  return out;
};

export interface RoleHolder {
  person: Person;
  role: Role;
}

const holders = (d: GraphData, unit: Unit, kind: Role['kind']): RoleHolder[] => {
  const out: RoleHolder[] = [];
  for (const person of d.people)
    for (const role of person.roles)
      if (role.kind === kind && sameRef(role.unit, unit)) out.push({ person, role });
  return out.sort((a, b) => a.person.name.localeCompare(b.person.name));
};

export const leadersOf = (d: GraphData, unit: Unit) => holders(d, unit, 'lead');
export const membersOf = (d: GraphData, unit: Unit) => holders(d, unit, 'member');

export const primaryMemberRole = (p: Person): Role | undefined => {
  const members = p.roles.filter((r) => r.kind === 'member');
  return members.find((r) => r.primary) ?? members[0];
};

export const roleLabel = (d: GraphData, role: Role): string => {
  const path = unitPath(d, role.unit);
  return role.kind === 'lead' ? `★ Lead, ${path}` : path;
};

/** Short one-liner shown next to a person's name in pickers. */
export const personSummary = (d: GraphData, p: Person): string => {
  if (p.roles.length === 0) return 'Unaffiliated';
  const leads = p.roles.filter((r) => r.kind === 'lead');
  const main = leads[0] ?? primaryMemberRole(p) ?? p.roles[0];
  const extra = p.roles.length > 1 ? ` +${p.roles.length - 1}` : '';
  return roleLabel(d, main) + extra;
};

export const isLeader = (p: Person): boolean => p.roles.some((r) => r.kind === 'lead');

export const relationshipsOf = (d: GraphData, ref: Ref): Relationship[] =>
  d.relationships
    .filter((r) => sameRef(r.a, ref) || sameRef(r.b, ref))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));

export const relationshipsBetween = (d: GraphData, x: Ref, y: Ref): Relationship[] =>
  d.relationships
    .filter((r) => (sameRef(r.a, x) && sameRef(r.b, y)) || (sameRef(r.a, y) && sameRef(r.b, x)))
    .sort((p, q) => q.createdAt.localeCompare(p.createdAt));

export const isEmptyGraph = (d: GraphData): boolean =>
  d.orgs.length + d.teams.length + d.people.length + d.relationships.length === 0;
