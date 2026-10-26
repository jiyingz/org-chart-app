// What happens when a card is dropped onto another card.
import { getPerson, getTeam, sameRef, unitPath } from '../model/graph';
import type { CanvasNodeData } from '../model/layout';
import { assignRole, canMoveTeam, moveTeam, removeRole } from '../model/ops';
import type { GraphData, Unit } from '../model/types';
import { useStore } from '../store';

/** Where a drop lands: an org/team (or a people frame belonging to one), or the "Unaffiliated" area. */
export type DropTarget = { kind: 'unit'; unit: Unit } | { kind: 'unaffiliated' };

export const dropTargetOf = (data: CanvasNodeData): DropTarget | null => {
  if (data.kind === 'org') return { kind: 'unit', unit: { type: 'org', id: data.id } };
  if (data.kind === 'team') return { kind: 'unit', unit: { type: 'team', id: data.id } };
  if (data.kind === 'cluster') {
    if (data.variant === 'unaffiliated') return { kind: 'unaffiliated' };
    if (data.unit) return { kind: 'unit', unit: data.unit };
  }
  return null;
};

/** Things that can be picked up. Orgs are roots and only reposition, so they're handled separately. */
type Dragged = { kind: 'person'; personId: string; roleId?: string } | { kind: 'team'; teamId: string };

export const draggedOf = (data: CanvasNodeData): Dragged | null => {
  if (data.kind === 'person') return { kind: 'person', personId: data.id, roleId: data.roleId };
  if (data.kind === 'chip') return { kind: 'person', personId: data.id, roleId: data.roleId };
  if (data.kind === 'team') return { kind: 'team', teamId: data.id };
  return null;
};

export const canDrop = (d: GraphData, item: Dragged, target: DropTarget): boolean => {
  if (item.kind === 'team') return target.kind === 'unit' && canMoveTeam(d, item.teamId, target.unit);
  const p = getPerson(d, item.personId);
  if (!p) return false;
  if (target.kind === 'unaffiliated') return !!item.roleId;
  return !p.roles.some((r) => r.kind === 'member' && sameRef(r.unit, target.unit));
};

export const performDrop = (items: Dragged[], target: DropTarget): void => {
  const { data, mutate, open } = useStore.getState();
  const valid = items.filter((i) => canDrop(data, i, target));
  if (!valid.length) return;

  const teams = valid.filter((i): i is Extract<Dragged, { kind: 'team' }> => i.kind === 'team');
  const people = valid.filter((i): i is Extract<Dragged, { kind: 'person' }> => i.kind === 'person');

  if (teams.length && target.kind === 'unit') {
    const label = teams.length === 1 ? getTeam(data, teams[0].teamId)!.name : `${teams.length} teams`;
    mutate((d) => {
      for (const t of teams) moveTeam(d, t.teamId, target.unit);
    }, `Moved ${label} to ${unitPath(data, target.unit)}`);
  }
  if (!people.length) return;

  if (target.kind === 'unaffiliated') {
    mutate((d) => {
      for (const p of people) if (p.roleId) removeRole(d, p.personId, p.roleId);
    }, people.length === 1 ? `Removed ${getPerson(data, people[0].personId)!.name} from that team` : 'Removed from their teams');
    return;
  }

  const dest = unitPath(useStore.getState().data, target.unit);
  const names = people.map((p) => getPerson(data, p.personId)!.name);
  const who = names.length === 1 ? names[0] : `${names.length} people`;
  const add = (replace: boolean) =>
    useStore.getState().mutate((d) => {
      for (const p of people)
        assignRole(d, p.personId, { unit: target.unit, kind: 'member' }, replace && p.roleId ? [p.roleId] : []);
    }, `${replace ? 'Moved' : 'Added'} ${who} to ${dest}`);

  // People with no role yet (from "Unaffiliated") just get placed — nothing to choose.
  if (people.every((p) => !p.roleId)) {
    add(false);
    return;
  }

  const current =
    people.length === 1 && people[0].roleId
      ? (() => {
          const r = getPerson(data, people[0].personId)!.roles.find((x) => x.id === people[0].roleId);
          return r ? unitPath(data, r.unit) : undefined;
        })()
      : undefined;
  open({
    kind: 'choice',
    title: `${who} → ${dest}`,
    body: current ? `${names[0]} is currently in ${current}.` : undefined,
    options: [
      {
        label: 'Move',
        detail: current ? `Leaves ${current} and joins ${dest}` : `Leaves their current team and joins ${dest}`,
        tone: 'primary',
        run: () => add(true),
      },
      {
        label: 'Add as a second role',
        detail: current ? `Stays in ${current} and also joins ${dest}` : `Keeps their current team too`,
        run: () => add(false),
      },
    ],
  });
};
