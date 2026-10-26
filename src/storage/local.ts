// On-device storage. IndexedDB works the same in the Mac app (Tauri's WebKit view) and the iPhone PWA.
import { createStore, del, get, set } from 'idb-keyval';
import type { GitHubConfig } from '../sync/github';
import { emptyNotes, type GraphData } from '../model/types';

const store = createStore('orgmap', 'kv');

export interface SyncState {
  config: GitHubConfig | null;
  /** sha of the remote file we last read or wrote. */
  sha: string | null;
  lastSyncedAt: string | null;
  /** Saved on this device but not yet pushed (e.g. saved while offline). */
  unpushed?: boolean;
}

export const local = {
  /** Last saved version. */
  loadSaved: () => get<GraphData>('saved', store),
  /** Working copy with unsaved edits, kept so nothing is lost if the app closes before Save. */
  loadDraft: () => get<GraphData>('draft', store),
  /** Last version both this device and GitHub agreed on (the base for merging). */
  loadBase: () => get<GraphData>('base', store),
  loadSync: async (): Promise<SyncState> =>
    (await get<SyncState>('sync', store)) ?? { config: null, sha: null, lastSyncedAt: null },

  save: (d: GraphData) => set('saved', d, store),
  saveDraft: (d: GraphData) => set('draft', d, store),
  clearDraft: () => del('draft', store),
  saveBase: (d: GraphData | null) => (d ? set('base', d, store) : del('base', store)),
  saveSync: (s: SyncState) => set('sync', s, store),
};

/** Ask the browser not to evict our data under storage pressure (matters most on iOS). */
export const requestPersistence = async () => {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported */
  }
};

/** Accept data from older versions or hand-edited files and fill in anything missing. */
export const normalizeGraph = (raw: unknown): GraphData => {
  const r = (raw ?? {}) as Partial<GraphData>;
  const notes = (n: unknown) => ({ ...emptyNotes(), ...(n as object) });
  return {
    schemaVersion: 1,
    orgs: (r.orgs ?? []).map((o) => ({ ...o, notes: notes(o.notes) })),
    teams: (r.teams ?? []).map((t) => ({ ...t, parentTeamId: t.parentTeamId ?? null, notes: notes(t.notes) })),
    people: (r.people ?? []).map((p) => ({ ...p, roles: p.roles ?? [], notes: notes(p.notes) })),
    relationships: (r.relationships ?? []).map((x) => ({ ...x, directed: !!x.directed })),
  };
};
