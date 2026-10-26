import { describe, expect, it } from 'vitest';
import { threeWayMerge } from '../sync/merge';
import { leadersOf, membersOf, primaryMemberRole, unitOptions, unitPath } from './graph';
import { computeLayout } from './layout';
import {
  addNote,
  addOrg,
  addPerson,
  addRelationship,
  addTeam,
  assignRole,
  canMoveTeam,
  deleteOrg,
  deleteTeam,
  insertParentTeam,
  mergeTeam,
  moveTeam,
  renameEntity,
} from './ops';
import { emptyGraph, type GraphData } from './types';

const setup = () => {
  const d = emptyGraph();
  const google = addOrg(d, { name: 'Google' });
  const ads = addTeam(d, { name: 'Ads', parent: { type: 'org', id: google } });
  const cloud = addTeam(d, { name: 'Cloud', parent: { type: 'org', id: google } });
  const alice = addPerson(d, { name: 'Alice', roles: [{ unit: { type: 'team', id: ads }, kind: 'member' }] });
  const sarah = addPerson(d, { name: 'Sarah Chen', roles: [{ unit: { type: 'team', id: ads }, kind: 'member' }] });
  return { d, google, ads, cloud, alice, sarah };
};

describe('paths and options', () => {
  it('labels orgs alone and teams as org/team', () => {
    const { d, google } = setup();
    const empty = addOrg(d, { name: 'Stripe' });
    const labels = unitOptions(d).map((o) => o.label);
    expect(labels).toEqual(['Google', 'Google/Ads', 'Google/Cloud', 'Stripe']);
    expect(unitPath(d, { type: 'org', id: empty })).toBe('Stripe');
    const search = addTeam(d, { name: 'Search', parent: { type: 'team', id: d.teams[0].id } });
    expect(unitPath(d, { type: 'team', id: search })).toBe('Google/Ads/Search');
    expect(d.teams.find((t) => t.id === search)!.orgId).toBe(google);
  });
});

describe('leaders', () => {
  it('Move replaces existing roles; Add keeps them', () => {
    const { d, ads, cloud, sarah, alice } = setup();
    const p = d.people.find((x) => x.id === sarah)!;
    assignRole(d, sarah, { unit: { type: 'team', id: cloud }, kind: 'lead', title: 'Head of Cloud' }, p.roles.map((r) => r.id));
    expect(leadersOf(d, { type: 'team', id: cloud }).map((l) => l.person.name)).toEqual(['Sarah Chen']);
    expect(membersOf(d, { type: 'team', id: ads }).map((l) => l.person.name)).toEqual(['Alice']);
    expect(d.people.find((x) => x.id === sarah)!.notes.other[0].text).toMatch(/Moved from Google\/Ads to lead Google\/Cloud/);

    assignRole(d, alice, { unit: { type: 'team', id: cloud }, kind: 'lead' });
    const a = d.people.find((x) => x.id === alice)!;
    expect(a.roles).toHaveLength(2);
    expect(primaryMemberRole(a)!.unit.id).toBe(ads);
  });
});

describe('restructuring', () => {
  it('renaming keeps everyone attached and records history', () => {
    const { d, ads } = setup();
    renameEntity(d, { type: 'team', id: ads }, 'Ads & Commerce');
    expect(membersOf(d, { type: 'team', id: ads })).toHaveLength(2);
    expect(d.teams.find((t) => t.id === ads)!.notes.other[0].text).toBe('Renamed from "Ads"');
  });

  it('sub-teams leave existing people unplaced in the parent', () => {
    const { d, ads } = setup();
    addTeam(d, { name: 'Search Ads', parent: { type: 'team', id: ads } });
    const layout = computeLayout(d);
    const cluster = layout.nodes.find((n) => n.id === `cluster:team:${ads}`);
    expect(cluster?.data.kind === 'cluster' && cluster.data.label).toBe('Not yet placed (2)');
  });

  it('cannot move a team into itself or its sub-team', () => {
    const { d, ads } = setup();
    const sub = addTeam(d, { name: 'Search Ads', parent: { type: 'team', id: ads } });
    expect(canMoveTeam(d, ads, { type: 'team', id: sub })).toBe(false);
    expect(canMoveTeam(d, ads, { type: 'team', id: ads })).toBe(false);
  });

  it('moving a team across orgs carries its sub-teams', () => {
    const { d, ads } = setup();
    const sub = addTeam(d, { name: 'Search Ads', parent: { type: 'team', id: ads } });
    const alphabet = addOrg(d, { name: 'Alphabet' });
    expect(moveTeam(d, ads, { type: 'org', id: alphabet })).toBe(true);
    expect(unitPath(d, { type: 'team', id: sub })).toBe('Alphabet/Ads/Search Ads');
  });

  it('insert parent and merge', () => {
    const { d, ads, cloud, google } = setup();
    const rd = insertParentTeam(d, ads, 'R&D')!;
    expect(unitPath(d, { type: 'team', id: ads })).toBe('Google/R&D/Ads');
    addRelationship(d, { a: { type: 'team', id: cloud }, b: { type: 'org', id: google }, directed: false, description: 'x' });
    mergeTeam(d, cloud, ads);
    expect(d.teams.find((t) => t.id === cloud)).toBeUndefined();
    expect(d.relationships[0].a).toEqual({ type: 'team', id: ads });
    expect(rd).toBeTruthy();
  });

  it('deleting a team can move people up', () => {
    const { d, ads, google } = setup();
    deleteTeam(d, ads, 'moveUp');
    expect(membersOf(d, { type: 'org', id: google })).toHaveLength(2);
  });

  it('deleting an org leaves people unaffiliated', () => {
    const { d, google } = setup();
    deleteOrg(d, google);
    expect(d.people.every((p) => p.roles.length === 0)).toBe(true);
    const layout = computeLayout(d);
    expect(layout.nodes.find((n) => n.id === 'cluster:unaffiliated')).toBeTruthy();
  });
});

