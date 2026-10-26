// Turns GraphData into positioned cards + lines for the canvas.
// Each org is the root of its own top-down tree; only the org's position is stored,
// everything below it is laid out automatically so structure changes never need manual tidying.
import { childTeams, leadersOf, membersOf, primaryMemberRole, unitPath } from './graph';
import type { GraphData, Person, Role, Unit } from './types';

export const SIZES = {
  org: { w: 240, h: 84 },
  team: { w: 216, h: 76 },
  person: { w: 184, h: 60 },
  chip: { w: 184, h: 40 },
} as const;

const H_GAP = 28;
const V_GAP = 64;
const TREE_GAP = 120;
const GRID_GAP = 12;
const CLUSTER_PAD = 16;
const CLUSTER_LABEL = 30;
const MAX_INLINE_PEOPLE = 4;
const GRID_COLS = 4;

export interface LeaderLink {
  personId: string;
  name: string;
  title?: string;
  tentative?: boolean;
}

export type CanvasNodeData =
  | { kind: 'org'; id: string; name: string; tentative?: boolean; leaders: LeaderLink[]; treeId: string }
  | { kind: 'team'; id: string; name: string; tentative?: boolean; leaders: LeaderLink[]; treeId: string; unit: Unit }
  | {
      kind: 'person';
      id: string;
      name: string;
      subtitle?: string;
      tentative?: boolean;
      isLeader: boolean;
      roleId?: string;
      treeId: string;
    }
  | { kind: 'chip'; id: string; name: string; roleId: string; path: string; treeId: string }
  | {
      kind: 'cluster';
      label?: string;
      variant: 'plain' | 'unplaced' | 'unaffiliated';
      unit?: Unit;
      treeId: string;
      count: number;
    };

export interface CanvasNode {
  id: string;
  type: CanvasNodeData['kind'];
  position: { x: number; y: number };
  width: number;
  height: number;
  data: CanvasNodeData;
  zIndex?: number;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
}

