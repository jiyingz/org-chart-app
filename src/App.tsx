import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useState } from 'react';
import { Canvas, isTouchDevice } from './canvas/Canvas';
import { isEmptyGraph } from './model/graph';
import { useStore, type AddKind, type Modal as ModalState } from './store';
import { AddOrgOrTeam, AddPerson, AddRelationship } from './ui/AddForms';
import { ChoiceDialog, ConflictsDialog, PickUnitDialog, PromptDialog, QuickSearch, RelationshipSearch, SettingsDialog } from './ui/Dialogs';
import { EntityModal } from './ui/EntityModal';
import {
  BrandMark,
  IconBuilding,
  IconCloud,
  IconLinks,
  IconPlus,
  IconRedo,
  IconSearch,
  IconSettings,
  IconUndo,
  IconUser,
  IconUsers,
} from './ui/icons';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function TopBar() {
  const { dirty, past, future, undo, redo, save, open, sync } = useStore();
  const needsSave = dirty || !!sync.unpushed;
  const status =
    sync.status === 'syncing'
      ? 'Syncing…'
      : sync.status === 'error'
        ? 'Sync problem'
        : sync.status === 'offline'
          ? 'Offline'
          : sync.status === 'synced'
            ? 'Synced'
            : 'On this device';
  return (
    <div className="topbar">
      <div className="brand">
        <BrandMark />
        <span>OrgMap</span>
      </div>
      <div className="spacer" />
      <div className="toolbar">
        <button className="tbtn" onClick={() => open({ kind: 'quick' })} title="Find (⌘K)">
          <IconSearch /> <span className="hide-sm">Find</span>
          <span className="kbd hide-sm">⌘K</span>
        </button>
        <button className="tbtn" onClick={() => open({ kind: 'search' })} title="Search relationships">
          <IconLinks /> <span className="hide-sm">Relationships</span>
        </button>
      </div>
      <div className="toolbar">
        <button className="tbtn" onClick={undo} disabled={!past.length} title="Undo (⌘Z)" aria-label="Undo">
          <IconUndo />
        </button>
        <button className="tbtn" onClick={redo} disabled={!future.length} title="Redo (⇧⌘Z)" aria-label="Redo">
          <IconRedo />
        </button>
        <button
          className={`sync-pill hide-sm tbtn ${sync.status === 'error' ? 'error' : ''}`}
          onClick={() => open({ kind: 'settings' })}
          title={sync.message ?? (sync.config ? `Syncing with ${sync.config.owner}/${sync.config.repo}` : 'Not connected to GitHub')}
        >
          {sync.config && <IconCloud size={15} />} {status}
        </button>
        <button
          className={`tbtn primary ${needsSave ? '' : 'clean'}`}
          onClick={() => void save()}
          disabled={sync.status === 'syncing'}
          title="Save (⌘S)"
        >
          {needsSave && <span className="dot" />} {needsSave ? 'Save' : 'Saved'}
        </button>
        <button className="tbtn" onClick={() => open({ kind: 'settings' })} title="Settings & sync" aria-label="Settings">
          <IconSettings />
        </button>
      </div>
    </div>
  );
}

const ADD_ITEMS: { what: AddKind; label: string; icon: React.ReactNode; color: string; bg: string }[] = [
  { what: 'org', label: 'Add organization', icon: <IconBuilding size={17} />, color: 'var(--org-ink)', bg: 'var(--org-bg)' },
  { what: 'team', label: 'Add team', icon: <IconUsers size={17} />, color: 'var(--team-ink)', bg: 'var(--team-bg)' },
  { what: 'person', label: 'Add person', icon: <IconUser size={17} />, color: 'var(--people-ink)', bg: 'var(--people-bg)' },
  { what: 'relationship', label: 'Add relationship', icon: <IconLinks size={17} />, color: 'var(--blue-dark)', bg: 'var(--blue-soft)' },
];

