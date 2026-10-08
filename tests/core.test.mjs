import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const api = await import('../src/gitee.mjs');
const core = await import('../src/reviews.mjs');
const head = 'a'.repeat(40), base = 'b'.repeat(40);
const target = { owner: 'example', repo: 'sample', number: 7 };
const pr = { ...target, title: 'Guard empty inputs', body: 'Synthetic PR', head: { sha: head, ref: 'fix', repository: 'example/sample' }, base: { sha: base, ref: 'main', repository: 'example/sample' }, state: 'open' };
const file = { filename: 'src/check.js', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1,2 +1,2 @@\n const ok = true;\n-return value;\n+return value ?? 0;\n' };

test('parses only secure Gitee PR URLs', () => {
  assert.equal(typeof api.parsePullRequest, 'function');
  assert.deepEqual(api.parsePullRequest('https://gitee.com/example/sample/pulls/7'), target);
  for (const bad of ['https://evil.test/example/sample/pulls/7', 'http://gitee.com/example/sample/pulls/7', 'https://secret@gitee.com/example/sample/pulls/7', 'https://gitee.com/example/sample/pulls/0', 'https://gitee.com/example/sample/pulls/7?access_token=secret', 'https://gitee.com/example/sample/pulls/7#x', 'https://gitee.com/example/%2f/pulls/7']) assert.throws(() => api.parsePullRequest(bad));
});

test('API credentials stay in headers and errors never echo response bodies', async () => {
  assert.equal(typeof api.GiteeClient, 'function');
  let seen;
  const client = new api.GiteeClient({ tokenProvider: async () => 'synthetic-secret', fetcher: async (url, options) => { seen = { url: String(url), ...options }; return new Response('{"message":"synthetic-secret"}', { status: 401 }); } });
  await assert.rejects(client.getPullRequest(target), error => !error.message.includes('synthetic-secret') && error.message.includes('401'));
  assert.equal(seen.headers.Authorization, 'token synthetic-secret');
  assert.equal(seen.redirect, 'error');
  assert.ok(!seen.url.includes('synthetic-secret'));
});

test('Gitee API supports object patches and preserves rename metadata', async () => {
  const client = new api.GiteeClient({ tokenProvider: async () => null, fetcher: async () => new Response(JSON.stringify([{ ...file, patch: { diff: file.patch, old_path: 'src/old.js', new_path: file.filename, too_large: false } }])) });
  const rows = await client.files(target);
  assert.equal(rows[0].patch, file.patch);
  assert.equal(rows[0].previousFilename, 'src/old.js');
});

test('diff parser records old/new lines and rejects invented coordinates', () => {
  assert.equal(typeof core.diffRows, 'function');
  const rows = core.diffRows(file.patch);
  assert.deepEqual(rows.filter(r => r.type === 'add').map(r => r.newLine), [2]);
  assert.deepEqual(rows.filter(r => r.type === 'delete').map(r => r.oldLine), [2]);
  assert.equal(core.validLocation([file], { path: file.filename, line: 2, side: 'right' }), true);
  assert.equal(core.validLocation([file], { path: file.filename, line: 500, side: 'right' }), false);
});

test('snapshot marks omitted patches as incomplete and blocks capture drift', async () => {
  assert.equal(typeof core.ReviewService, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'gitee-review-test-'));
  try {
    let calls = 0;
    const client = { getPullRequest: async () => pr, files: async () => [file, { filename: 'image.png', patch: null }], comments: async () => ({ items: [], nextPage: null }) };
    const service = new core.ReviewService(client, dir);
    const snap = await service.prepare(target);
    assert.equal(snap.coverage.complete, false);
    assert.equal(snap.coverage.missingPatches, 1);
    client.getPullRequest = async () => (++calls === 1 ? pr : { ...pr, head: { ...pr.head, sha: 'c'.repeat(40) } });
    await assert.rejects(service.prepare(target), /changed|变化/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('save validates findings; publish requires confirmation and blocks stale revisions', async () => {
  assert.equal(typeof core.ReviewService, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'gitee-review-test-'));
  try {
    let posts = 0, current = pr;
    const comments = [];
    const client = { getPullRequest: async () => current, files: async () => [file], comments: async () => ({ items: comments, nextPage: null }), postComment: async (_, body) => { posts++; const c = { id: 42, body }; comments.push(c); return c; }, getComment: async () => comments[0] };
    const service = new core.ReviewService(client, dir);
    const snap = await service.prepare(target);
    await assert.rejects(service.save(snap.id, { summary: 'Review', findings: [{ title: 'Bug', body: 'Evidence', priority: 1, path: file.filename, line: 900, side: 'right' }] }), /location|位置/);
    const report = await service.save(snap.id, { summary: 'Reviewed', findings: [{ title: 'Check the fallback', body: 'Synthetic evidence.', priority: 2, path: file.filename, line: 2, side: 'right' }] });
    assert.equal(report.headSha, head);
    const preview = await service.publish(snap.id, false);
    assert.equal(preview.dryRun, true); assert.equal(posts, 0);
    const posted = await service.publish(snap.id, true, preview.bodyHash);
    assert.equal(posted.verified, true); assert.equal(posts, 1);
    await service.publish(snap.id, true, preview.bodyHash); assert.equal(posts, 1);
    current = { ...pr, base: { ...pr.base, sha: 'd'.repeat(40) } };
    await assert.rejects(service.publish(snap.id, true, preview.bodyHash), /changed|变化/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('fork context reads the immutable source repository, not the destination', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gitee-review-test-'));
  try {
    let requested;
    const fork = { ...pr, head: { ...pr.head, repository: 'contributor/sample' } };
    const service = new core.ReviewService({ getPullRequest: async () => fork, files: async () => [file], comments: async () => ({ items: [] }), file: async (...args) => { requested = args; return {}; } }, dir);
    const snap = await service.prepare(target);
    await service.context(snap.id, file.filename);
    assert.deepEqual(requested, ['contributor/sample', head, file.filename]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ambiguous publication does not blindly retry a write', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gitee-review-test-'));
  try {
    let writes = 0;
    const service = new core.ReviewService({ getPullRequest: async () => pr, files: async () => [file], comments: async () => ({ items: [] }), postComment: async () => { writes++; throw new Error('timeout'); } }, dir);
    const snap = await service.prepare(target);
    await service.save(snap.id, { summary: 'Review', findings: [] });
    const preview = await service.publish(snap.id, false);
    await assert.rejects(service.publish(snap.id, true, preview.bodyHash), /timeout/);
    await assert.rejects(service.publish(snap.id, true, preview.bodyHash), /uncertain/);
    assert.equal(writes, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('publish binds confirmation to the previewed body', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gitee-review-test-'));
  try {
    const service = new core.ReviewService({ getPullRequest: async () => pr, files: async () => [file], comments: async () => ({ items: [] }) }, dir);
    const snap = await service.prepare(target);
    await service.save(snap.id, { summary: 'First draft', findings: [] });
    const preview = await service.publish(snap.id, false);
    assert.match(preview.bodyHash, /^[a-f0-9]{64}$/);
    await assert.rejects(service.publish(snap.id, true), /preview/);
    await service.save(snap.id, { summary: 'Changed after approval', findings: [] });
    await assert.rejects(service.publish(snap.id, true, preview.bodyHash), /preview/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('valid but incomplete patch is not full coverage', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gitee-review-test-'));
  try {
    const service = new core.ReviewService({ getPullRequest: async () => pr, files: async () => [{ ...file, additions: 20 }], comments: async () => ({ items: [] }) }, dir);
    const snap = await service.prepare(target);
    assert.equal(snap.coverage.complete, false);
    assert.equal(snap.coverage.incompletePatches, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('two server instances cannot publish the same report concurrently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gitee-review-test-'));
  try {
    let writes = 0;
    const discussion = [];
    const client = { getPullRequest: async () => pr, files: async () => [file], comments: async () => { await new Promise(r => setTimeout(r, 15)); return { items: discussion }; }, postComment: async (_, body) => { writes++; const c = { id: 1, body }; discussion.push(c); return c; }, getComment: async () => discussion[0] };
    const first = new core.ReviewService(client, dir), second = new core.ReviewService(client, dir);
    const snap = await first.prepare(target);
    await first.save(snap.id, { summary: 'Review', findings: [] });
    const preview = await first.publish(snap.id, false);
    const results = await Promise.allSettled([first.publish(snap.id, true, preview.bodyHash), second.publish(snap.id, true, preview.bodyHash)]);
    assert.equal(writes, 1);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a push during comment deduplication blocks publication', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gitee-review-test-'));
  try {
    let current = pr, writes = 0;
    const client = { getPullRequest: async () => current, files: async () => [file], comments: async () => ({ items: [] }), postComment: async () => { writes++; } };
    const service = new core.ReviewService(client, dir), snap = await service.prepare(target);
    await service.save(snap.id, { summary: 'Review', findings: [] });
    const preview = await service.publish(snap.id, false);
    client.comments = async () => { current = { ...pr, head: { ...pr.head, sha: 'e'.repeat(40) } }; return { items: [] }; };
    await assert.rejects(service.publish(snap.id, true, preview.bodyHash), /changed/);
    assert.equal(writes, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('stale crash lock is reclaimed without losing uncertain publication state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gitee-review-test-'));
  try {
    let writes = 0;
    const discussion = [];
    const client = { getPullRequest: async () => pr, files: async () => [file], comments: async () => ({ items: discussion }), postComment: async (_, body) => { writes++; discussion.push({ id: 1, body }); throw new Error('connection lost after send'); }, getComment: async () => discussion[0] };
    const service = new core.ReviewService(client, dir), snap = await service.prepare(target);
    await service.save(snap.id, { summary: 'Review', findings: [] });
    const preview = await service.publish(snap.id, false);
    await assert.rejects(service.publish(snap.id, true, preview.bodyHash));
    const lock = `${service.path(snap.id)}.lock`;
    await mkdir(lock); await utimes(lock, new Date(0), new Date(0));
    const restarted = new core.ReviewService(client, dir);
    const recovered = await restarted.publish(snap.id, true, preview.bodyHash);
    assert.equal(recovered.verified, true); assert.equal(writes, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
