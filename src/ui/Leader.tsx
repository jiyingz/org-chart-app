import { getPerson, roleLabel } from '../model/graph';
import { addPerson, assignRole } from '../model/ops';
import type { GraphData, Unit } from '../model/types';
import { useStore } from '../store';
import { entityPickerOptions, parseKey } from './options';
import { Picker } from './Picker';

export interface LeaderValue {
  personKey: string | null;
  /** Typed name for someone not on the map yet. */
  newName?: string;
  /** Required when the chosen person already has roles. */
  mode: 'move' | 'add' | null;
  title: string;
}

export const emptyLeader = (): LeaderValue => ({ personKey: null, mode: null, title: '' });

export const leaderReady = (d: GraphData, v: LeaderValue): boolean => {
  if (v.newName || !v.personKey) return true;
  const p = getPerson(d, parseKey(v.personKey).id);
  return !p?.roles.length || v.mode !== null;
};

export const leaderChosen = (v: LeaderValue) => !!(v.newName || v.personKey);

/** Make the chosen person lead `unit`. "Move" drops all of their existing roles first. */
export const applyLeader = (d: GraphData, unit: Unit, v: LeaderValue): string | undefined => {
  const title = v.title.trim() || undefined;
  if (v.newName) return addPerson(d, { name: v.newName, roles: [{ unit, kind: 'lead', title }] });
  if (!v.personKey) return;
  const id = parseKey(v.personKey).id;
  const p = getPerson(d, id);
  if (!p) return;
  assignRole(d, id, { unit, kind: 'lead', title }, v.mode === 'move' ? p.roles.map((r) => r.id) : []);
  return id;
};

/** "Led by" input: pick an existing person or type a new name, then say whether they move or take on an extra role. */
export function LeaderField({
  value,
  onChange,
  unitName,
  excludePersonIds = [],
}: {
  value: LeaderValue;
  onChange(v: LeaderValue): void;
  unitName: string;
  excludePersonIds?: string[];
}) {
  const data = useStore((s) => s.data);
  const options = entityPickerOptions(data, ['person']).filter((o) => !excludePersonIds.includes(parseKey(o.key).id));
  const person = value.personKey ? getPerson(data, parseKey(value.personKey).id) : undefined;
  const newKey = value.newName ? `new:${value.newName}` : null;
  const opts = value.newName ? [{ key: newKey!, label: value.newName, sub: 'New person', kind: 'person' as const }, ...options] : options;
  const current = person?.roles.map((r) => roleLabel(data, r)).join(', ');
  const name = person?.name.split(' ')[0] ?? '';
  const target = unitName.trim() || 'this';

  return (
    <div>
      <Picker
        options={opts}
        value={value.newName ? newKey : value.personKey}
        onChange={(k) => onChange({ ...value, personKey: k && !k.startsWith('new:') ? k : null, newName: undefined, mode: null })}
        placeholder="Search people, or type a new name"
        onCreate={(q) => onChange({ ...value, personKey: null, newName: q, mode: null })}
        createLabel={(q) => `Add "${q}" as a new person`}
      />
      {person && person.roles.length > 0 && (
        <div className="list" style={{ marginTop: 10 }}>
          <div className="small faint">
            {person.name} is currently: {current}
          </div>
          <label className={`choice ${value.mode === 'move' ? 'on' : ''}`}>
            <input type="radio" checked={value.mode === 'move'} onChange={() => onChange({ ...value, mode: 'move' })} />
            <div>
              <strong>Move</strong> — {name} leaves {person.roles.length > 1 ? 'those roles' : current} and now leads {target}
              <div className="small faint">For a promotion or someone who hopped over.</div>
            </div>
          </label>
          <label className={`choice ${value.mode === 'add' ? 'on' : ''}`}>
            <input type="radio" checked={value.mode === 'add'} onChange={() => onChange({ ...value, mode: 'add' })} />
            <div>
              <strong>Add role</strong> — {name} keeps {person.roles.length > 1 ? 'those roles' : current} and also leads {target}
            </div>
          </label>
        </div>
      )}
      {(person || value.newName) && (
        <input
          className="input"
          style={{ marginTop: 10 }}
          placeholder="Title (optional), e.g. VP Engineering"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      )}
    </div>
  );
}
