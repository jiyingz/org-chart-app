// Mutations. Every op takes a *draft* (a fresh clone owned by the store) and edits it in place.
import {
  childTeams,
  descendantTeamIds,
  getEntity,
  getOrg,
  getPerson,
  getTeam,
  nowIso,
  sameRef,
  uid,
  unitPath,
} from './graph';
import {
  emptyNotes,
  type GraphData,
  type NoteSection,
  type Notes,
  type Person,
  type Ref,
  type Role,
  type RoleKind,
  type Unit,
} from './types';

const touch = (e: { updatedAt: string }) => {
  e.updatedAt = nowIso();
};

// ---------- notes ----------

export const addNote = (d: GraphData, ref: Ref, section: NoteSection, text: string): void => {
  const e = getEntity(d, ref);
  const trimmed = text.trim();
  if (!e || !trimmed) return;
  e.notes[section].unshift({ id: uid(), text: trimmed, createdAt: nowIso() });
  touch(e);
};

export const removeNote = (d: GraphData, ref: Ref, section: NoteSection, noteId: string): void => {
  const e = getEntity(d, ref);
  if (!e) return;
  e.notes[section] = e.notes[section].filter((n) => n.id !== noteId);
  touch(e);
};

/** Automatic, dated history line in "Other notes". */
export const historyNote = (d: GraphData, ref: Ref, text: string): void => addNote(d, ref, 'other', text);

const withNotes = (n?: Partial<Notes>): Notes => ({ ...emptyNotes(), ...n });

// ---------- create ----------

export const addOrg = (d: GraphData, input: { name: string; tentative?: boolean; notes?: Notes }): string => {
  const id = uid();
  const t = nowIso();
  d.orgs.push({
    id,
    name: input.name.trim(),
    tentative: input.tentative || undefined,
    notes: withNotes(input.notes),
    createdAt: t,
    updatedAt: t,
  });
  return id;
};

export const addTeam = (
  d: GraphData,
  input: { name: string; parent: Unit; tentative?: boolean; notes?: Notes },
): string => {
  const parentTeam = input.parent.type === 'team' ? getTeam(d, input.parent.id) : undefined;
  const orgId = parentTeam ? parentTeam.orgId : input.parent.id;
  if (!getOrg(d, orgId)) throw new Error('Parent organization not found');
  const id = uid();
  const t = nowIso();
  d.teams.push({
    id,
    name: input.name.trim(),
    orgId,
    parentTeamId: parentTeam ? parentTeam.id : null,
    tentative: input.tentative || undefined,
    notes: withNotes(input.notes),
    createdAt: t,
    updatedAt: t,
  });
  return id;
};

export interface ContactFields {
  linkedin?: string;
  personalEmail?: string;
  workEmail?: string;
  phone?: string;
}

export const addPerson = (
  d: GraphData,
  input: { name: string; roles?: Omit<Role, 'id'>[]; notes?: Notes } & ContactFields,
): string => {
  const id = uid();
  const t = nowIso();
  const person: Person = {
    id,
    name: input.name.trim(),
    roles: (input.roles ?? []).map((r) => ({ ...r, id: uid() })),
    notes: withNotes(input.notes),
    createdAt: t,
    updatedAt: t,
  };
  setContact(person, input);
  normalizePrimary(person);
  d.people.push(person);
  return id;
};

export const setContact = (p: Person, c: ContactFields): void => {
  for (const k of ['linkedin', 'personalEmail', 'workEmail', 'phone'] as const) {
    if (k in c) {
      const v = c[k]?.trim();
      if (v) p[k] = v;
      else delete p[k];
    }
  }
};

// ---------- update ----------

export const renameEntity = (d: GraphData, ref: Ref, name: string): void => {
  const e = getEntity(d, ref);
  const trimmed = name.trim();
  if (!e || !trimmed || e.name === trimmed) return;
  if (ref.type !== 'person') historyNote(d, ref, `Renamed from "${e.name}"`);
  e.name = trimmed;
  touch(e);
};