describe('layout', () => {
  it('draws second roles as chips and leaders as links, not cards', () => {
    const { d, cloud, alice, sarah } = setup();
    assignRole(d, alice, { unit: { type: 'team', id: cloud }, kind: 'member' });
    const s = d.people.find((p) => p.id === sarah)!;
    assignRole(d, sarah, { unit: { type: 'team', id: cloud }, kind: 'lead' }, s.roles.map((r) => r.id));
    const layout = computeLayout(d);
    expect(layout.nodes.filter((n) => n.id === `person:${alice}`)).toHaveLength(1);
    expect(layout.nodes.some((n) => n.id.startsWith(`chip:${alice}:`))).toBe(true);
    expect(layout.nodes.some((n) => n.id === `person:${sarah}`)).toBe(false);
    const team = layout.nodes.find((n) => n.id === `team:${cloud}`)!;
    expect(team.data.kind === 'team' && team.data.leaders.map((l) => l.name)).toEqual(['Sarah Chen']);
  });
});

describe('three-way merge', () => {
  const clone = (d: GraphData) => structuredClone(d);

  it('combines independent edits from two devices', () => {
    const { d: base, ads } = setup();
    const mac = clone(base);
    const phone = clone(base);
    addPerson(mac, { name: 'Bob', roles: [{ unit: { type: 'team', id: ads }, kind: 'member' }] });
    renameEntity(phone, { type: 'team', id: ads }, 'Ads & Commerce');
    addNote(phone, { type: 'team', id: ads }, 'notable', 'Launched PMax');
    const { merged, conflicts } = threeWayMerge(base, mac, phone);
    expect(conflicts).toHaveLength(0);
    expect(merged.people.map((p) => p.name).sort()).toEqual(['Alice', 'Bob', 'Sarah Chen']);
    const team = merged.teams.find((t) => t.id === ads)!;
    expect(team.name).toBe('Ads & Commerce');
    expect(team.notes.notable[0].text).toBe('Launched PMax');
  });

  it('merges notes added on both sides without conflict', () => {
    const { d: base, alice } = setup();
    const mac = clone(base);
    const phone = clone(base);
    addNote(mac, { type: 'person', id: alice }, 'other', 'from mac');
    addNote(phone, { type: 'person', id: alice }, 'other', 'from phone');
    const { merged, conflicts } = threeWayMerge(base, mac, phone);
    expect(conflicts).toHaveLength(0);
    expect(merged.people.find((p) => p.id === alice)!.notes.other.map((n) => n.text).sort()).toEqual(['from mac', 'from phone']);
  });

  it('flags the same field edited differently', () => {
    const { d: base, ads } = setup();
    const mac = clone(base);
    const phone = clone(base);
    renameEntity(mac, { type: 'team', id: ads }, 'Ads A');
    renameEntity(phone, { type: 'team', id: ads }, 'Ads B');
    const { conflicts } = threeWayMerge(base, mac, phone);
    expect(conflicts.map((c) => c.id)).toEqual([ads]);
  });

  it('respects deletions and drops dangling roles', () => {
    const { d: base, ads } = setup();
    const mac = clone(base);
    const phone = clone(base);
    deleteTeam(mac, ads, 'removeAll');
    addPerson(phone, { name: 'Bob', roles: [{ unit: { type: 'team', id: ads }, kind: 'member' }] });
    const { merged } = threeWayMerge(base, mac, phone);
    expect(merged.teams.find((t) => t.id === ads)).toBeUndefined();
    expect(merged.people.find((p) => p.name === 'Bob')!.roles).toHaveLength(0);
  });

  it('with no base (first connect) unions both sides', () => {
    const a = emptyGraph();
    addOrg(a, { name: 'A' });
    const b = emptyGraph();
    addOrg(b, { name: 'B' });
    expect(threeWayMerge(null, a, b).merged.orgs.map((o) => o.name).sort()).toEqual(['A', 'B']);
  });
});
