import { useMemo, useState } from 'react';
import {
  childTeams,
  descendantTeamIds,
  entityName,
  formatDate,
  getEntity,
  getTeam,
  leadersOf,
  membersOf,
  relationshipsOf,
  sameRef,
  unitPath,
} from '../model/graph';
import {
  addNote,
  assignRole,
  deleteOrg,
  deletePerson,
  deleteRelationship,
  deleteTeam,
  insertParentTeam,
  mergeTeam,
  moveTeam,
  removeNote,
  removeRole,
  renameEntity,
  setTentative,
  updatePersonContact,
  updateRelationship,
  updateRole,
  canMoveTeam,
} from '../model/ops';
import type { Org, Person, Ref, Relationship, Role, Team, Unit } from '../model/types';
import { useStore } from '../store';
import { DirectionToggle, RoleRow } from './AddForms';
import { IconArrowRight, IconBoth, IconChevronRight, IconEdit, IconPlus, IconStar, IconTrash } from './icons';
import { applyLeader, emptyLeader, LeaderField, leaderChosen, leaderReady, type LeaderValue } from './Leader';
import { Modal } from './Modal';
import { NotesEditor } from './Notes';
import { parseKey, refKey, unitPickerOptions } from './options';

const typeLabel = { org: 'Organization', team: 'Team', person: 'Person' } as const;

export function EntityChip({ entity }: { entity: Ref }) {
  const data = useStore((s) => s.data);
  const open = useStore((s) => s.open);
  return (
    <button className="ent" onClick={() => open({ kind: 'entity', ref: entity })}>
      <span className={`ent-dot ${entity.type}`} />
      <span>{entityName(data, entity)}</span>
    </button>
  );
}

export function EntityModal({ entity, view = 'details', isTop }: { entity: Ref; view?: 'details' | 'relationships'; isTop: boolean }) {
  const { data, close, modals, replaceTop } = useStore();
  const e = getEntity(data, entity);
  const onBack = modals.length > 1 ? close : undefined;
  if (!e) {
    return (
      <Modal isTop={isTop} onClose={close} onBack={onBack} title="Not found" size="narrow">
        <p className="faint">This was deleted.</p>
      </Modal>
    );
  }
  if (view === 'relationships')
    return (
      <RelationshipsView
        entity={entity}
        isTop={isTop}
        onBack={() => replaceTop({ kind: 'entity', ref: entity, view: 'details' })}
      />
    );
  return entity.type === 'person' ? (
    <PersonView person={e as Person} isTop={isTop} onBack={onBack} />
  ) : (
    <UnitView unit={entity as Unit} entity={e as Org | Team} isTop={isTop} onBack={onBack} />
  );
}

// ---------- shared bits ----------

