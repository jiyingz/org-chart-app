import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import type { CanvasNodeData, LeaderLink } from '../model/layout';
import { useStore } from '../store';
import { IconBuilding, IconLink, IconStar, IconUsers } from '../ui/icons';

type Data<K extends CanvasNodeData['kind']> = Extract<CanvasNodeData, { kind: K }>;

const Handles = () => (
  <>
    <Handle type="target" position={Position.Top} isConnectable={false} />
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
  </>
);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

function Leaders({ leaders }: { leaders: LeaderLink[] }) {
  const open = useStore((s) => s.open);
  if (!leaders.length) return <div className="card-sub faint">No leader added</div>;
  return (
    <div className="card-sub">
      <IconStar className="star" size={11} /> Led by{' '}
      {leaders.map((l, i) => (
        <span key={l.personId}>
          {i > 0 && ', '}
          <button
            className="leader-link nodrag"
            title={l.title}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              open({ kind: 'entity', ref: { type: 'person', id: l.personId } });
            }}
          >
            {l.name}
            {l.tentative ? '?' : ''}
          </button>
        </span>
      ))}
    </div>
  );
}

const Tentative = () => (
  <span className="q-badge" title="Tentative / unconfirmed">
    ?
  </span>
);

export const OrgNode = memo(({ data }: NodeProps & { data: Data<'org'> }) => (
  <div className={`card card-org ${data.tentative ? 'tentative' : ''}`}>
    <Handles />
    <div className="card-kicker">
      <IconBuilding size={13} /> Organization {data.tentative && <Tentative />}
    </div>
    <div className="card-title">{data.name}</div>
    <Leaders leaders={data.leaders} />
  </div>
));

export const TeamNode = memo(({ data }: NodeProps & { data: Data<'team'> }) => (
  <div className={`card card-team ${data.tentative ? 'tentative' : ''}`}>
    <Handles />
    <div className="card-kicker">
      <IconUsers size={13} /> Team {data.tentative && <Tentative />}
    </div>
    <div className="card-title">{data.name}</div>
    <Leaders leaders={data.leaders} />
  </div>
));

export const PersonNode = memo(({ data }: NodeProps & { data: Data<'person'> }) => (
  <div className={`card card-person ${data.tentative ? 'tentative' : ''}`}>
    <Handles />
    <div className="avatar">{initials(data.name)}</div>
    <div>
      <div className="card-title">
        {data.name} {data.isLeader && <IconStar className="star" size={12} />}
      </div>
      {data.subtitle && <div className="card-sub">{data.subtitle}</div>}
    </div>
  </div>
));

export const ChipNode = memo(({ data }: NodeProps & { data: Data<'chip'> }) => (
  <div className="chip-card" title={`${data.name} — also in ${data.path}`}>
    <Handles />
    <IconLink size={14} />
    <span>{data.name}</span>
  </div>
));

export const ClusterNode = memo(({ data }: NodeProps & { data: Data<'cluster'> }) => (
  <div className={`cluster ${data.variant}`}>
    <Handles />
    {data.label}
  </div>
));

export const nodeTypes = {
  org: OrgNode,
  team: TeamNode,
  person: PersonNode,
  chip: ChipNode,
  cluster: ClusterNode,
};
