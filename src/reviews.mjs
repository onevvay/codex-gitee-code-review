import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import lockfile from 'proper-lockfile';
import { join } from 'node:path';
import { z } from 'zod';
import { validPath, prUrl } from './gitee.mjs';
import { diffRows } from './diff.mjs';
export { diffRows } from './diff.mjs';

export const findingSchema = z.object({
  priority: z.number().int().min(0).max(3), title: z.string().min(1).max(180), body: z.string().min(1).max(5000),
  path: z.string().max(1024), line: z.number().int().positive(), side: z.enum(['left', 'right']),
}).strict();
export const reportSchema = z.object({ summary: z.string().min(1).max(10000), findings: z.array(findingSchema).max(50) }).strict();

export function validLocation(files, finding) {
  const file = files.find(f => f.filename === finding.path);
  if (!file || !validPath(finding.path)) return false;
  return diffRows(file.patch).some(row => (finding.side === 'left' ? row.oldLine : row.newLine) === finding.line);
}
function sameRevision(a, b) { return a.head.sha === b.head.sha && a.base.sha === b.base.sha && a.head.repository === b.head.repository && a.base.repository === b.base.repository; }
function revision(pr) {
  if (![pr.head.sha, pr.base.sha].every(s => typeof s === 'string' && /^[a-f0-9]{40,64}$/i.test(s))) throw new Error('Gitee did not return immutable base/head revisions.');
}
export function formatReport(snapshot, report) {
  const lines = [`## Codex review`, '', `PR: ${prUrl(snapshot.pullRequest)}`, `Base: \`${snapshot.pullRequest.base.sha}\``, `Head: \`${snapshot.pullRequest.head.sha}\``, '', report.summary, '', `Coverage: ${snapshot.coverage.complete ? 'complete' : 'partial'} (${snapshot.coverage.reviewableFiles}/${snapshot.coverage.totalFiles} files).`, ''];
  for (const finding of report.findings) lines.push(`### [P${finding.priority}] ${finding.title}`, `\`${finding.path}:${finding.line}\` (${finding.side})`, '', finding.body, '');
  if (!report.findings.length) lines.push('No actionable findings in the reviewed scope.');
  lines.push('', `<!-- gitee-code-review:${snapshot.id} -->`);
  return lines.join('\n');
}

