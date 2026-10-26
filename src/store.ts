import { create } from 'zustand';
import { emptyGraph, type GraphData, type Ref, type Unit } from './model/types';
import { local, normalizeGraph, requestPersistence, type SyncState } from './storage/local';
import { fetchRemote, GitHubError, pushRemote, type GitHubConfig } from './sync/github';
import { applyResolutions, repair, stableStringify, threeWayMerge, type MergeResult } from './sync/merge';

export type AddKind = 'org' | 'team' | 'person' | 'relationship';

export type Modal =
  | { kind: 'entity'; ref: Ref; view?: 'details' | 'relationships' }
  | { kind: 'add'; what: AddKind; preset?: Record<string, unknown> }
  | { kind: 'search' }
  | { kind: 'quick' }
  | { kind: 'settings' }
  | { kind: 'conflicts'; result: MergeResult; then: 'save' | 'open' }
  | {
      kind: 'choice';
      title: string;
      body?: string;
      options: { label: string; detail?: string; tone?: 'primary' | 'danger'; run(): void }[];
    }
  | { kind: 'prompt'; title: string; label: string; placeholder?: string; submitLabel: string; onSubmit(v: string): void }
  | {
      kind: 'pickUnit';
      title: string;
      body?: string;
      teamsOnly?: boolean;
      exclude?: (u: Unit) => boolean;
      onPick(u: Unit): void;
    };

export interface Toast {
  id: number;
  text: string;
  undo?: boolean;
  tone?: 'info' | 'error';
}

type SyncStatus = 'local' | 'syncing' | 'synced' | 'error' | 'offline';

interface State {
  ready: boolean;
  data: GraphData;
  dirty: boolean;
  past: GraphData[];
  future: GraphData[];
  modals: Modal[];
  toast: Toast | null;
  focus: { ref: Ref; nonce: number } | null;
  sync: SyncState & { status: SyncStatus; message?: string };

  init(): Promise<void>;
  /** Apply an edit to a copy of the data; becomes one undo step. Returns whatever `fn` returns. */
  mutate<T>(fn: (draft: GraphData) => T, toast?: string): T;
  undo(): void;
  redo(): void;
  save(): Promise<void>;
  pull(opts?: { quiet?: boolean }): Promise<void>;
  resolveConflicts(picks: Record<string, 'local' | 'remote'>): Promise<void>;
  connect(cfg: GitHubConfig): Promise<void>;
  disconnect(): Promise<void>;
  replaceAll(d: GraphData, label: string): void;

  open(m: Modal): void;
  replaceTop(m: Modal): void;
  close(): void;
  closeAll(): void;
  showToast(text: string, opts?: Omit<Toast, 'id' | 'text'>): void;
  focusOn(ref: Ref): void;
}

const HISTORY_LIMIT = 100;
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let toastId = 0;

const sameData = (a: GraphData | null | undefined, b: GraphData | null | undefined) =>
  !!a && !!b && stableStringify(a) === stableStringify(b);

const errorText = (e: unknown) =>
  e instanceof GitHubError ? e.message : e instanceof TypeError ? 'Offline — saved on this device only.' : String(e);