export const setTentative = (d: GraphData, ref: Ref, tentative: boolean): void => {
  const e = getEntity(d, ref);
  if (!e || ref.type === 'person') return;
  (e as { tentative?: boolean }).tentative = tentative || undefined;
  touch(e);
};

export const updatePersonContact = (d: GraphData, personId: string, c: ContactFields): void => {
  const p = getPerson(d, personId);
  if (!p) return;
  setContact(p, c);
  touch(p);
};

// ---------- roles ----------

/** Exactly one member role is primary (the one drawn as the card), if there are any member roles. */
export const normalizePrimary = (p: Person): void => {
  const members = p.roles.filter((r) => r.kind === 'member');
  const current = members.filter((r) => r.primary);
  for (const r of p.roles) delete r.primary;
  if (members.length) (current[0] ?? members[0]).primary = true;
};

/** Two identical roles (same place, same kind) collapse into one. */
const dedupeRoles = (p: Person): void => {
  p.roles = p.roles.filter((x, i) => p.roles.findIndex((y) => y.kind === x.kind && sameRef(y.unit, x.unit)) === i);
  normalizePrimary(p);
};

/**
 * Give a person a new role, optionally replacing some of their existing ones
 * (the "Move" choice when someone is promoted or hops teams).
 */
export const assignRole = (
  d: GraphData,
  personId: string,
  role: { unit: Unit; kind: RoleKind; title?: string; tentative?: boolean },
  replaceRoleIds: string[] = [],
): string | undefined => {
  const p = getPerson(d, personId);
  if (!p) return;
  const replaced = p.roles.filter((r) => replaceRoleIds.includes(r.id));
  const wasPrimary = replaced.some((r) => r.primary);
  p.roles = p.roles.filter((r) => !replaceRoleIds.includes(r.id));
  const existing = p.roles.find((r) => r.kind === role.kind && sameRef(r.unit, role.unit));
  const target = unitPath(d, role.unit);
  const verb = role.kind === 'lead' ? 'lead' : 'join';
  if (replaced.length) {
    const from = replaced.map((r) => unitPath(d, r.unit)).join(', ');
    historyNote(d, { type: 'person', id: p.id }, `Moved from ${from} to ${verb} ${target}`);
  } else if (!existing) {
    historyNote(d, { type: 'person', id: p.id }, role.kind === 'lead' ? `Became lead of ${target}` : `Added to ${target}`);
  }
  let id: string;
  if (existing) {
    if (role.title !== undefined) existing.title = role.title.trim() || undefined;
    id = existing.id;
  } else {
    id = uid();
    p.roles.push({
      id,
      unit: role.unit,
      kind: role.kind,
      title: role.title?.trim() || undefined,
      tentative: role.tentative || undefined,
      primary: wasPrimary && role.kind === 'member' ? true : undefined,
    });
  }
  normalizePrimary(p);
  touch(p);
  return id;
};

export const updateRole = (
  d: GraphData,
  personId: string,
  roleId: string,
  patch: Partial<Pick<Role, 'unit' | 'kind' | 'title' | 'tentative' | 'primary'>>,
): void => {
  const p = getPerson(d, personId);
  const r = p?.roles.find((x) => x.id === roleId);
  if (!p || !r) return;
  if (patch.unit && !sameRef(patch.unit, r.unit)) {
    historyNote(d, { type: 'person', id: p.id }, `Moved from ${unitPath(d, r.unit)} to ${unitPath(d, patch.unit)}`);
    r.unit = patch.unit;
  }
  if (patch.kind && patch.kind !== r.kind) {
    historyNote(
      d,
      { type: 'person', id: p.id },
      patch.kind === 'lead' ? `Became lead of ${unitPath(d, r.unit)}` : `No longer lead of ${unitPath(d, r.unit)}`,
    );
    r.kind = patch.kind;
  }
  if ('title' in patch) r.title = patch.title?.trim() || undefined;
  if ('tentative' in patch) r.tentative = patch.tentative || undefined;
  if (patch.primary) {
    for (const x of p.roles) delete x.primary;
    r.primary = true;
  }
  dedupeRoles(p);
  touch(p);
};

