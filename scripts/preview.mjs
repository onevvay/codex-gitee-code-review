import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { ReviewService } from '../src/reviews.mjs';
import { pullRequest, files, report } from '../tests/fixtures.mjs';

const directory = await mkdtemp(join(tmpdir(), 'gitee-preview-'));
const discussion = [{ id: 1, author: 'demo-reviewer', body: 'Please also cover invoices without a lines collection.', createdAt: '2026-01-01T10:05:00Z' }];
const fake = { getPullRequest: async () => pullRequest, files: async () => files, comments: async () => ({ items: discussion, nextPage: null }), postComment: async (_, body) => { const value = { id: discussion.length + 1, author: 'demo-reviewer', body }; discussion.push(value); return value; }, getComment: async (_, id) => discussion.find(c => c.id === id) };
const reviews = new ReviewService(fake, directory);
const host = await build({ entryPoints: ['scripts/preview-host.mjs'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false });
const html = await readFile('dist/ui.html', 'utf8');
const shell = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gitee Review Synthetic Preview</title><style>body{margin:0}header{height:28px;font:12px/28px sans-serif;text-align:center;background:#f1f1f1;color:#555}iframe{width:100%;height:calc(100vh - 28px);border:0;display:block}</style></head><body><header>Synthetic fixture preview · no live repository data</header><iframe title="Gitee Code Review" sandbox="allow-scripts allow-same-origin allow-modals"></iframe><script type="module" src="/host.js"></script></body></html>';
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET') {
      const page = { '/': [shell, 'text/html'], '/ui.html': [html, 'text/html'], '/host.js': [host.outputFiles[0].text, 'text/javascript'] }[request.url];
      if (!page) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': `${page[1]}; charset=utf-8` }).end(page[0]); return;
    }
    let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 20000) throw new Error('Request too large'); }
    const input = JSON.parse(body); let value;
    if (request.url === '/message') {
      const id = input.content?.find(c => c.type === 'text')?.text.match(/[a-f0-9-]{36}/)?.[0];
      await reviews.save(id, report); value = { isError: false };
    } else if (request.url === '/call') {
      const args = input.arguments || {};
      const handlers = {
        gitee_get_account: () => ({ authenticated: true, login: 'demo-reviewer' }),
        gitee_list_repositories: () => ({ items: [{ fullName: 'example/sample' }], nextPage: null }),
        gitee_list_pull_requests: () => ({ items: [pullRequest, { ...pullRequest, number: 6, url: 'https://gitee.com/example/sample/pulls/6', title: 'Preserve totals for discounted line items' }, { ...pullRequest, number: 5, url: 'https://gitee.com/example/sample/pulls/5', title: 'Add currency validation at the boundary' }], nextPage: null }),
        gitee_prepare_review: () => reviews.prepare({ ...pullRequest, number: Number(args.url.match(/pulls\/(\d+)/)?.[1] || 7) }),
        gitee_get_latest_review: () => reviews.latest(pullRequest),
        gitee_get_comments: () => fake.comments(),
        gitee_get_review: () => reviews.status(args.snapshotId),
        gitee_publish_review: () => reviews.publish(args.snapshotId, args.confirm, args.expectedBodyHash),
      };
      if (!handlers[input.name]) throw new Error('Unknown preview tool');
      const data = await handlers[input.name](); value = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } else throw new Error('Unknown route');
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
  } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ isError: true, content: [{ type: 'text', text: error.message }] })); }
});
server.listen(Number(process.env.PORT || 4197), '127.0.0.1', () => console.log(`Synthetic preview: http://127.0.0.1:${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { server.close(); await rm(directory, { recursive: true, force: true }); process.exit(0); });