export const useStore = create<State>((set, get) => {
  const persistDraft = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const { data, dirty } = get();
      if (dirty) void local.saveDraft(data);
    }, 400);
  };

  const setSync = (patch: Partial<State['sync']>) => set((s) => ({ sync: { ...s.sync, ...patch } }));

  const storeSync = async () => {
    const { config, sha, lastSyncedAt, unpushed } = get().sync;
    await local.saveSync({ config, sha, lastSyncedAt, unpushed });
  };

  /** Commit `d` as the saved version on this device (and as the agreed base if it came from/went to GitHub). */
  const commitSaved = async (d: GraphData, synced: boolean) => {
    await local.save(d);
    await local.clearDraft();
    if (synced) await local.saveBase(d);
  };

  /** The remote version a pending conflict dialog is being resolved against. */
  let pendingRemote: { sha: string; data: GraphData } | null = null;

  const markSynced = async (d: GraphData, sha: string) => {
    await commitSaved(d, true);
    set({ dirty: false });
    setSync({ sha, lastSyncedAt: new Date().toISOString(), status: 'synced', message: undefined, unpushed: false });
    await storeSync();
  };

  /** Push `d` to GitHub, first merging in anything another device pushed since our last sync. */
  const pushMerged = async (d: GraphData): Promise<'done' | 'conflicts'> => {
    const { config } = get().sync;
    if (!config) return 'done';
    const remote = await fetchRemote(config);
    let toPush = d;
    if (remote && remote.sha !== get().sync.sha) {
      const remoteData = normalizeGraph(remote.data);
      const result = threeWayMerge((await local.loadBase()) ?? null, d, remoteData);
      if (result.conflicts.length) {
        pendingRemote = { sha: remote.sha, data: remoteData };
        setSync({ status: 'synced' });
        get().open({ kind: 'conflicts', result, then: 'save' });
        return 'conflicts';
      }
      toPush = result.merged;
    }
    const sha = await pushRemote(config, toPush, remote?.sha ?? null, `Update from ${deviceName()}`);
    if (!sameData(toPush, get().data)) set({ data: toPush, past: [], future: [] });
    await markSynced(toPush, sha);
    return 'done';
  };

  return {
    ready: false,
    data: emptyGraph(),
    dirty: false,
    past: [],
    future: [],
    modals: [],
    toast: null,
    focus: null,
    sync: { config: null, sha: null, lastSyncedAt: null, unpushed: false, status: 'local' },

    async init() {
      void requestPersistence();
      const [saved, draft, sync] = await Promise.all([local.loadSaved(), local.loadDraft(), local.loadSync()]);
      const data = normalizeGraph(draft ?? saved ?? emptyGraph());
      set({
        ready: true,
        data,
        dirty: !!draft && !sameData(draft, saved),
        sync: { ...sync, status: sync.config ? 'syncing' : 'local' },
      });
      if (draft && get().dirty) get().showToast('Restored your unsaved changes from last time.');
      if (sync.config) await get().pull({ quiet: true });
    },

    mutate(fn, toast) {
      const before = get().data;
      const draft = structuredClone(before);
      const out = fn(draft);
      if (sameData(before, draft)) return out;
      set((s) => ({
        data: draft,
        dirty: true,
        past: [...s.past.slice(-HISTORY_LIMIT + 1), before],
        future: [],
      }));
      persistDraft();
      if (toast) get().showToast(toast, { undo: true });
      return out;
    },

    undo() {
      const { past, data, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({ data: prev, past: past.slice(0, -1), future: [data, ...future], dirty: true });
      persistDraft();
    },

    redo() {
      const { past, data, future } = get();
      const next = future[0];
      if (!next) return;
      set({ data: next, past: [...past, data], future: future.slice(1), dirty: true });
      persistDraft();
    },

    replaceAll(d, label) {
      get().mutate((draft) => {
        Object.assign(draft, repair(normalizeGraph(d)));
      }, label);
    },

    async save() {
      const { data, sync } = get();
      if (!sync.config) {
        await commitSaved(data, false);
        set({ dirty: false });
        get().showToast('Saved on this device');
        return;
      }
      setSync({ status: 'syncing', message: undefined });
      let err: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if ((await pushMerged(get().data)) === 'done') get().showToast('Saved and synced to GitHub');
          return;
        } catch (e) {
          err = e;
          // 409/422: another device pushed between our read and write. One more round picks it up.
          if (!(e instanceof GitHubError && (e.status === 409 || e.status === 422))) break;
        }
      }
      // Couldn't reach GitHub: keep the save on this device and push next time.
      await commitSaved(get().data, false);
      const offline = err instanceof TypeError;
      set({ dirty: false });
      setSync({ status: offline ? 'offline' : 'error', message: errorText(err), unpushed: true });
      await storeSync();
      get().showToast(
        offline ? 'Saved on this device. It will sync to GitHub the next time you save online.' : errorText(err),
        { tone: offline ? 'info' : 'error' },
      );
    },

    async pull({ quiet } = {}) {
      const { config } = get().sync;
      if (!config) return;
      setSync({ status: 'syncing', message: undefined });
      try {
        const remote = await fetchRemote(config);
        const hasLocalChanges = get().dirty || get().sync.unpushed;
        if (!remote) {
          // Repo is empty (first sync): upload what we have.
          await pushMerged(get().data);
          return;
        }
        if (remote.sha === get().sync.sha) {
          if (get().sync.unpushed) await pushMerged(get().data);
          else setSync({ status: 'synced', lastSyncedAt: new Date().toISOString() });
          return;
        }
        const remoteData = normalizeGraph(remote.data);
        if (!hasLocalChanges) {
          set({ data: remoteData, past: [], future: [] });
          await markSynced(remoteData, remote.sha);
          if (!quiet) get().showToast('Pulled the latest from GitHub');
          return;
        }
        const result = threeWayMerge((await local.loadBase()) ?? null, get().data, remoteData);
        if (result.conflicts.length) {
          pendingRemote = { sha: remote.sha, data: remoteData };
          setSync({ status: 'synced' });
          get().open({ kind: 'conflicts', result, then: 'open' });
          return;
        }
        if (!get().dirty) {
          // Only saved-but-unpushed changes: the merge is safe to push straight away.
          await pushMerged(get().data);
          return;
        }
        // Unsaved edits stay unsaved, now layered on top of the latest remote version.
        set({ data: result.merged, past: [], future: [] });
        await local.saveBase(remoteData);
        await local.saveDraft(result.merged);
        setSync({ sha: remote.sha, lastSyncedAt: new Date().toISOString(), status: 'synced' });
        await storeSync();
        if (!quiet) get().showToast('Merged the latest from GitHub with your unsaved changes');
      } catch (e) {
        setSync({ status: e instanceof TypeError ? 'offline' : 'error', message: errorText(e) });
        if (!quiet || !(e instanceof TypeError)) get().showToast(errorText(e), { tone: 'error' });
      }
    },

    async resolveConflicts(picks) {
      const top = get().modals[get().modals.length - 1];
      if (top?.kind !== 'conflicts') return;
      const merged = applyResolutions(top.result, picks);
      get().close();
      set((s) => ({ data: merged, dirty: true, past: [...s.past, s.data], future: [] }));
      await local.saveDraft(merged);
      if (pendingRemote) {
        // The merge already contains that remote version, so it becomes the base for the next push.
        await local.saveBase(pendingRemote.data);
        setSync({ sha: pendingRemote.sha });
        pendingRemote = null;
        await storeSync();
      }
      await get().save();
    },

    async connect(cfg) {
      // Verify access before storing anything.
      await fetchRemote(cfg);
      setSync({ config: cfg, sha: null, lastSyncedAt: null, status: 'syncing', unpushed: false });
      await local.saveBase(null);
      await storeSync();
      // No shared base yet: union this device's data with whatever is in the repo.
      const remote = await fetchRemote(cfg);
      if (remote) {
        const result = threeWayMerge(null, get().data, normalizeGraph(remote.data));
        set((s) => ({ data: result.merged, past: [...s.past, s.data], future: [] }));
      }
      const sha = await pushRemote(cfg, get().data, remote?.sha ?? null, `Connect ${deviceName()}`);
      await markSynced(get().data, sha);
    },

    async disconnect() {
      setSync({ config: null, sha: null, lastSyncedAt: null, status: 'local', message: undefined, unpushed: false });
      await local.saveBase(null);
      await storeSync();
    },

    open(m) {
      set((s) => ({ modals: [...s.modals, m] }));
    },
    replaceTop(m) {
      set((s) => ({ modals: [...s.modals.slice(0, -1), m] }));
    },
    close() {
      set((s) => ({ modals: s.modals.slice(0, -1) }));
    },
    closeAll() {
      set({ modals: [] });
    },
    showToast(text, opts) {
      const id = ++toastId;
      set({ toast: { id, text, ...opts } });
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null });
      }, opts?.undo ? 5000 : 3500);
    },
    focusOn(ref) {
      set({ focus: { ref, nonce: Date.now() } });
    },
  };
});

const deviceName = () => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /iPhone|iPad/.test(ua) ? 'iPhone' : /Macintosh/.test(ua) ? 'Mac' : 'browser';
};