export const removeRole = (d: GraphData, personId: string, roleId: string): void => {
  const p = getPerson(d, personId);
  const r = p?.roles.find((x) => x.id === roleId);
  if (!p || !r) return;
  historyNote(
    d,
    { type: 'person', id: p.id },
    r.kind === 'lead' ? `No longer lead of ${unitPath(d, r.unit)}` : `Left ${unitPath(d, r.unit)}`,
  );
  p.roles = p.roles.filter((x) => x.id !== roleId);
  normalizePrimary(p);
  touch(p);
};

// ---------- team structure ----------

/** Can `teamId` be moved under `target`? Not into itself or its own sub-teams. */
export const canMoveTeam = (d: GraphData, teamId: string, target: Unit): boolean => {
  const team = getTeam(d, teamId);
  if (!team) return false;
  if (target.type === 'team') {
    if (target.id === teamId || descendantTeamIds(d, teamId).has(target.id)) return false;
    if (team.parentTeamId === target.id) return false;
    return !!getTeam(d, target.id);
  }
  if (team.orgId === target.id && team.parentTeamId === null) return false;
  return !!getOrg(d, target.id);
};

export const moveTeam = (d: GraphData, teamId: string, target: Unit): boolean => {
  if (!canMoveTeam(d, teamId, target)) return false;
  const team = getTeam(d, teamId)!;
  const from = unitPath(d, team.parentTeamId ? { type: 'team', id: team.parentTeamId } : { type: 'org', id: team.orgId });
  const newOrgId = target.type === 'org' ? target.id : getTeam(d, target.id)!.orgId;
  team.parentTeamId = target.type === 'team' ? target.id : null;
  if (team.orgId !== newOrgId) {
    team.orgId = newOrgId;
    for (const id of descendantTeamIds(d, teamId)) getTeam(d, id)!.orgId = newOrgId;
  }
  historyNote(d, { type: 'team', id: teamId }, `Moved from ${from} to ${unitPath(d, target)}`);
  touch(team);
  return true;
};

/** Put a new team between `teamId` and its current parent. */
export const insertParentTeam = (d: GraphData, teamId: string, name: string): string | undefined => {
  const team = getTeam(d, teamId);
  if (!team) return;
  const parent: Unit = team.parentTeamId ? { type: 'team', id: team.parentTeamId } : { type: 'org', id: team.orgId };
  const newId = addTeam(d, { name, parent });
  team.parentTeamId = newId;
  historyNote(d, { type: 'team', id: teamId }, `Now part of ${unitPath(d, { type: 'team', id: newId })}`);
  touch(team);
  return newId;
};

const replaceRefEverywhere = (d: GraphData, from: Ref, to: Ref) => {
  for (const p of d.people) {
    for (const r of p.roles) if (sameRef(r.unit, from)) r.unit = { type: to.type as Unit['type'], id: to.id };
    dedupeRoles(p);
  }
  for (const rel of d.relationships) {
    if (sameRef(rel.a, from)) rel.a = { ...to };
    if (sameRef(rel.b, from)) rel.b = { ...to };
  }
  d.relationships = d.relationships.filter((r) => !sameRef(r.a, r.b));
};