export class ReviewService {
  constructor(client, directory) { this.client = client; this.directory = directory; this.locks = new Map(); }
  path(id) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new Error('Invalid snapshot ID.');
    return join(this.directory, `${id}.json`);
  }
  async write(snapshot) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = this.path(snapshot.id), temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(temporary, path);
  }
  async read(id) {
    try { return JSON.parse(await readFile(this.path(id), 'utf8')); } catch { throw new Error('Snapshot unavailable. Prepare the review again.'); }
  }
  async prepare(target) {
    const before = await this.client.getPullRequest(target); revision(before);
    const [rawFiles, discussion] = await Promise.all([this.client.files(target), this.client.comments(target)]);
    const after = await this.client.getPullRequest(target);
    if (!sameRevision(before, after)) throw new Error('PR revisions changed during capture. Reload and retry.');
    let bytes = 0, missingPatches = 0, incompletePatches = 0;
    const files = rawFiles.map(file => {
      let patch = file.patch;
      const length = Buffer.byteLength(patch || '');
      if (bytes + length > 512 * 1024 || !validPath(file.filename) || !diffRows(patch).length) patch = null;
      const rows = diffRows(patch);
      const patchIncomplete = Boolean(file.patchIncomplete || patch && (rows.filter(r => r.type === 'add').length !== file.additions || rows.filter(r => r.type === 'delete').length !== file.deletions));
      if (patchIncomplete) incompletePatches++;
      if (!patch) missingPatches++; else bytes += length;
      return { ...file, patch, patchIncomplete };
    });
    const snapshot = {
      id: randomUUID(), createdAt: new Date().toISOString(), pullRequest: { ...before, body: before.body.slice(0, 20000) }, files,
      discussion: discussion.items.slice(0, 30).map(c => ({ ...c, body: c.body.slice(0, 4000) })),
      coverage: { totalFiles: files.length, reviewableFiles: files.length - missingPatches, missingPatches, incompletePatches, apiLimitReached: files.length >= 300, complete: missingPatches === 0 && incompletePatches === 0 && files.length < 300, discussionComplete: !discussion.nextPage && discussion.items.length <= 30 },
      report: null,
    };
    await this.write(snapshot);
    return snapshot;
  }
  async withDiskLock(id, run) {
    let release;
    try { release = await lockfile.lock(this.path(id), { realpath: false, stale: 60000, update: 20000, retries: 0 }); }
    catch (error) { if (error.code === 'ELOCKED') throw new Error('Review is busy. Retry after the current operation finishes (up to 60 seconds after a crash).'); throw error; }
    try { return await run(); } finally { await release(); }
  }
  save(id, input) { return this.withDiskLock(id, () => this.saveLocked(id, input)); }
  async saveLocked(id, input) {
    const snapshot = await this.read(id), report = reportSchema.parse(input);
    if (snapshot.report?.publication) throw new Error('A published or pending report cannot be overwritten. Prepare a new review.');
    if (report.findings.some(f => !validLocation(snapshot.files, f))) throw new Error('Finding location must be a verified diff line in this snapshot.');
    snapshot.report = { ...report, headSha: snapshot.pullRequest.head.sha, baseSha: snapshot.pullRequest.base.sha, savedAt: new Date().toISOString() };
    await this.write(snapshot);
    return snapshot.report;
  }
  async context(id, path, side = 'right') {
    const snapshot = await this.read(id), ref = side === 'left' ? snapshot.pullRequest.base : snapshot.pullRequest.head;
    const previous = snapshot.files.find(f => f.filename === path)?.previousFilename;
    return this.client.file(ref.repository, ref.sha, side === 'left' && previous ? previous : path);
  }
  async status(id) {
    const snapshot = await this.read(id), current = await this.client.getPullRequest(snapshot.pullRequest);
    return { ...snapshot, stale: !sameRevision(snapshot.pullRequest, current) };
  }
  async latest(target) {
    const names = await readdir(this.directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    let latest = null;
    for (const name of names.filter(n => /^[a-f0-9-]{36}\.json$/.test(n))) {
      const snapshot = await this.read(name.slice(0, -5));
      if (snapshot.report && prUrl(snapshot.pullRequest) === prUrl(target) && (!latest || snapshot.report.savedAt > latest.report.savedAt)) latest = snapshot;
    }
    return latest ? this.status(latest.id) : { report: null };
  }
  publish(id, confirm = false, expectedBodyHash) {
    const pending = (this.locks.get(id) || Promise.resolve()).catch(() => {}).then(() => this.withDiskLock(id, () => this.publishLocked(id, confirm, expectedBodyHash)));
    this.locks.set(id, pending);
    pending.finally(() => { if (this.locks.get(id) === pending) this.locks.delete(id); }).catch(() => {});
    return pending;
  }
  async publishLocked(id, confirm, expectedBodyHash) {
    const snapshot = await this.read(id);
    if (!snapshot.report) throw new Error('Save a review before publishing.');
    const current = await this.client.getPullRequest(snapshot.pullRequest);
    if (!sameRevision(snapshot.pullRequest, current)) throw new Error('PR revisions changed. Review the latest revision before publishing.');
    const body = formatReport(snapshot, snapshot.report);
    const bodyHash = createHash('sha256').update(body).digest('hex');
    if (!confirm) return { dryRun: true, body, bodyHash, url: prUrl(snapshot.pullRequest) };
    if (expectedBodyHash !== bodyHash) throw new Error('The review differs from the approved preview. Preview and confirm the current content again.');
    let publication = snapshot.report.publication;
    if (!publication?.commentId) {
      const marker = `<!-- gitee-code-review:${id} -->`;
      let found = null;
      for (let page = 1; page <= 20; page++) {
        const response = await this.client.comments(snapshot.pullRequest, page);
        found = response.items.find(c => c.body === body && c.body.includes(marker));
        if (found || !response.nextPage) break;
        if (page === 20) throw new Error('Cannot safely deduplicate publication. Check the PR discussion manually.');
      }
      if (found) publication = { commentId: found.id, verified: true };
      else {
        if (publication) throw new Error('Previous publication outcome is uncertain. Check Gitee before retrying; no duplicate was sent.');
        const beforeWrite = await this.client.getPullRequest(snapshot.pullRequest);
        if (!sameRevision(snapshot.pullRequest, beforeWrite)) throw new Error('PR revisions changed before publication. Review the latest revision.');
        snapshot.report.publication = { pending: true };
        await this.write(snapshot);
        const posted = await this.client.postComment(snapshot.pullRequest, body);
        publication = { commentId: posted.id, verified: false };
      }
      snapshot.report.publication = publication; await this.write(snapshot);
    }
    try {
      const readback = await this.client.getComment(snapshot.pullRequest, publication.commentId);
      publication.verified = readback.body === body;
    } catch { publication.verified = false; }
    snapshot.report.publication = publication; await this.write(snapshot);
    return { dryRun: false, ...publication, url: prUrl(snapshot.pullRequest) };
  }
}