function Header({
  entity,
  name,
  tentative,
  subtitle,
  star,
  editable,
}: {
  entity: Ref;
  name: string;
  tentative?: boolean;
  subtitle?: React.ReactNode;
  star?: boolean;
  editable?: boolean;
}) {
  const mutate = useStore((s) => s.mutate);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [tent, setTent] = useState(!!tentative);
  const save = () => {
    mutate((d) => {
      renameEntity(d, entity, draft);
      setTentative(d, entity, tent);
    });
    setEditing(false);
  };
  return (
    <div>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className={`pill ${entity.type}`}>{typeLabel[entity.type]}</span>
        {tentative && <span className="pill tent">? Tentative</span>}
      </div>
      {editing ? (
        <div style={{ marginTop: 2 }}>
          <input
            className="input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
          />
          {entity.type !== 'person' && (
            <label className="check" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={tent} onChange={(e) => setTent(e.target.checked)} /> Tentative
            </label>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary sm" onClick={save} disabled={!draft.trim()}>
              Save
            </button>
            <button className="btn sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ alignItems: 'center' }}>
          <h2>
            {name} {star && <IconStar className="star" size={16} />}
          </h2>
          {editable !== false && (
            <button
              className="icon-btn sm"
              aria-label="Edit name"
              onClick={() => {
                setDraft(name);
                setTent(!!tentative);
                setEditing(true);
              }}
            >
              <IconEdit size={15} />
            </button>
          )}
        </div>
      )}
      {subtitle && <div className="small faint" style={{ marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function NotesSection({ entity, e }: { entity: Ref; e: { notes: Person['notes'] } }) {
  const mutate = useStore((s) => s.mutate);
  return (
    <Section title="Notes">
      <NotesEditor
        notes={e.notes}
        onAdd={(s, t) => mutate((d) => addNote(d, entity, s, t))}
        onRemove={(s, id) => mutate((d) => removeNote(d, entity, s, id))}
      />
    </Section>
  );
}

function RelationshipsLink({ entity }: { entity: Ref }) {
  const data = useStore((s) => s.data);
  const replaceTop = useStore((s) => s.replaceTop);
  const n = relationshipsOf(data, entity).length;
  return (
    <div className="section" style={{ marginTop: 14 }}>
      <button className="link-arrow" onClick={() => replaceTop({ kind: 'entity', ref: entity, view: 'relationships' })}>
        See relationships{n ? ` (${n})` : ''} <IconChevronRight size={16} />
      </button>
    </div>
  );
}

// ---------- orgs & teams ----------

function UnitView({ unit, entity, isTop, onBack }: { unit: Unit; entity: Org | Team; isTop: boolean; onBack?: () => void }) {
  const { data, mutate, close, open } = useStore();
  const leaders = leadersOf(data, unit);
  const members = membersOf(data, unit);
  const subs = childTeams(data, unit).sort((a, b) => a.name.localeCompare(b.name));
  const team = unit.type === 'team' ? (entity as Team) : undefined;

  const parentChain = useMemo(() => {
    if (!team) return [];
    const chain: Ref[] = [{ type: 'org', id: team.orgId }];
    const ups: Ref[] = [];
    let t = team.parentTeamId ? getTeam(data, team.parentTeamId) : undefined;
    while (t) {
      ups.unshift({ type: 'team', id: t.id });
      t = t.parentTeamId ? getTeam(data, t.parentTeamId) : undefined;
    }
    return [...chain, ...ups];
  }, [data, team]);

  const footer = (
    <>
      {team && (
        <>
          <button
            className="btn sm"
            onClick={() =>
              open({
                kind: 'pickUnit',
                title: `Move ${team.name} to…`,
                body: 'Its sub-teams and people move with it.',
                exclude: (u) => !canMoveTeam(data, team.id, u),
                onPick: (u) => mutate((d) => moveTeam(d, team.id, u), `Moved ${team.name}`),
              })
            }
          >
            Move to…
          </button>
          <button
            className="btn sm"
            onClick={() =>
              open({
                kind: 'prompt',
                title: 'Insert a parent team',
                label: `New team that ${team.name} sits inside`,
                placeholder: 'e.g. R&D',
                submitLabel: 'Insert',
                onSubmit: (v) => mutate((d) => insertParentTeam(d, team.id, v), `Added ${v} above ${team.name}`),
              })
            }
          >
            Insert parent…
          </button>
          <button
            className="btn sm"
            onClick={() =>
              open({
                kind: 'pickUnit',
                title: `Merge ${team.name} into…`,
                body: `Everything in ${team.name} — people, sub-teams, notes, relationships — moves into the team you pick, then ${team.name} is removed.`,
                teamsOnly: true,
                exclude: (u) => u.type !== 'team' || u.id === team.id,
                onPick: (u) => {
                  close();
                  mutate((d) => mergeTeam(d, team.id, u.id), `Merged ${team.name} into ${unitPath(data, u)}`);
                },
              })
            }
          >
            Merge into…
          </button>
        </>
      )}
      <span className="spacer" />
      <button
        className="btn sm danger"
        onClick={() => {
          if (team) {
            const parent = unitPath(data, team.parentTeamId ? { type: 'team', id: team.parentTeamId } : { type: 'org', id: team.orgId });
            const nSubs = descendantTeamIds(data, team.id).size;
            open({
              kind: 'choice',
              title: `Delete ${team.name}?`,
              body: 'You can undo this until you next save.',
              options: [
                {
                  label: `Delete, and move everyone up to ${parent}`,
                  detail: 'People and sub-teams are kept, one level up.',
                  tone: 'primary',
                  run: () => {
                    close();
                    mutate((d) => deleteTeam(d, team.id, 'moveUp'), `Deleted ${team.name}`);
                  },
                },
                {
                  label: nSubs ? `Delete it and its ${nSubs} sub-team${nSubs > 1 ? 's' : ''}` : 'Delete the team only',
                  detail: 'People stay on the map but leave these teams.',
                  tone: 'danger',
                  run: () => {
                    close();
                    mutate((d) => deleteTeam(d, team.id, 'removeAll'), `Deleted ${team.name}`);
                  },
                },
              ],
            });
          } else {
            const nTeams = data.teams.filter((t) => t.orgId === unit.id).length;
            open({
              kind: 'choice',
              title: `Delete ${entity.name}?`,
              body: `${nTeams ? `Its ${nTeams} team${nTeams > 1 ? 's' : ''} will be deleted too. ` : ''}People stay on the map (as unaffiliated if they had no other role). You can undo this until you next save.`,
              options: [
                {
                  label: 'Delete organization',
                  tone: 'danger',
                  run: () => {
                    close();
                    mutate((d) => deleteOrg(d, unit.id), `Deleted ${entity.name}`);
                  },
                },
              ],
            });
          }
        }}
      >
        <IconTrash size={15} /> Delete
      </button>
    </>
  );

  return (
    <Modal
      isTop={isTop}
      onClose={close}
      onBack={onBack}
      footer={footer}
      title={
        <Header
          entity={unit}
          name={entity.name}
          tentative={entity.tentative}
          subtitle={
            parentChain.length > 0 && (
              <span className="row wrap" style={{ gap: 4 }}>
                Part of{' '}
                {parentChain.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ' / '}
                    <button className="leader-link" onClick={() => open({ kind: 'entity', ref: r })}>
                      {entityName(data, r)}
                    </button>
                  </span>
                ))}
              </span>
            )
          }
        />
      }
    >
      <LeadersSection unit={unit} name={entity.name} leaders={leaders} />

      <Section
        title={unit.type === 'org' ? 'Teams' : 'Sub-teams'}
        action={
          <button className="btn ghost sm" onClick={() => open({ kind: 'add', what: 'team', preset: { parent: refKey(unit) } })}>
            <IconPlus size={15} /> {unit.type === 'org' ? 'Add team' : 'Add sub-team'}
          </button>
        }
      >
        {subs.length ? (
          <div className="chips">
            {subs.map((t) => (
              <EntityChip key={t.id} entity={{ type: 'team', id: t.id }} />
            ))}
          </div>
        ) : (
          <div className="small faint">None yet</div>
        )}
      </Section>

      <Section
        title={subs.length ? 'People (not yet placed in a sub-team)' : 'People'}
        action={
          <button className="btn ghost sm" onClick={() => open({ kind: 'add', what: 'person', preset: { unit: refKey(unit) } })}>
            <IconPlus size={15} /> Add person here
          </button>
        }
      >
        {members.length ? (
          <div className="chips">
            {members.map(({ person, role }) => (
              <EntityChip key={role.id} entity={{ type: 'person', id: person.id }} />
            ))}
          </div>
        ) : (
          <div className="small faint">None yet</div>
        )}
      </Section>

      <RelationshipsLink entity={unit} />
      <NotesSection entity={unit} e={entity} />
    </Modal>
  );
}

function LeadersSection({ unit, name, leaders }: { unit: Unit; name: string; leaders: ReturnType<typeof leadersOf> }) {
  const { data, mutate, open } = useStore();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState<LeaderValue>(emptyLeader);
  const [previous, setPrevious] = useState<'keep' | 'member' | 'remove'>('member');

  const save = () => {
    mutate((d) => {
      if (leaders.length && previous !== 'keep') {
        for (const { person, role } of leaders) {
          if (previous === 'member') updateRole(d, person.id, role.id, { kind: 'member' });
          else removeRole(d, person.id, role.id);
        }
      }
      applyLeader(d, unit, value);
    }, 'Leader updated');
    setAdding(false);
    setValue(emptyLeader());
  };

  return (
    <Section
      title="Led by"
      action={
        !adding && (
          <button className="btn ghost sm" onClick={() => setAdding(true)}>
            <IconPlus size={15} /> {leaders.length ? 'Change / add leader' : 'Add leader'}
          </button>
        )
      }
    >
      {leaders.length === 0 && !adding && <div className="small faint">No leader added yet</div>}
      <div className="list">
        {leaders.map(({ person, role }) => (
          <div className="list-row" key={role.id}>
            <IconStar className="star" />
            <div className="grow">
              <button className="leader-link" style={{ fontSize: 14.5 }} onClick={() => open({ kind: 'entity', ref: { type: 'person', id: person.id } })}>
                {person.name}
              </button>
              {role.title && <span className="small faint"> · {role.title}</span>}
              {role.tentative && <span className="small faint"> · tentative</span>}
            </div>
            <button
              className="btn sm"
              title="Keep them here as a member instead"
              onClick={() => mutate((d) => updateRole(d, person.id, role.id, { kind: 'member' }), `${person.name} is now a member`)}
            >
              Make member
            </button>
            <button
              className="icon-btn sm"
              aria-label="Remove leader"
              onClick={() => mutate((d) => removeRole(d, person.id, role.id), `${person.name} removed as leader`)}
            >
              <IconTrash size={15} />
            </button>
          </div>
        ))}
      </div>
      {adding && (
        <div className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', marginTop: 8, gap: 10 }}>
          <LeaderField value={value} onChange={setValue} unitName={name} excludePersonIds={leaders.map((l) => l.person.id)} />
          {leaders.length > 0 && leaderChosen(value) && (
            <div className="list">
              <div className="small faint">And the current leader{leaders.length > 1 ? 's' : ''} ({leaders.map((l) => l.person.name).join(', ')})?</div>
              {(
                [
                  ['member', 'Stays here as a member'],
                  ['remove', `Leaves ${name}`],
                  ['keep', 'Stays as co-lead'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className={`choice ${previous === k ? 'on' : ''}`}>
                  <input type="radio" checked={previous === k} onChange={() => setPrevious(k)} /> {label}
                </label>
              ))}
            </div>
          )}
          <div className="row">
            <button className="btn primary sm" disabled={!leaderChosen(value) || !leaderReady(data, value)} onClick={save}>
              Save leader
            </button>
            <button
              className="btn sm"
              onClick={() => {
                setAdding(false);
                setValue(emptyLeader());
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

// ---------- people ----------

const normalizeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

function PersonView({ person, isTop, onBack }: { person: Person; isTop: boolean; onBack?: () => void }) {
  const { mutate, close, open } = useStore();
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState({
    linkedin: person.linkedin ?? '',
    workEmail: person.workEmail ?? '',
    personalEmail: person.personalEmail ?? '',
    phone: person.phone ?? '',
  });
  const ref: Ref = { type: 'person', id: person.id };
  const titles = person.roles.filter((r) => r.title).map((r) => r.title);
  const isLead = person.roles.some((r) => r.kind === 'lead');

  const startEdit = () => {
    setContact({
      linkedin: person.linkedin ?? '',
      workEmail: person.workEmail ?? '',
      personalEmail: person.personalEmail ?? '',
      phone: person.phone ?? '',
    });
    setEditing(true);
  };

  const rows: [string, string | undefined, (v: string) => string | undefined][] = [
    ['LinkedIn', person.linkedin, (v) => normalizeUrl(v)],
    ['Work email', person.workEmail, (v) => `mailto:${v}`],
    ['Personal email', person.personalEmail, (v) => `mailto:${v}`],
    ['Phone', person.phone, (v) => `tel:${v.replace(/[^\d+]/g, '')}`],
  ];

  return (
    <Modal
      isTop={isTop}
      onClose={close}
      onBack={onBack}
      title={<Header entity={ref} name={person.name} star={isLead} subtitle={titles.join(' · ') || undefined} />}
      footer={
        <>
          <span className="spacer" />
          <button
            className="btn sm danger"
            onClick={() =>
              open({
                kind: 'choice',
                title: `Delete ${person.name}?`,
                body: 'Their relationships are deleted too. You can undo this until you next save.',
                options: [
                  {
                    label: 'Delete person',
                    tone: 'danger',
                    run: () => {
                      close();
                      mutate((d) => deletePerson(d, person.id), `Deleted ${person.name}`);
                    },
                  },
                ],
              })
            }
          >
            <IconTrash size={15} /> Delete
          </button>
        </>
      }
    >
      <RolesSection person={person} />

      <Section
        title="Contact"
        action={
          !editing && (
            <button className="btn ghost sm" onClick={startEdit}>
              <IconEdit size={14} /> Edit
            </button>
          )
        }
      >
        {editing ? (
          <div>
            <div className="grid2">
              {(
                [
                  ['linkedin', 'LinkedIn', 'text'],
                  ['phone', 'Phone', 'tel'],
                  ['workEmail', 'Work email', 'email'],
                  ['personalEmail', 'Personal email', 'email'],
                ] as const
              ).map(([k, label, type]) => (
                <div className="field" key={k}>
                  <div className="label">{label}</div>
                  <input className="input" type={type} value={contact[k]} onChange={(e) => setContact({ ...contact, [k]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="row">
              <button
                className="btn primary sm"
                onClick={() => {
                  mutate((d) => updatePersonContact(d, person.id, contact));
                  setEditing(false);
                }}
              >
                Save
              </button>
              <button className="btn sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : rows.some(([, v]) => v) ? (
          <dl className="contact">
            {rows
              .filter(([, v]) => v)
              .map(([label, v, href]) => (
                <div key={label} style={{ display: 'contents' }}>
                  <dt>{label}</dt>
                  <dd>
                    <a href={href(v!)} target={label === 'LinkedIn' ? '_blank' : undefined} rel="noreferrer">
                      {v}
                    </a>
                  </dd>
                </div>
              ))}
          </dl>
        ) : (
          <div className="small faint">No contact details yet</div>
        )}
      </Section>

      <RelationshipsLink entity={ref} />
      <NotesSection entity={ref} e={person} />
    </Modal>
  );
}

function RolesSection({ person }: { person: Person }) {
  const { data, mutate, open } = useStore();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const unitOpts = useMemo(() => unitPickerOptions(data), [data]);
  const memberCount = person.roles.filter((r) => r.kind === 'member').length;

  return (
    <Section
      title="Roles"
      action={
        editingId === null && (
          <button className="btn ghost sm" onClick={() => setEditingId('new')}>
            <IconPlus size={15} /> Add role
          </button>
        )
      }
    >
      {person.roles.length === 0 && editingId === null && (
        <div className="small faint">Not part of any team or organization yet (shown under “Unaffiliated”).</div>
      )}
      <div className="list">
        {person.roles.map((r) =>
          editingId === r.id ? (
            <RoleEditor key={r.id} person={person} role={r} options={unitOpts} onDone={() => setEditingId(null)} />
          ) : (
            <div className="list-row" key={r.id}>
              {r.kind === 'lead' ? <IconStar className="star" /> : <span className={`ent-dot ${r.unit.type}`} style={{ width: 9, height: 9, borderRadius: 9 }} />}
              <div className="grow">
                <button className="leader-link" style={{ fontSize: 14.5, textAlign: 'left' }} onClick={() => open({ kind: 'entity', ref: r.unit })}>
                  {r.kind === 'lead' ? 'Lead, ' : ''}
                  {unitPath(data, r.unit)}
                </button>
                <div className="small faint">
                  {[r.title, r.tentative && 'tentative', r.primary && memberCount > 1 && 'main card on the map'].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button className="icon-btn sm" aria-label="Edit role" onClick={() => setEditingId(r.id)}>
                <IconEdit size={15} />
              </button>
              <button className="icon-btn sm" aria-label="Remove role" onClick={() => mutate((d) => removeRole(d, person.id, r.id), 'Role removed')}>
                <IconTrash size={15} />
              </button>
            </div>
          ),
        )}
        {editingId === 'new' && <RoleEditor person={person} options={unitOpts} onDone={() => setEditingId(null)} />}
      </div>
    </Section>
  );
}

function RoleEditor({
  person,
  role,
  options,
  onDone,
}: {
  person: Person;
  role?: Role;
  options: ReturnType<typeof unitPickerOptions>;
  onDone(): void;
}) {
  const mutate = useStore((s) => s.mutate);
  const [draft, setDraft] = useState({
    key: 0,
    unitKey: role ? refKey(role.unit) : null,
    kind: role?.kind ?? ('member' as const),
    title: role?.title ?? '',
  });
  const [tentative, setTent] = useState(!!role?.tentative);
  const [primary, setPrimary] = useState(!!role?.primary);
  const others = person.roles.filter((r) => r.kind === 'member' && r.id !== role?.id).length;

  const save = () => {
    if (!draft.unitKey) return;
    const unit = parseKey(draft.unitKey) as Unit;
    mutate((d) => {
      if (role) updateRole(d, person.id, role.id, { unit, kind: draft.kind, title: draft.title, tentative, primary });
      else {
        const id = assignRole(d, person.id, { unit, kind: draft.kind, title: draft.title, tentative });
        if (id && primary) updateRole(d, person.id, id, { primary: true });
      }
    });
    onDone();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <RoleRow role={draft} options={options} onChange={(r) => setDraft({ ...draft, ...r })} />
      <div className="row wrap" style={{ gap: 14 }}>
        <label className="check">
          <input type="checkbox" checked={tentative} onChange={(e) => setTent(e.target.checked)} /> Tentative
        </label>
        {draft.kind === 'member' && others > 0 && (
          <label className="check">
            <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} /> Show their main card here
          </label>
        )}
      </div>
      <div className="row">
        <button className="btn primary sm" onClick={save} disabled={!draft.unitKey}>
          {role ? 'Save role' : 'Add role'}
        </button>
        <button className="btn sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- relationships ----------

export function RelationshipItem({ rel, perspective }: { rel: Relationship; perspective?: Ref }) {
  const { data, mutate } = useStore();
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(rel.description);
  const [directed, setDirected] = useState(rel.directed);
  const [swap, setSwap] = useState(false);

  const a = swap ? rel.b : rel.a;
  const b = swap ? rel.a : rel.b;
  const other = perspective ? (sameRef(rel.a, perspective) ? rel.b : rel.a) : undefined;
  const outgoing = perspective && sameRef(rel.a, perspective);

  if (editing) {
    return (
      <div className="rel">
        <div className="rel-top">
          <EntityChip entity={a} />
          <span className="arrow">{directed ? '→' : '⟷'}</span>
          <EntityChip entity={b} />
        </div>
        <div style={{ marginTop: 10 }}>
          <DirectionToggle directed={directed} onToggle={() => setDirected(!directed)} onSwap={() => setSwap(!swap)} />
          <textarea className="input" value={desc} onChange={(e) => setDesc(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn primary sm"
            disabled={!desc.trim()}
            onClick={() => {
              mutate((d) => updateRelationship(d, rel.id, { description: desc, directed, swap }));
              setEditing(false);
              setSwap(false);
            }}
          >
            Save
          </button>
          <button
            className="btn sm"
            onClick={() => {
              setEditing(false);
              setDesc(rel.description);
              setDirected(rel.directed);
              setSwap(false);
            }}
          >
            Cancel
          </button>
          <span className="spacer" />
          <button className="btn sm danger" onClick={() => mutate((d) => deleteRelationship(d, rel.id), 'Relationship deleted')}>
            <IconTrash size={14} /> Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rel">
      <div className="rel-top">
        {other ? (
          <>
            {rel.directed ? (
              <span className="arrow" title={outgoing ? `${entityName(data, perspective!)} → ${entityName(data, other)}` : `${entityName(data, other)} → ${entityName(data, perspective!)}`}>
                {outgoing ? <IconArrowRight size={16} /> : <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><IconArrowRight size={16} /></span>}
              </span>
            ) : (
              <span className="arrow">
                <IconBoth size={16} />
              </span>
            )}
            <EntityChip entity={other} />
          </>
        ) : (
          <>
            <EntityChip entity={rel.a} />
            <span className="arrow">{rel.directed ? <IconArrowRight size={16} /> : <IconBoth size={16} />}</span>
            <EntityChip entity={rel.b} />
          </>
        )}
      </div>
      <div className="rel-desc">
        {rel.directed && other ? (
          <>
            <span className="faint small">
              {entityName(data, rel.a)} → {entityName(data, rel.b)}:{' '}
            </span>
            {rel.description}
          </>
        ) : (
          rel.description
        )}
      </div>
      <div className="rel-meta">
        <span>Added {formatDate(rel.createdAt)}</span>
        <button className="btn ghost sm" onClick={() => setEditing(true)}>
          <IconEdit size={14} /> Edit
        </button>
      </div>
    </div>
  );
}

function RelationshipsView({ entity, isTop, onBack }: { entity: Ref; isTop: boolean; onBack(): void }) {
  const { data, close, open } = useStore();
  const rels = relationshipsOf(data, entity);
  return (
    <Modal
      isTop={isTop}
      onClose={close}
      onBack={onBack}
      title={
        <div>
          <span className={`pill ${entity.type}`}>{typeLabel[entity.type]}</span>
          <h2>{entityName(data, entity)} · Relationships</h2>
        </div>
      }
      footer={
        <button className="btn primary" onClick={() => open({ kind: 'add', what: 'relationship', preset: { a: refKey(entity) } })}>
          <IconPlus size={16} /> Add relationship
        </button>
      }
    >
      {rels.length ? (
        rels.map((r) => <RelationshipItem key={r.id} rel={r} perspective={entity} />)
      ) : (
        <div className="no-results">No relationships yet</div>
      )}
    </Modal>
  );
}

