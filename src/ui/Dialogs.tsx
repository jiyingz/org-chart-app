import { useMemo, useRef, useState } from 'react';
import { relationshipsBetween, relationshipsOf, unitPath } from '../model/graph';
import type { Ref, Unit } from '../model/types';
import { useStore, type Modal as ModalState } from '../store';
import { normalizeGraph } from '../storage/local';
import type { GitHubConfig } from '../sync/github';
import type { Conflict } from '../sync/merge';
import { RelationshipItem } from './EntityModal';
import { IconSwap } from './icons';
import { Modal } from './Modal';
import { entityPickerOptions, parseKey, unitPickerOptions } from './options';
import { Picker } from './Picker';

type Of<K extends ModalState['kind']> = Extract<ModalState, { kind: K }>;

// ---------- small generic dialogs ----------

export function ChoiceDialog({ m, isTop }: { m: Of<'choice'>; isTop: boolean }) {
  const close = useStore((s) => s.close);
  return (
    <Modal isTop={isTop} onClose={close} title={m.title} size="narrow" footer={<button className="btn" onClick={close}>Cancel</button>}>
      {m.body && <p style={{ marginTop: 0, color: 'var(--ink-2)', lineHeight: 1.5 }}>{m.body}</p>}
      <div className="list">
        {m.options.map((o) => (
          <button
            key={o.label}
            className="choice"
            style={{ textAlign: 'left', background: 'var(--surface)' }}
            onClick={() => {
              close();
              o.run();
            }}
          >
            <div>
              <strong style={{ color: o.tone === 'danger' ? 'var(--danger)' : o.tone === 'primary' ? 'var(--blue-dark)' : undefined }}>
                {o.label}
              </strong>
              {o.detail && <div className="small faint">{o.detail}</div>}
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function PromptDialog({ m, isTop }: { m: Of<'prompt'>; isTop: boolean }) {
  const close = useStore((s) => s.close);
  const [v, setV] = useState('');
  const submit = () => {
    if (!v.trim()) return;
    close();
    m.onSubmit(v.trim());
  };
  return (
    <Modal
      isTop={isTop}
      onClose={close}
      title={m.title}
      size="narrow"
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={!v.trim()} onClick={submit}>
            {m.submitLabel}
          </button>
        </>
      }
    >
      <div className="field">
        <div className="label">{m.label}</div>
        <input className="input" autoFocus value={v} placeholder={m.placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </div>
    </Modal>
  );
}

export function PickUnitDialog({ m, isTop }: { m: Of<'pickUnit'>; isTop: boolean }) {
  const { data, close } = useStore();
  const options = useMemo(
    () => unitPickerOptions(data, (u: Unit) => (m.teamsOnly && u.type !== 'team') || !!m.exclude?.(u)),
    [data, m],
  );
  return (
    <Modal isTop={isTop} onClose={close} title={m.title} size="narrow">
      {m.body && <p style={{ marginTop: 0, color: 'var(--ink-2)', lineHeight: 1.5 }}>{m.body}</p>}
      <Picker
        options={options}
        value={null}
        autoFocus
        alwaysOpen
        placeholder="Search organizations and teams"
        emptyText="Nothing to choose from"
        onChange={(k) => {
          if (!k) return;
          close();
          m.onPick(parseKey(k) as Unit);
        }}
      />
    </Modal>
  );
}

// ---------- search ----------

export function QuickSearch({ isTop }: { isTop: boolean }) {
  const { data, close, replaceTop, focusOn } = useStore();
  const options = useMemo(() => entityPickerOptions(data), [data]);
  return (
    <Modal isTop={isTop} onClose={close} title="Find on the map" size="narrow">
      <Picker
        options={options}
        value={null}
        autoFocus
        alwaysOpen
        placeholder="Search people, teams, organizations"
        emptyText="Nothing matches"
        onChange={(k) => {
          if (!k) return;
          const ref = parseKey(k);
          focusOn(ref);
          replaceTop({ kind: 'entity', ref });
        }}
      />
    </Modal>
  );
}

export function RelationshipSearch({ isTop }: { isTop: boolean }) {
  const { data, close } = useStore();
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const options = useMemo(() => entityPickerOptions(data), [data]);
  const results = useMemo(() => {
    if (a && b) return relationshipsBetween(data, parseKey(a), parseKey(b));
    if (a || b) return relationshipsOf(data, parseKey((a ?? b)!));
    return null;
  }, [data, a, b]);
  const single: Ref | undefined = (a && !b) || (!a && b) ? parseKey((a ?? b)!) : undefined;

  return (
    <Modal isTop={isTop} onClose={close} title="Search relationships" size="wide">
      <div className="field">
        <div className="label">First person, team or organization</div>
        <Picker options={options.filter((o) => o.key !== b)} value={a} onChange={setA} autoFocus placeholder="Search…" />
      </div>
      <div className="dir-toggle">
        <button className="dir-btn" onClick={() => (setA(b), setB(a))} disabled={!a && !b} title="Swap">
          <IconSwap /> Swap
        </button>
      </div>
      <div className="field">
        <div className="label">Second person, team or organization</div>
        <Picker options={options.filter((o) => o.key !== a)} value={b} onChange={setB} placeholder="Search…" />
      </div>
      {results === null ? (
        <div className="no-results small">Pick two entities to see how they're connected.</div>
      ) : results.length === 0 ? (
        <div className="no-results">No relationships found</div>
      ) : (
        <div className="section">
          <div className="section-head">
            <h3>
              {results.length} relationship{results.length > 1 ? 's' : ''}
              {single ? ' (pick a second entity to narrow down)' : ''}
            </h3>
          </div>
          {results.map((r) => (
            <RelationshipItem key={r.id} rel={r} perspective={single} />
          ))}
        </div>
      )}
    </Modal>
  );
}

// ---------- settings ----------

const timeAgo = (iso: string | null) => {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

export function SettingsDialog({ isTop }: { isTop: boolean }) {
  const { data, sync, close, connect, disconnect, pull, replaceAll, showToast, open } = useStore();
  const [cfg, setCfg] = useState<GitHubConfig>(
    sync.config ?? { owner: '', repo: '', branch: 'main', path: 'org-graph.json', token: '' },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connect({ ...cfg, owner: cfg.owner.trim(), repo: cfg.repo.trim(), branch: cfg.branch.trim() || 'main', path: cfg.path.trim() || 'org-graph.json', token: cfg.token.trim() });
      showToast('Connected to GitHub');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `org-graph-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importJson = async (file: File) => {
    try {
      const parsed = normalizeGraph(JSON.parse(await file.text()));
      open({
        kind: 'choice',
        title: 'Replace everything with this file?',
        body: `It has ${parsed.orgs.length} organizations, ${parsed.teams.length} teams, ${parsed.people.length} people and ${parsed.relationships.length} relationships. You can undo this until you next save.`,
        options: [{ label: 'Replace my map', tone: 'danger', run: () => replaceAll(parsed, 'Imported') }],
      });
    } catch {
      showToast("That file couldn't be read as an OrgMap backup.", { tone: 'error' });
    }
  };

  const set = (k: keyof GitHubConfig) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg({ ...cfg, [k]: e.target.value });

  return (
    <Modal isTop={isTop} onClose={close} title="Settings & sync" size="wide">
      <div className="section" style={{ marginTop: 0 }}>
        <div className="section-head">
          <h3>Sync with GitHub</h3>
        </div>
        {sync.config ? (
          <div className="list">
            <div className="callout">
              Connected to{' '}
              <strong>
                {sync.config.owner}/{sync.config.repo}
              </strong>{' '}
              ({sync.config.path} on {sync.config.branch}). Last synced {timeAgo(sync.lastSyncedAt)}.
              {sync.unpushed && <div style={{ marginTop: 6 }}>⚠︎ Some saved changes haven't reached GitHub yet — press Save when online.</div>}
              {sync.message && <div style={{ marginTop: 6, color: 'var(--danger)' }}>{sync.message}</div>}
            </div>
            <div className="row wrap">
              <button className="btn" disabled={sync.status === 'syncing'} onClick={() => void pull()}>
                Pull latest now
              </button>
              <button className="btn danger" onClick={() => void disconnect()}>
                Disconnect
              </button>
            </div>
            <div className="small faint">
              Disconnecting keeps everything on this device; it just stops syncing. Your data in the GitHub repo is untouched.
            </div>
          </div>
        ) : (
          <>
            <div className="callout" style={{ marginBottom: 14 }}>
              Your map lives on this device. To use the same map on your Mac and iPhone, store it in a <strong>private</strong> GitHub repo:
              <ol>
                <li>
                  Create a new <strong>private</strong> repository, e.g. <code>my-org-graph-data</code> (tick “Add a README” so it isn't empty).
                </li>
                <li>
                  Create a fine-grained token at GitHub → Settings → Developer settings → Fine-grained tokens. Repository access: <em>only that repo</em>. Permissions: <em>Contents → Read and write</em>.
                </li>
                <li>Enter the details below on each device.</li>
              </ol>
            </div>
            <div className="grid2">
              <div className="field">
                <div className="label">GitHub username (owner)</div>
                <input className="input" value={cfg.owner} onChange={set('owner')} autoCapitalize="off" autoCorrect="off" />
              </div>
              <div className="field">
                <div className="label">Repository name</div>
                <input className="input" value={cfg.repo} onChange={set('repo')} placeholder="my-org-graph-data" autoCapitalize="off" autoCorrect="off" />
              </div>
              <div className="field">
                <div className="label">Branch</div>
                <input className="input" value={cfg.branch} onChange={set('branch')} autoCapitalize="off" />
              </div>
              <div className="field">
                <div className="label">File name</div>
                <input className="input" value={cfg.path} onChange={set('path')} autoCapitalize="off" />
              </div>
            </div>
            <div className="field">
              <div className="label">Access token</div>
              <input className="input" type="password" value={cfg.token} onChange={set('token')} placeholder="github_pat_…" autoComplete="off" />
              <div className="small faint">Stored only on this device. It is never put in the app's code or sent anywhere except GitHub.</div>
            </div>
            {error && <div className="callout warn" style={{ marginBottom: 12, color: 'var(--danger)' }}>{error}</div>}
            <button className="btn primary" disabled={busy || !cfg.owner || !cfg.repo || !cfg.token} onClick={() => void doConnect()}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
            <div className="small faint" style={{ marginTop: 8 }}>
              If the repo already has a map (from your other device), it's combined with what's on this device.
            </div>
          </>
        )}
      </div>

      <div className="section">
        <div className="section-head">
          <h3>Backup</h3>
        </div>
        <div className="row wrap">
          <button className="btn" onClick={exportJson}>
            Export as file
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import from file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <h3>Shortcuts</h3>
        </div>
        <div className="small" style={{ color: 'var(--ink-2)', lineHeight: 1.8 }}>
          <span className="kbd">⌘K</span> find · <span className="kbd">⌘S</span> save · <span className="kbd">⌘Z</span> undo ·{' '}
          <span className="kbd">⇧⌘Z</span> redo · <span className="kbd">Shift</span>+drag to select several cards · drag a card onto a team to move it
          <br />
          On iPhone: press and hold a card, then drag it onto a team.
        </div>
      </div>
    </Modal>
  );
}

// ---------- merge conflicts ----------

const describe = (c: Conflict, side: 'local' | 'remote', d: ReturnType<typeof useStore.getState>['data']) => {
  const item = side === 'local' ? c.local : c.remote;
  if (!item) return 'Deleted';
  const x = item as unknown as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof x.name === 'string') lines.push(x.name);
  if (Array.isArray(x.roles))
    for (const r of x.roles as { kind: string; unit: Unit; title?: string }[])
      lines.push(`${r.kind === 'lead' ? '★ Lead, ' : ''}${unitPath(d, r.unit)}${r.title ? ` · ${r.title}` : ''}`);
  for (const k of ['linkedin', 'workEmail', 'personalEmail', 'phone', 'description'])
    if (typeof x[k] === 'string') lines.push(x[k] as string);
  return lines.join('\n');
};

export function ConflictsDialog({ m, isTop }: { m: Of<'conflicts'>; isTop: boolean }) {
  const { data, resolveConflicts, close, showToast } = useStore();
  const [picks, setPicks] = useState<Record<string, 'local' | 'remote'>>({});
  const all = m.result.conflicts.every((c) => picks[c.id]);
  return (
    <Modal
      isTop={isTop}
      onClose={() => {
        // Nothing is lost: this device keeps its version and the next Save asks again.
        close();
        showToast('Not synced yet — press Save when you’re ready to choose.');
      }}
      title="Changed on both devices"
      footer={
        <button className="btn primary" disabled={!all} onClick={() => void resolveConflicts(picks)}>
          Use my choices
        </button>
      }
    >
      <p style={{ marginTop: 0, color: 'var(--ink-2)', lineHeight: 1.5 }}>
        Everything else was combined automatically. These items were edited differently on this device and your other device — pick which version to keep.
      </p>
      {m.result.conflicts.map((c) => (
        <div className="conflict" key={c.id}>
          <strong>{c.label}</strong>
          <div className="grid2" style={{ marginTop: 8, gap: 8 }}>
            {(['local', 'remote'] as const).map((side) => (
              <label key={side} className={`choice ${picks[c.id] === side ? 'on' : ''}`} style={{ flexDirection: 'column' }}>
                <span className="row">
                  <input type="radio" checked={picks[c.id] === side} onChange={() => setPicks({ ...picks, [c.id]: side })} />
                  <strong>{side === 'local' ? 'This device' : 'Other device'}</strong>
                </span>
                <pre>{describe(c, side, data)}</pre>
              </label>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}