/** Fold `sourceId` into `targetId`: people, sub-teams, notes and relationships all move over. */
export const mergeTeam = (d: GraphData, sourceId: string, targetId: string): boolean => {
  const source = getTeam(d, sourceId);
  const target = getTeam(d, targetId);
  if (!source || !target || sourceId === targetId) return false;
  if (descendantTeamIds(d, sourceId).has(targetId)) {
    // Target lives inside source: lift it out first so the tree stays valid.
    target.parentTeamId = source.parentTeamId;
  }
  const sourceName = unitPath(d, { type: 'team', id: sourceId });
  for (const t of childTeams(d, { type: 'team', id: sourceId })) t.parentTeamId = targetId;
  replaceRefEverywhere(d, { type: 'team', id: sourceId }, { type: 'team', id: targetId });
  for (const s of ['notable', 'other'] as const) {
    target.notes[s] = [...target.notes[s], ...source.notes[s]].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  d.teams = d.teams.filter((t) => t.id !== sourceId);
  historyNote(d, { type: 'team', id: targetId }, `Merged in ${sourceName}`);
  touch(target);
  return true;
};

const dropRelationshipsFor = (d: GraphData, refs: Ref[]) => {
  d.relationships = d.relationships.filter((r) => !refs.some((x) => sameRef(x, r.a) || sameRef(x, r.b)));
};

/**
 * Delete a team.
 * - 'moveUp': its people and sub-teams move up to the parent.
 * - 'removeAll': the team and its sub-teams go; people stay but lose those roles.
 */
export const deleteTeam = (d: GraphData, teamId: string, mode: 'moveUp' | 'removeAll'): void => {
  const team = getTeam(d, teamId);
  if (!team) return;
  const parent: Unit = team.parentTeamId ? { type: 'team', id: team.parentTeamId } : { type: 'org', id: team.orgId };
  if (mode === 'moveUp') {
    for (const t of childTeams(d, { type: 'team', id: teamId })) t.parentTeamId = team.parentTeamId;
    for (const p of d.people) {
      for (const r of p.roles) if (sameRef(r.unit, { type: 'team', id: teamId })) r.unit = { ...parent };
      dedupeRoles(p);
    }
    d.teams = d.teams.filter((t) => t.id !== teamId);
    dropRelationshipsFor(d, [{ type: 'team', id: teamId }]);
    return;
  }
  const ids = new Set([teamId, ...descendantTeamIds(d, teamId)]);
  for (const p of d.people) {
    const before = p.roles.length;
    p.roles = p.roles.filter((r) => !(r.unit.type === 'team' && ids.has(r.unit.id)));
    if (p.roles.length !== before) normalizePrimary(p);
  }
  d.teams = d.teams.filter((t) => !ids.has(t.id));
  dropRelationshipsFor(d, [...ids].map((id) => ({ type: 'team' as const, id })));
};

/** Delete an org and all its teams. People stay (they become unaffiliated if this was their only place). */
export const deleteOrg = (d: GraphData, orgId: string): void => {
  const teamIds = new Set(d.teams.filter((t) => t.orgId === orgId).map((t) => t.id));
  for (const p of d.people) {
    p.roles = p.roles.filter((r) => !(r.unit.type === 'org' ? r.unit.id === orgId : teamIds.has(r.unit.id)));
    normalizePrimary(p);
  }
  d.teams = d.teams.filter((t) => !teamIds.has(t.id));
  d.orgs = d.orgs.filter((o) => o.id !== orgId);
  dropRelationshipsFor(d, [{ type: 'org', id: orgId }, ...[...teamIds].map((id) => ({ type: 'team' as const, id }))]);
};

export const deletePerson = (d: GraphData, personId: string): void => {
  d.people = d.people.filter((p) => p.id !== personId);
  dropRelationshipsFor(d, [{ type: 'person', id: personId }]);
};

export const setOrgPosition = (d: GraphData, orgId: string, pos: { x: number; y: number }): void => {
  const o = getOrg(d, orgId);
  if (o) o.position = { x: Math.round(pos.x), y: Math.round(pos.y) };
};

// ---------- relationships ----------

export const addRelationship = (
  d: GraphData,
  input: { a: Ref; b: Ref; directed: boolean; description: string },
): string | undefined => {
  if (sameRef(input.a, input.b) || !input.description.trim()) return;
  const id = uid();
  const t = nowIso();
  d.relationships.push({
    id,
    a: { ...input.a },
    b: { ...input.b },
    directed: input.directed,
    description: input.description.trim(),
    createdAt: t,
    updatedAt: t,
  });
  return id;
};

export const updateRelationship = (
  d: GraphData,
  id: string,
  patch: { description?: string; directed?: boolean; swap?: boolean },
): void => {
  const r = d.relationships.find((x) => x.id === id);
  if (!r) return;
  if (patch.description !== undefined && patch.description.trim()) r.description = patch.description.trim();
  if (patch.directed !== undefined) r.directed = patch.directed;
  if (patch.swap) [r.a, r.b] = [r.b, r.a];
  touch(r);
};

export const deleteRelationship = (d: GraphData, id: string): void => {
  d.relationships = d.relationships.filter((r) => r.id !== id);
};
