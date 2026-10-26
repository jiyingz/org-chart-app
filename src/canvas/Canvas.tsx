import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type NodeChange,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { leadersOf } from '../model/graph';
import { computeLayout, tidyPositions, treeLeft, type CanvasNode, type CanvasNodeData, type Layout } from '../model/layout';
import { setOrgPosition } from '../model/ops';
import type { Ref } from '../model/types';
import { useStore } from '../store';
import { IconTidy } from '../ui/icons';
import { canDrop, draggedOf, dropTargetOf, performDrop } from './drop';
import { nodeTypes } from './nodes';

type RFNode = Node<CanvasNodeData>;

export const isTouchDevice = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;
const EDGE_ZONE = 36;

const toRF = (layout: Layout, touch: boolean): RFNode[] =>
  layout.nodes.map((n: CanvasNode) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
    width: n.width,
    height: n.height,
    zIndex: n.zIndex,
    draggable: !touch && n.type !== 'cluster',
    selectable: n.type !== 'cluster',
  }));

const nodeIdFor = (layout: Layout, ref: Ref): string | undefined => {
  const direct = `${ref.type}:${ref.id}`;
  if (layout.nodes.some((n) => n.id === direct)) return direct;
  if (ref.type === 'person') {
    // Leader-only people have no card: point at what they lead, else one of their link chips.
    const d = useStore.getState().data;
    for (const u of [...d.orgs.map((o) => ({ type: 'org' as const, id: o.id })), ...d.teams.map((t) => ({ type: 'team' as const, id: t.id }))])
      if (leadersOf(d, u).some((l) => l.person.id === ref.id)) return `${u.type}:${u.id}`;
    return layout.nodes.find((n) => n.data.kind === 'chip' && n.data.id === ref.id)?.id;
  }
};