function Fab() {
  const [open, setOpen] = useState(false);
  const openModal = useStore((s) => s.open);
  return (
    <>
      {open && <div className="fab-scrim" onClick={() => setOpen(false)} />}
      <div className="fab-wrap">
        {open && (
          <div className="fab-menu">
            {ADD_ITEMS.map((i) => (
              <button
                key={i.what}
                className="fab-item"
                onClick={() => {
                  setOpen(false);
                  openModal({ kind: 'add', what: i.what });
                }}
              >
                <span className="fab-icon" style={{ background: i.bg, color: i.color }}>
                  {i.icon}
                </span>
                {i.label}
              </button>
            ))}
          </div>
        )}
        <button className={`fab ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} aria-label="Add">
          <IconPlus size={26} />
        </button>
      </div>
    </>
  );
}

function ModalView({ m, isTop }: { m: ModalState; isTop: boolean }) {
  switch (m.kind) {
    case 'entity':
      return <EntityModal key={`${m.ref.type}:${m.ref.id}`} entity={m.ref} view={m.view} isTop={isTop} />;
    case 'add':
      if (m.what === 'person') return <AddPerson isTop={isTop} preset={m.preset} />;
      if (m.what === 'relationship') return <AddRelationship isTop={isTop} preset={m.preset} />;
      return <AddOrgOrTeam what={m.what} isTop={isTop} preset={m.preset} />;
    case 'search':
      return <RelationshipSearch isTop={isTop} />;
    case 'quick':
      return <QuickSearch isTop={isTop} />;
    case 'settings':
      return <SettingsDialog isTop={isTop} />;
    case 'conflicts':
      return <ConflictsDialog m={m} isTop={isTop} />;
    case 'choice':
      return <ChoiceDialog m={m} isTop={isTop} />;
    case 'prompt':
      return <PromptDialog m={m} isTop={isTop} />;
    case 'pickUnit':
      return <PickUnitDialog m={m} isTop={isTop} />;
  }
}

function Toast() {
  const toast = useStore((s) => s.toast);
  const undo = useStore((s) => s.undo);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.tone === 'error' ? 'error' : ''}`} role="status" key={toast.id}>
      <span className="msg">{toast.text}</span>
      {toast.undo && (
        <button
          onClick={() => {
            undo();
            useStore.setState({ toast: null });
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}

function EmptyState() {
  const touch = isTouchDevice();
  return (
    <div className="empty">
      <div className="empty-card">
        <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden>
          <path d="M32 18v10M32 28L18 40M32 28l14 12" stroke="#c9d6e6" strokeWidth="3" strokeLinecap="round" fill="none" />
          <rect x="22" y="6" width="20" height="14" rx="5" fill="#f2b544" />
          <rect x="8" y="38" width="20" height="14" rx="5" fill="#8bcb6a" />
          <circle cx="46" cy="45" r="8" fill="#8dbde8" />
        </svg>
        <h2>Start your map</h2>
        <p>
          {touch ? 'Tap' : 'Click'} the <strong>＋</strong> button to add your first organization, then its teams and people.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const { ready, init, modals, data } = useStore();

  useEffect(() => {
    void init();
  }, [init]);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const typing = (e.target as HTMLElement).closest('input, textarea, [contenteditable]');
      const s = useStore.getState();
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void s.save();
      } else if (k === 'k') {
        e.preventDefault();
        if (s.modals[s.modals.length - 1]?.kind !== 'quick') s.open({ kind: 'quick' });
      } else if (k === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (k === 'y' && !typing) {
        e.preventDefault();
        s.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pick up changes from the other device when coming back to the app.
  useEffect(() => {
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const s = useStore.getState();
      if (s.sync.config && Date.now() - last > 60_000 && !s.modals.some((m) => m.kind === 'conflicts')) {
        last = Date.now();
        void s.pull({ quiet: true });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Warn before closing a browser tab with unsaved work (the draft is kept either way).
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  if (!ready) return null;
  return (
    <ReactFlowProvider>
      <Canvas />
      {isEmptyGraph(data) && <EmptyState />}
      <TopBar />
      <Fab />
      {modals.map((m, i) => (
        <ModalView key={i} m={m} isTop={i === modals.length - 1} />
      ))}
      <Toast />
    </ReactFlowProvider>
  );
}
