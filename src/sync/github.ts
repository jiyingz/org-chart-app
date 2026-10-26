// Minimal GitHub Contents API client: read and write one JSON file in a (private) repo.
import type { GraphData } from '../model/types';

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  token: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const api = 'https://api.github.com';

const headers = (cfg: GitHubConfig) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${cfg.token}`,
  'X-GitHub-Api-Version': '2022-11-28',
});

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

const fromBase64 = (b64: string): string => {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const explain = async (res: Response): Promise<GitHubError> => {
  let detail = '';
  try {
    detail = ((await res.json()) as { message?: string }).message ?? '';
  } catch {
    /* not json */
  }
  const hint =
    res.status === 401
      ? 'The token was rejected. It may have expired — create a new one.'
      : res.status === 403
        ? 'The token does not have permission. It needs "Contents: Read and write" on this repo.'
        : res.status === 404
          ? 'Repo or branch not found. Check the owner/repo name and that the token can access it.'
          : `GitHub error ${res.status}.`;
  return new GitHubError(`${hint}${detail ? ` (${detail})` : ''}`, res.status);
};

export interface RemoteFile {
  data: GraphData;
  sha: string;
}

/** Returns null if the data file doesn't exist yet. */
export const fetchRemote = async (cfg: GitHubConfig): Promise<RemoteFile | null> => {
  const url = `${api}/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(cfg.path)}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await fetch(url, { headers: headers(cfg), cache: 'no-store' });
  if (res.status === 404) {
    // Distinguish "file missing" (fine, first sync) from "repo missing" (misconfigured).
    const repo = await fetch(`${api}/repos/${cfg.owner}/${cfg.repo}`, { headers: headers(cfg), cache: 'no-store' });
    if (!repo.ok) throw await explain(repo);
    return null;
  }
  if (!res.ok) throw await explain(res);
  const body = (await res.json()) as { sha: string; content?: string; encoding?: string };
  let text: string;
  if (body.content && body.encoding === 'base64') text = fromBase64(body.content);
  else {
    // Files over 1 MB come back without inline content; fetch the blob instead.
    const blob = await fetch(`${api}/repos/${cfg.owner}/${cfg.repo}/git/blobs/${body.sha}`, {
      headers: headers(cfg),
      cache: 'no-store',
    });
    if (!blob.ok) throw await explain(blob);
    text = fromBase64(((await blob.json()) as { content: string }).content);
  }
  return { data: JSON.parse(text) as GraphData, sha: body.sha };
};

/** Write the file. `sha` must be the version we last read (null to create); GitHub rejects stale writes with 409. */
export const pushRemote = async (cfg: GitHubConfig, data: GraphData, sha: string | null, message: string) => {
  const url = `${api}/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(cfg.path)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...headers(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: toBase64(JSON.stringify(data, null, 2) + '\n'),
      branch: cfg.branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw await explain(res);
  const body = (await res.json()) as { content: { sha: string } };
  return body.content.sha;
};