export function Canvas() {
  const data = useStore((s) => s.data);
  const focus = useStore((s) => s.focus);
  const touch = useMemo(isTouchDevice, []);
  const layout = useMemo(() => computeLayout(data), [data]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const [nodes, setNodes] = useState<RFNode[]>(() => toRF(layout, touch));
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const rf = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Re-lay out whenever the data changes, keeping selection.
  useEffect(() => {
    setNodes((prev) => {
      const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      return toRF(layout, touch).map((n) => (selected.has(n.id) ? { ...n, selected: true } : n));
    });
  }, [layout, touch]);

  const edges: Edge[] = useMemo(
    () => layout.edges.map((e) => ({ ...e, type: 'smoothstep', selectable: false, focusable: false })),
    [layout],
  );

  const onNodesChange = useCallback((changes: NodeChange<RFNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)), []);

  // ---------- shared drag logic ----------

  const drag = useRef<{
    ids: string[];
    org?: { id: string; treeIds: Set<string>; start: Map<string, { x: number; y: number }>; left: { x: number; y: number } };
  } | null>(null);

  const findTarget = useCallback((point: { x: number; y: number }, draggedIds: string[]): RFNode | null => {
    const d = useStore.getState().data;
    const items = draggedIds
      .map((id) => nodesRef.current.find((n) => n.id === id))
      .map((n) => (n ? draggedOf(n.data) : null))
      .filter((x) => !!x);
    if (!items.length) return null;
    let best: RFNode | null = null;
    let bestArea = Infinity;
    for (const n of nodesRef.current) {
      if (draggedIds.includes(n.id)) continue;
      const t = dropTargetOf(n.data);
      if (!t) continue;
      const w = n.width ?? 0;
      const h = n.height ?? 0;
      if (point.x < n.position.x || point.x > n.position.x + w || point.y < n.position.y || point.y > n.position.y + h) continue;
      if (!items.some((i) => canDrop(d, i, t))) continue;
      if (w * h < bestArea) {
        best = n;
        bestArea = w * h;
      }
    }
    return best;
  }, []);

  const beginDrag = useCallback((ids: string[]) => {
    const primary = nodesRef.current.find((n) => n.id === ids[0]);
    if (primary?.data.kind === 'org') {
      const treeId = primary.data.treeId;
      const tree = nodesRef.current.filter((n) => n.data.treeId === treeId);
      drag.current = {
        ids,
        org: {
          id: primary.data.id,
          treeIds: new Set(tree.map((n) => n.id)),
          start: new Map(tree.map((n) => [n.id, { ...n.position }])),
          left: treeLeft(layoutRef.current, treeId) ?? { x: 0, y: 0 },
        },
      };
    } else {
      drag.current = { ids: ids.filter((id) => nodesRef.current.find((n) => n.id === id)?.data.kind !== 'org') };
    }
  }, []);

  /** Move the whole org tree along with its root card. */
  const dragOrgTree = useCallback((rootId: string, rootPos: { x: number; y: number }) => {
    const org = drag.current?.org;
    if (!org) return;
    const s = org.start.get(rootId)!;
    const dx = rootPos.x - s.x;
    const dy = rootPos.y - s.y;
    setNodes((ns) =>
      ns.map((n) => (org.treeIds.has(n.id) ? { ...n, position: { x: org.start.get(n.id)!.x + dx, y: org.start.get(n.id)!.y + dy } } : n)),
    );
    return { dx, dy };
  }, []);

  const endDrag = useCallback(
    (point: { x: number; y: number }, rootPos?: { x: number; y: number }) => {
      const cur = drag.current;
      drag.current = null;
      setDropTarget(null);
      if (!cur) return;
      if (cur.org && rootPos) {
        const s = cur.org.start.get(`org:${cur.org.id}`)!;
        const dx = rootPos.x - s.x;
        const dy = rootPos.y - s.y;
        const { mutate } = useStore.getState();
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2)
          mutate((d) => setOrgPosition(d, cur.org!.id, { x: cur.org!.left.x + dx, y: cur.org!.left.y + dy }));
        return;
      }
      const target = findTarget(point, cur.ids);
      // Snap everything back to the automatic layout; a successful drop re-lays out anyway.
      setNodes((prev) => {
        const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id));
        return toRF(layoutRef.current, touch).map((n) => (selected.has(n.id) ? { ...n, selected: true } : n));
      });
      if (!target) return;
      const items = cur.ids
        .map((id) => nodesRef.current.find((n) => n.id === id))
        .map((n) => (n ? draggedOf(n.data) : null))
        .filter((x) => !!x);
      const t = dropTargetOf(target.data);
      if (t) performDrop(items, t);
    },
    [findTarget, touch],
  );

  // ---------- mouse / trackpad (React Flow's own dragging) ----------

  const flowPoint = useCallback(
    (e: MouseEvent | TouchEvent) => {
      const p = 'changedTouches' in e ? e.changedTouches[0] : e;
      return rf.screenToFlowPosition({ x: p?.clientX ?? 0, y: p?.clientY ?? 0 });
    },
    [rf],
  );

  const onNodeDragStart = useCallback(
    (_: MouseEvent | TouchEvent, node: RFNode, dragged: RFNode[]) => {
      const ids = [node.id, ...dragged.map((n) => n.id).filter((id) => id !== node.id)];
      beginDrag(ids);
    },
    [beginDrag],
  );

  const onNodeDrag = useCallback(
    (e: MouseEvent | TouchEvent, node: RFNode) => {
      if (drag.current?.org) {
        dragOrgTree(node.id, node.position);
        return;
      }
      const t = findTarget(flowPoint(e), drag.current?.ids ?? [node.id]);
      setDropTarget(t?.id ?? null);
    },
    [dragOrgTree, findTarget, flowPoint],
  );

  const onNodeDragStop = useCallback(
    (e: MouseEvent | TouchEvent, node: RFNode) => endDrag(flowPoint(e), node.position),
    [endDrag, flowPoint],
  );

  // ---------- touch: press and hold to pick up ----------

  const suppressClickUntil = useRef(0);

  useEffect(() => {
    if (!touch) return;
    const el = wrapRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number } | null = null;
    let lift: { id: string; grab: { x: number; y: number } } | null = null;
    let last: { x: number; y: number } | null = null;
    let raf = 0;

    const cancelTimer = () => {
      clearTimeout(timer);
      timer = undefined;
    };

    const moveTo = (client: { x: number; y: number }) => {
      if (!lift) return;
      const p = rf.screenToFlowPosition(client);
      const pos = { x: p.x - lift.grab.x, y: p.y - lift.grab.y };
      if (drag.current?.org) dragOrgTree(lift.id, pos);
      else {
        setNodes((ns) => ns.map((n) => (n.id === lift!.id ? { ...n, position: pos } : n)));
        const t = findTarget(p, [lift.id]);
        setDropTarget(t?.id ?? null);
      }
    };

    // Dragging near the screen edge scrolls the canvas so far-away teams are reachable.
    const edgeScroll = () => {
      raf = 0;
      if (!lift || !last) return;
      // Only once the card has actually been carried somewhere, so picking up a card near the edge doesn't scroll.
      if (Math.hypot(last.x - start!.x, last.y - start!.y) < 40) {
        raf = requestAnimationFrame(edgeScroll);
        return;
      }
      const r = el.getBoundingClientRect();
      const vx = last.x < r.left + EDGE_ZONE ? 1 : last.x > r.right - EDGE_ZONE ? -1 : 0;
      const vy = last.y < r.top + EDGE_ZONE + 50 ? 1 : last.y > r.bottom - EDGE_ZONE ? -1 : 0;
      if (vx || vy) {
        const v = rf.getViewport();
        rf.setViewport({ x: v.x + vx * 9, y: v.y + vy * 9, zoom: v.zoom });
        moveTo(last);
      }
      raf = requestAnimationFrame(edgeScroll);
    };

    const onStart = (e: TouchEvent) => {
      cancelTimer();
      if (e.touches.length !== 1 || lift) return;
      const target = e.target as HTMLElement;
      if (target.closest('.leader-link')) return;
      const nodeEl = target.closest('.react-flow__node') as HTMLElement | null;
      const id = nodeEl?.dataset.id;
      const node = id ? nodesRef.current.find((n) => n.id === id) : undefined;
      if (!node || node.data.kind === 'cluster') return;
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY };
      last = start;
      timer = setTimeout(() => {
        timer = undefined;
        const p = rf.screenToFlowPosition(start!);
        lift = { id: node.id, grab: { x: p.x - node.position.x, y: p.y - node.position.y } };
        beginDrag([node.id]);
        setLifted(node.id);
        navigator.vibrate?.(12);
        raf = requestAnimationFrame(edgeScroll);
      }, LONG_PRESS_MS);
    };

    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (lift) {
        // Swallow the gesture so the canvas doesn't pan while carrying a card.
        e.preventDefault();
        e.stopPropagation();
        last = { x: t.clientX, y: t.clientY };
        moveTo(last);
        return;
      }
      if (timer && start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > MOVE_TOLERANCE) cancelTimer();
      if (e.touches.length > 1) cancelTimer();
    };

    const onEnd = () => {
      cancelTimer();
      if (!lift) return;
      cancelAnimationFrame(raf);
      raf = 0;
      const p = rf.screenToFlowPosition(last ?? start!);
      const rootPos = { x: p.x - lift.grab.x, y: p.y - lift.grab.y };
      lift = null;
      setLifted(null);
      suppressClickUntil.current = Date.now() + 500;
      endDrag(p, rootPos);
    };

    el.addEventListener('touchstart', onStart, { capture: true, passive: true });
    el.addEventListener('touchmove', onMove, { capture: true, passive: false });
    el.addEventListener('touchend', onEnd, { capture: true });
    el.addEventListener('touchcancel', onEnd, { capture: true });
    const noMenu = (e: Event) => {
      if ((e.target as HTMLElement).closest('.react-flow__node')) e.preventDefault();
    };
    el.addEventListener('contextmenu', noMenu);
    return () => {
      cancelTimer();
      cancelAnimationFrame(raf);
      el.removeEventListener('touchstart', onStart, { capture: true });
      el.removeEventListener('touchmove', onMove, { capture: true });
      el.removeEventListener('touchend', onEnd, { capture: true });
      el.removeEventListener('touchcancel', onEnd, { capture: true });
      el.removeEventListener('contextmenu', noMenu);
    };
  }, [touch, rf, beginDrag, dragOrgTree, endDrag, findTarget]);

  // ---------- clicks, focus ----------

  const onNodeClick = useCallback((_: React.MouseEvent, node: RFNode) => {
    if (Date.now() < suppressClickUntil.current) return;
    const { open } = useStore.getState();
    const d = node.data;
    if (d.kind === 'org' || d.kind === 'team' || d.kind === 'person' || d.kind === 'chip')
      open({ kind: 'entity', ref: { type: d.kind === 'chip' ? 'person' : d.kind, id: d.id } });
  }, []);

  useEffect(() => {
    if (!focus) return;
    const id = nodeIdFor(layoutRef.current, focus.ref);
    const n = id && layoutRef.current.nodes.find((x) => x.id === id);
    if (!n) return;
    void rf.setCenter(n.position.x + n.width / 2, n.position.y + n.height / 2, {
      zoom: Math.max(rf.getZoom(), 0.9),
      duration: 500,
    });
    setFlash(n.id);
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [focus, rf]);

  const tidy = () => {
    const pos = tidyPositions(useStore.getState().data);
    useStore.getState().mutate((d) => {
      for (const [id, p] of Object.entries(pos)) setOrgPosition(d, id, p);
    }, 'Tidied up the map');
    setTimeout(() => void rf.fitView({ padding: 0.2, duration: 400, maxZoom: 1 }), 50);
  };

  const shown = useMemo(
    () =>
      nodes.map((n) => {
        const cls = [n.id === dropTarget && 'drop-target', n.id === lifted && 'lifted', n.id === flash && 'flash']
          .filter(Boolean)
          .join(' ');
        return cls ? { ...n, className: cls } : n;
      }),
    [nodes, dropTarget, lifted, flash],
  );

  return (
    <div className="canvas" ref={wrapRef}>
      <ReactFlow
        nodes={shown}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        nodeDragThreshold={4}
        panOnScroll={!touch}
        zoomOnPinch
        zoomOnDoubleClick={false}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Meta', 'Shift']}
        deleteKeyCode={null}
        minZoom={0.1}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#d4deea" />
        <Controls showInteractive={false} position="bottom-left" style={{ marginBottom: 'calc(14px + var(--safe-bottom))' }} />
        {!touch && (
          <MiniMap
            position="bottom-left"
            style={{ left: 56, bottom: 0 }}
            pannable
            zoomable
            nodeBorderRadius={8}
            maskColor="rgba(245,248,252,0.7)"
            nodeColor={(n) =>
              n.type === 'org' ? '#f2b544' : n.type === 'team' ? '#8bcb6a' : n.type === 'cluster' ? 'transparent' : '#8dbde8'
            }
          />
        )}
      </ReactFlow>
      <div className="canvas-tools" style={{ left: touch ? 62 : 270 }}>
        <div className="toolbar">
          <button className="tbtn" onClick={tidy} title="Tidy up the map" aria-label="Tidy up">
            <IconTidy />
          </button>
        </div>
      </div>
    </div>
  );
}
