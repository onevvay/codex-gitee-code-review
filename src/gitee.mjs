import { spawnSync } from 'node:child_process';

const API = 'https://gitee.com/api/v5/';
const segment = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
export function parseRepository(value) {
  const parts = String(value).split('/');
  if (parts.length !== 2 || parts.some(p => !segment.test(p) || p === '..')) throw new Error('Repository must be owner/repo.');
  return { owner: parts[0], repo: parts[1] };
}
export function parsePullRequest(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a Gitee PR URL.'); }
  if (url.protocol !== 'https:' || url.host !== 'gitee.com' || url.username || url.password || url.search || url.hash) throw new Error('Only secure Gitee.com PR URLs without credentials or query parameters are supported.');
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pulls\/([1-9]\d*)\/?$/);
  if (!match || !Number.isSafeInteger(Number(match[3]))) throw new Error('Invalid Gitee PR URL.');
  return { ...parseRepository(`${match[1]}/${match[2]}`), number: Number(match[3]) };
}
export function prUrl(target) {
  const { owner, repo } = parseRepository(`${target.owner}/${target.repo}`);
  if (!Number.isSafeInteger(target.number) || target.number < 1) throw new Error('Invalid PR number.');
  return `https://gitee.com/${owner}/${repo}/pulls/${target.number}`;
}
export function validPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length < 1024 && !/[\\\x00-\x1f]/.test(path) && !path.startsWith('/') && !path.split('/').some(p => p === '..' || p === '.' || p === '');
}
export async function credentialToken() {
  if (process.env.GITEE_TOKEN) return process.env.GITEE_TOKEN.trim();
  const result = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=gitee.com\n\n', encoding: 'utf8', timeout: 5000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false' },
    maxBuffer: 64 * 1024,
  });
  if (result.status !== 0) return null;
  return result.stdout.split('\n').find(line => line.startsWith('password='))?.slice(9) || null;
}

function refInfo(ref, fallback) {
  return { sha: ref?.sha || null, ref: ref?.ref || String(ref || ''), repository: ref?.repo?.full_name || fallback };
}
export function normalizePr(raw, target) {
  const repository = `${target.owner}/${target.repo}`;
  return {
    ...target, number: raw.number, title: String(raw.title || ''), body: String(raw.body || ''),
    url: prUrl({ ...target, number: raw.number }), state: raw.merged_at ? 'merged' : raw.state,
    author: raw.user?.login || '', updatedAt: raw.updated_at || '', draft: Boolean(raw.draft),
    head: refInfo(raw.head, repository), base: refInfo(raw.base, repository),
    mergeable: raw.mergeable ?? null, canMergeCheck: raw.can_merge_check ?? null,
    reviewers: (raw.assignees || []).map(u => ({ login: u.login, approved: u.assignee === true })),
    labels: (raw.labels || []).map(l => String(l.name)),
  };
}
function repoPath(target) {
  const { owner, repo } = parseRepository(`${target.owner}/${target.repo}`);
  return `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}
function pullPath(target) { prUrl(target); return `${repoPath(target)}/pulls/${target.number}`; }
function comment(raw) {
  return { id: raw.id, author: raw.user?.login || '', body: String(raw.body || ''), createdAt: raw.created_at || '', path: raw.path || null, newLine: raw.new_line || null };
}

export class GiteeClient {
  constructor({ fetcher = fetch, tokenProvider = credentialToken } = {}) {
    this.fetcher = fetcher; this.tokenProvider = tokenProvider;
  }
  async request(path, { method = 'GET', body, query = {} } = {}) {
    if (path.startsWith('/') || path.includes('..') || /[?#\\]/.test(path)) throw new Error('Invalid API path.');
    const url = new URL(path, API);
    for (const [key, value] of Object.entries(query)) if (value != null) url.searchParams.set(key, String(value));
    const token = await this.tokenProvider();
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `token ${token}`;
    if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    let response;
    try {
      response = await this.fetcher(url, { method, headers, redirect: 'error', signal: AbortSignal.timeout(20000), body: body ? new URLSearchParams(body).toString() : undefined });
    } catch { throw new Error('Gitee request failed or timed out. Retry the read operation.'); }
    if (!response.ok) {
      const hint = { 401: 'Check your Gitee credential.', 403: 'Permission denied or rate limited.', 404: 'PR or repository not found, or not accessible.', 429: 'Rate limited; retry later.' }[response.status] || 'Gitee rejected the request.';
      throw new Error(`Gitee API HTTP ${response.status}. ${hint}`);
    }
    const chunks = []; let length = 0;
    if (response.body) for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > 8 * 1024 * 1024) throw new Error('Gitee response is too large.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Gitee returned an invalid JSON response.'); }
  }
  async account() {
    if (!await this.tokenProvider()) return { authenticated: false, login: null };
    const user = await this.request('user');
    return { authenticated: true, login: user.login };
  }
  async repositories(page = 1) {
    const rows = await this.request('user/repos', { query: { page, per_page: 100, sort: 'updated' } });
    return { items: rows.map(r => ({ fullName: r.full_name, private: Boolean(r.private) })), nextPage: rows.length === 100 ? page + 1 : null };
  }
  async pulls(repository, state = 'open', page = 1) {
    const target = parseRepository(repository);
    const rows = await this.request(`${repoPath(target)}/pulls`, { query: { state, page, per_page: 30, sort: 'updated', direction: 'desc' } });
    return { items: rows.map(r => normalizePr(r, target)), nextPage: rows.length === 30 ? page + 1 : null };
  }
  async getPullRequest(target) { return normalizePr(await this.request(pullPath(target)), target); }
  async files(target) {
    const rows = await this.request(`${pullPath(target)}/files`);
    return rows.map(f => ({ filename: f.filename, previousFilename: f.patch?.old_path && f.patch.old_path !== f.filename ? f.patch.old_path : null, status: f.status, additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0, patch: typeof f.patch === 'string' ? f.patch : typeof f.patch?.diff === 'string' ? f.patch.diff : null, patchIncomplete: f.patch?.too_large === true }));
  }
  async comments(target, page = 1) {
    const rows = await this.request(`${pullPath(target)}/comments`, { query: { page, per_page: 100, direction: 'desc' } });
    return { items: rows.map(comment), nextPage: rows.length === 100 ? page + 1 : null };
  }
  async postComment(target, body) { return comment(await this.request(`${pullPath(target)}/comments`, { method: 'POST', body: { body } })); }
  async getComment(target, id) {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid comment ID.');
    return comment(await this.request(`${repoPath(target)}/pulls/comments/${id}`));
  }
  async file(repository, sha, path) {
    if (!/^[a-f0-9]{40,64}$/i.test(sha) || !validPath(path)) throw new Error('Use an immutable SHA and safe file path.');
    const raw = await this.request(`${repoPath(parseRepository(repository))}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { query: { ref: sha } });
    if (Array.isArray(raw) || raw.encoding !== 'base64' || typeof raw.content !== 'string') throw new Error('The path is not a readable text file.');
    const content = Buffer.from(raw.content, 'base64');
    if (content.length > 256 * 1024 || content.includes(0)) throw new Error('File is binary or exceeds the 256 KiB context limit.');
    return { path, sha, content: content.toString('utf8') };
  }
}