export interface Layout {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** A box in the tree before it gets absolute coordinates. */
interface Item {
  node: Omit<CanvasNode, 'position'>;
  children: Item[];
  /** Cards drawn inside a cluster frame, positioned relative to the frame. */
  inner?: { node: Omit<CanvasNode, 'position'>; dx: number; dy: number }[];
  subtreeW: number;
}

const leaderLinks = (d: GraphData, unit: Unit): LeaderLink[] =>
  leadersOf(d, unit).map(({ person, role }) => ({
    personId: person.id,
    name: person.name,
    title: role.title,
    tentative: role.tentative,
  }));

const personNode = (p: Person, role: Role | undefined, treeId: string): Omit<CanvasNode, 'position'> => ({
  id: `person:${p.id}`,
  type: 'person',
  width: SIZES.person.w,
  height: SIZES.person.h,
  data: {
    kind: 'person',
    id: p.id,
    name: p.name,
    subtitle: role?.title,
    tentative: role?.tentative,
    isLeader: p.roles.some((r) => r.kind === 'lead'),
    roleId: role?.id,
    treeId,
  },
});

const chipNode = (d: GraphData, p: Person, role: Role, treeId: string): Omit<CanvasNode, 'position'> => ({
  id: `chip:${p.id}:${role.id}`,
  type: 'chip',
  width: SIZES.chip.w,
  height: SIZES.chip.h,
  data: { kind: 'chip', id: p.id, name: p.name, roleId: role.id, path: unitPath(d, role.unit), treeId },
});

const finalize = (item: Item): Item => {
  const childrenW = item.children.reduce((s, c) => s + c.subtreeW, 0) + H_GAP * Math.max(0, item.children.length - 1);
  item.subtreeW = Math.max(item.node.width, childrenW);
  return item;
};

const cluster = (
  id: string,
  cards: Omit<CanvasNode, 'position'>[],
  data: Extract<CanvasNodeData, { kind: 'cluster' }>,
): Item => {
  const cols = Math.min(GRID_COLS, Math.max(1, cards.length));
  const rows = Math.ceil(cards.length / cols);
  const cellW = SIZES.person.w;
  const cellH = SIZES.person.h;
  const top = CLUSTER_PAD + (data.label ? CLUSTER_LABEL : 0);
  const w = CLUSTER_PAD * 2 + cols * cellW + (cols - 1) * GRID_GAP;
  const h = top + CLUSTER_PAD + Math.max(1, rows) * cellH + Math.max(0, rows - 1) * GRID_GAP;
  const inner = cards.map((n, i) => ({
    node: n,
    dx: CLUSTER_PAD + (i % cols) * (cellW + GRID_GAP) + (cellW - n.width) / 2,
    dy: top + Math.floor(i / cols) * (cellH + GRID_GAP) + (cellH - n.height) / 2,
  }));
  return finalize({
    node: { id, type: 'cluster', width: w, height: h, data, zIndex: -1 },
    children: [],
    inner,
    subtreeW: 0,
  });
};

const unitKey = (u: Unit) => `${u.type}:${u.id}`;

/** People cards for a unit: primary-role cards, then link chips for people whose primary role is elsewhere. */
const peopleCards = (d: GraphData, unit: Unit, treeId: string) => {
  const cards: Omit<CanvasNode, 'position'>[] = [];
  const chips: Omit<CanvasNode, 'position'>[] = [];
  for (const { person, role } of membersOf(d, unit)) {
    if (primaryMemberRole(person)?.id === role.id) cards.push(personNode(person, role, treeId));
    else chips.push(chipNode(d, person, role, treeId));
  }
  return [...cards, ...chips];
};

const buildUnit = (d: GraphData, unit: Unit, treeId: string, seen: Set<string>): Item => {
  seen.add(unit.id);
  const node: Omit<CanvasNode, 'position'> =
    unit.type === 'org'
      ? (() => {
          const o = d.orgs.find((x) => x.id === unit.id)!;
          return {
            id: `org:${o.id}`,
            type: 'org' as const,
            width: SIZES.org.w,
            height: SIZES.org.h,
            data: { kind: 'org' as const, id: o.id, name: o.name, tentative: o.tentative, leaders: leaderLinks(d, unit), treeId },
          };
        })()
      : (() => {
          const t = d.teams.find((x) => x.id === unit.id)!;
          return {
            id: `team:${t.id}`,
            type: 'team' as const,
            width: SIZES.team.w,
            height: SIZES.team.h,
            data: {
              kind: 'team' as const,
              id: t.id,
              name: t.name,
              tentative: t.tentative,
              leaders: leaderLinks(d, unit),
              treeId,
              unit,
            },
          };
        })();

  const subs = childTeams(d, unit)
    .filter((t) => !seen.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => buildUnit(d, { type: 'team', id: t.id }, treeId, seen));

  const people = peopleCards(d, unit, treeId);
  const children: Item[] = [...subs];
  if (people.length) {
    if (subs.length) {
      children.push(
        cluster(`cluster:${unitKey(unit)}`, people, {
          kind: 'cluster',
          label: `Not yet placed (${people.length})`,
          variant: 'unplaced',
          unit,
          treeId,
          count: people.length,
        }),
      );
    } else if (people.length <= MAX_INLINE_PEOPLE) {
      for (const p of people) children.push(finalize({ node: p, children: [], subtreeW: 0 }));
    } else {
      children.push(
        cluster(`cluster:${unitKey(unit)}`, people, { kind: 'cluster', variant: 'plain', unit, treeId, count: people.length }),
      );
    }
  }
  return finalize({ node, children, subtreeW: 0 });
};

/** Width/height of a laid-out tree, used to place trees side by side. */
const place = (item: Item, x: number, y: number, out: Layout, parentId?: string): { maxX: number; maxY: number } => {
  const nodeX = x + (item.subtreeW - item.node.width) / 2;
  out.nodes.push({ ...item.node, position: { x: nodeX, y } });
  if (parentId) out.edges.push({ id: `e:${parentId}->${item.node.id}`, source: parentId, target: item.node.id });
  let maxX = x + item.subtreeW;
  let maxY = y + item.node.height;
  for (const inner of item.inner ?? []) {
    out.nodes.push({ ...inner.node, position: { x: nodeX + inner.dx, y: y + inner.dy } });
  }
  const childrenW =
    item.children.reduce((s, c) => s + c.subtreeW, 0) + H_GAP * Math.max(0, item.children.length - 1);
  let cx = x + (item.subtreeW - childrenW) / 2;
  const cy = y + item.node.height + V_GAP;
  for (const c of item.children) {
    const r = place(c, cx, cy, out, item.node.id);
    maxX = Math.max(maxX, r.maxX);
    maxY = Math.max(maxY, r.maxY);
    cx += c.subtreeW + H_GAP;
  }
  return { maxX, maxY };
};

export const UNAFFILIATED_TREE = 'unaffiliated';

export const computeLayout = (d: GraphData): Layout => {
  const out: Layout = { nodes: [], edges: [] };
  const seen = new Set<string>();
  const orgs = [...d.orgs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let nextX = 0;
  // Orgs with saved positions first so new ones can be placed to their right.
  const positioned = orgs.filter((o) => o.position);
  const unpositioned = orgs.filter((o) => !o.position);
  for (const o of positioned) {
    const tree = buildUnit(d, { type: 'org', id: o.id }, o.id, seen);
    const r = place(tree, o.position!.x, o.position!.y, out);
    nextX = Math.max(nextX, r.maxX + TREE_GAP);
  }
  for (const o of unpositioned) {
    const tree = buildUnit(d, { type: 'org', id: o.id }, o.id, seen);
    const r = place(tree, nextX, 0, out);
    nextX = r.maxX + TREE_GAP;
  }
  const loose = d.people
    .filter((p) => p.roles.length === 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => personNode(p, undefined, UNAFFILIATED_TREE));
  if (loose.length) {
    const c = cluster('cluster:unaffiliated', loose, {
      kind: 'cluster',
      label: `Unaffiliated (${loose.length})`,
      variant: 'unaffiliated',
      treeId: UNAFFILIATED_TREE,
      count: loose.length,
    });
    place(c, nextX, 0, out);
  }
  return out;
};

/** The x position of each org's tree, as currently laid out (used by "Tidy up" and when dragging trees). */
export const tidyPositions = (d: GraphData): Record<string, { x: number; y: number }> => {
  const stripped: GraphData = { ...d, orgs: d.orgs.map((o) => ({ ...o, position: undefined })) };
  const layout = computeLayout(stripped);
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of layout.nodes) {
    if (n.data.kind === 'org') {
      // place() centres the org card over its subtree; store the subtree's left edge.
      const tree = layout.nodes.filter((m) => m.data.treeId === n.data.treeId);
      const minX = Math.min(...tree.map((m) => m.position.x));
      out[n.data.id] = { x: minX, y: 0 };
    }
  }
  return out;
};

/** Left edge of an org's tree, from a computed layout. Stored org positions refer to this edge. */
export const treeLeft = (layout: Layout, treeId: string): { x: number; y: number } | undefined => {
  const tree = layout.nodes.filter((m) => m.data.treeId === treeId);
  if (!tree.length) return;
  return { x: Math.min(...tree.map((m) => m.position.x)), y: Math.min(...tree.map((m) => m.position.y)) };
};
