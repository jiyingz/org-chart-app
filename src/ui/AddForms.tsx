import { useMemo, useState } from 'react';
import { addOrg, addPerson, addRelationship, addTeam } from '../model/ops';
import type { Ref, RoleKind, Unit } from '../model/types';
import { useStore } from '../store';
import { IconArrowRight, IconBoth, IconPlus, IconSwap, IconTrash } from './icons';
import { applyLeader, emptyLeader, LeaderField, leaderReady, type LeaderValue } from './Leader';
import { Modal } from './Modal';
import { NotesEditor, useDraftNotes } from './Notes';
import { entityPickerOptions, parseKey, unitPickerOptions } from './options';
import { Picker } from './Picker';

interface FormProps {
  isTop: boolean;
  preset?: Record<string, unknown>;
}

const Field = ({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) => (
  <div className="field">
    <div className="label">
      {label} {optional && <span className="optional">(optional)</span>}
    </div>
    {children}
  </div>
);

// ---------- org & team ----------

export function AddOrgOrTeam({ what, isTop, preset }: FormProps & { what: 'org' | 'team' }) {
  const { data, mutate, close, focusOn } = useStore();
  const [name, setName] = useState('');
  const [parentKey, setParentKey] = useState<string | null>((preset?.parent as string) ?? null);
  const [tentative, setTentative] = useState(false);
  const [leader, setLeader] = useState<LeaderValue>(emptyLeader);
  const notes = useDraftNotes();
  const unitOpts = useMemo(() => unitPickerOptions(data), [data]);
  const noOrgs = what === 'team' && data.orgs.length === 0;

  const valid = name.trim() && (what === 'org' || parentKey) && leaderReady(data, leader);

  const submit = () => {
    if (!valid) return;
    const id = mutate((d) => {
      const id =
        what === 'org'
          ? addOrg(d, { name, tentative, notes: notes.notes })
          : addTeam(d, { name, parent: parseKey(parentKey!) as Unit, tentative, notes: notes.notes });
      applyLeader(d, { type: what, id }, leader);
      return id;
    }, `Added ${name.trim()}`);
    close();
    focusOn({ type: what, id });
  };

  const label = what === 'org' ? 'organization' : 'team';
  return (
    <Modal
      isTop={isTop}
      onClose={close}
      kicker={<span className={`pill ${what}`}>{what === 'org' ? 'Organization' : 'Team'}</span>}
      title={what === 'org' ? 'Add an organization' : 'Add a team'}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            Add {label}
          </button>
        </>
      }
    >
      {noOrgs ? (
        <div className="callout warn">Add an organization first — every team belongs to one.</div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label={what === 'org' ? 'What is the organization called?' : 'What is the team called?'}>
            <input
              className="input"
              autoFocus
              value={name}
              placeholder={what === 'org' ? 'e.g. Google' : 'e.g. Ads'}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {what === 'team' && (
            <Field label="Part of">
              <Picker
                options={unitOpts}
                value={parentKey}
                onChange={setParentKey}
                placeholder="Search organizations and teams"
                emptyText="No organizations or teams match"
              />
              <div className="small faint">Pick a team here to make this a sub-team.</div>
            </Field>
          )}
          <Field label="Led by" optional>
            <LeaderField value={leader} onChange={setLeader} unitName={name} />
          </Field>
          <label className="check" style={{ marginBottom: 16 }}>
            <input type="checkbox" checked={tentative} onChange={(e) => setTentative(e.target.checked)} />
            Tentative — I'm not sure of the details yet
          </label>
          <div className="section">
            <NotesEditor {...notes} />
          </div>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}

// ---------- person ----------

interface RoleDraft {
  key: number;
  unitKey: string | null;
  kind: RoleKind;
  title: string;
}

let roleSeq = 0;
const newRole = (unitKey: string | null = null): RoleDraft => ({ key: ++roleSeq, unitKey, kind: 'member', title: '' });

export function RoleRow({
  role,
  onChange,
  onRemove,
  options,
}: {
  role: RoleDraft;
  onChange(r: RoleDraft): void;
  onRemove?(): void;
  options: ReturnType<typeof unitPickerOptions>;
}) {
  return (
    <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <Picker
        options={options}
        value={role.unitKey}
        onChange={(k) => onChange({ ...role, unitKey: k })}
        placeholder="Search e.g. Google/Ads"
        emptyText="No matching organization or team"
      />
      <div className="row">
        <div className="seg">
          <button type="button" className={role.kind === 'member' ? 'on' : ''} onClick={() => onChange({ ...role, kind: 'member' })}>
            Member
          </button>
          <button type="button" className={role.kind === 'lead' ? 'on' : ''} onClick={() => onChange({ ...role, kind: 'lead' })}>
            ★ Lead
          </button>
        </div>
        <input
          className="input"
          style={{ padding: '7px 10px' }}
          placeholder="Title (optional)"
          value={role.title}
          onChange={(e) => onChange({ ...role, title: e.target.value })}
        />
        {onRemove && (
          <button type="button" className="icon-btn" aria-label="Remove role" onClick={onRemove}>
            <IconTrash size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

export function AddPerson({ isTop, preset }: FormProps) {
  const { data, mutate, close, focusOn } = useStore();
  const [name, setName] = useState((preset?.name as string) ?? '');
  const [roles, setRoles] = useState<RoleDraft[]>(() => [newRole((preset?.unit as string) ?? null)]);
  const [contact, setContact] = useState({ linkedin: '', workEmail: '', personalEmail: '', phone: '' });
  const notes = useDraftNotes();
  const unitOpts = useMemo(() => unitPickerOptions(data), [data]);
  const valid = !!name.trim();

  const submit = () => {
    if (!valid) return;
    const id = mutate(
      (d) =>
        addPerson(d, {
          name,
          ...contact,
          notes: notes.notes,
          roles: roles
            .filter((r) => r.unitKey)
            .map((r) => ({ unit: parseKey(r.unitKey!) as Unit, kind: r.kind, title: r.title.trim() || undefined })),
        }),
      `Added ${name.trim()}`,
    );
    close();
    focusOn({ type: 'person', id });
  };

  return (
    <Modal
      isTop={isTop}
      onClose={close}
      kicker={<span className="pill person">Person</span>}
      title="Add a person"
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            Add person
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Full name">
          <input className="input" autoFocus value={name} placeholder="e.g. Sarah Chen" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Team or organization" optional>
          <div className="list">
            {roles.map((r, i) => (
              <RoleRow
                key={r.key}
                role={r}
                options={unitOpts}
                onChange={(nr) => setRoles((rs) => rs.map((x) => (x.key === r.key ? nr : x)))}
                onRemove={roles.length > 1 || r.unitKey ? () => setRoles((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : [newRole()])) : undefined}
              />
            ))}
          </div>
          <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRoles((rs) => [...rs, newRole()])}>
            <IconPlus size={15} /> Add another role
          </button>
          {data.orgs.length === 0 && <div className="small faint">No organizations yet — you can place them later.</div>}
        </Field>
        <div className="grid2">
          <Field label="LinkedIn" optional>
            <input className="input" value={contact.linkedin} placeholder="linkedin.com/in/…" onChange={(e) => setContact({ ...contact, linkedin: e.target.value })} />
          </Field>
          <Field label="Phone" optional>
            <input className="input" type="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          </Field>
          <Field label="Work email" optional>
            <input className="input" type="email" value={contact.workEmail} onChange={(e) => setContact({ ...contact, workEmail: e.target.value })} />
          </Field>
          <Field label="Personal email" optional>
            <input className="input" type="email" value={contact.personalEmail} onChange={(e) => setContact({ ...contact, personalEmail: e.target.value })} />
          </Field>
        </div>
        <div className="section" style={{ marginTop: 4 }}>
          <NotesEditor {...notes} />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ---------- relationship ----------

export function DirectionToggle({
  directed,
  onToggle,
  onSwap,
}: {
  directed: boolean;
  onToggle(): void;
  onSwap?(): void;
}) {
  return (
    <div className="dir-toggle">
      <button type="button" className="dir-btn" onClick={onToggle} title="Toggle one-way / two-way">
        {directed ? <IconArrowRight /> : <IconBoth />}
        {directed ? 'One-way' : 'Two-way'}
      </button>
      {directed && onSwap && (
        <button type="button" className="dir-btn" onClick={onSwap} title="Swap direction">
          <IconSwap /> Swap
        </button>
      )}
    </div>
  );
}

export function AddRelationship({ isTop, preset }: FormProps) {
  const { data, mutate, close } = useStore();
  const [a, setA] = useState<string | null>((preset?.a as string) ?? null);
  const [b, setB] = useState<string | null>(null);
  const [directed, setDirected] = useState(false);
  const [desc, setDesc] = useState('');
  const opts = useMemo(() => entityPickerOptions(data), [data]);
  const valid = a && b && a !== b && desc.trim();

  const submit = () => {
    if (!valid) return;
    mutate(
      (d) => addRelationship(d, { a: parseKey(a!) as Ref, b: parseKey(b!) as Ref, directed, description: desc }),
      'Relationship added',
    );
    close();
  };

  return (
    <Modal
      isTop={isTop}
      onClose={close}
      title="Add a relationship"
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={submit}>
            Add relationship
          </button>
        </>
      }
    >
      <Field label={directed ? 'From' : 'Between'}>
        <Picker options={opts.filter((o) => o.key !== b)} value={a} onChange={setA} placeholder="Search people, teams, orgs" autoFocus={!a} />
      </Field>
      <DirectionToggle
        directed={directed}
        onToggle={() => setDirected(!directed)}
        onSwap={() => {
          setA(b);
          setB(a);
        }}
      />
      <Field label={directed ? 'To' : 'And'}>
        <Picker options={opts.filter((o) => o.key !== a)} value={b} onChange={setB} placeholder="Search people, teams, orgs" />
      </Field>
      <Field label="Relationship">
        <textarea
          className="input"
          value={desc}
          placeholder={directed ? 'e.g. manages, mentors, introduced me to…' : 'e.g. Worked together at Stripe 2019–2021'}
          onChange={(e) => setDesc(e.target.value)}
        />
      </Field>
      {a && b && directed && (
        <div className="small faint">
          Reads as: <strong>{opts.find((o) => o.key === a)?.label}</strong> → <strong>{opts.find((o) => o.key === b)?.label}</strong>
        </div>
      )}
    </Modal>
  );
}
