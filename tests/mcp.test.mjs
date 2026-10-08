import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Script } from 'node:vm';

test('packaged plugin initializes, exposes guarded tools and serves self-contained UI', async () => {
  const client = new Client({ name: 'plugin-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/server.mjs'], stderr: 'pipe' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.some(t => t.name === 'gitee_review_open' && t._meta['openai/ui'].entrypoints.some(e => e.type === 'thread')));
    const write = tools.find(t => t.name === 'gitee_publish_review');
    assert.equal(write.annotations.readOnlyHint, false);
    assert.equal(write.inputSchema.properties.confirm.default, false);
    assert.ok(!tools.some(t => /merge|approve/.test(t.name)));
    const resource = await client.readResource({ uri: 'ui://gitee-code-review/app' });
    assert.match(resource.contents[0].text, /Gitee Code Review/);
    assert.ok(!resource.contents[0].text.includes('<script src='));
    const script = resource.contents[0].text.match(/<script>([\s\S]*)<\/script>/)[1];
    assert.doesNotThrow(() => new Script(script), 'Embedded bundle must remain valid JavaScript');
    const opened = await client.callTool({ name: 'gitee_review_open', arguments: {} });
    assert.equal(opened.structuredContent.view, 'inbox');
    const invalid = await client.callTool({ name: 'gitee_get_pull_request', arguments: { url: 'https://evil.test/example/sample/pulls/1' } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); }
});
