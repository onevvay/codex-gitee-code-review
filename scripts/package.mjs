import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

const temp = await mkdtemp(join(tmpdir(), 'gitee-plugin-package-'));
const files = ['.codex-plugin/plugin.json', '.mcp.json', '.agents/plugins/marketplace.json', 'dist/server.mjs', 'dist/ui.html', 'dist/THIRD_PARTY_LICENSES.txt', 'assets/icon.svg', 'README.md', 'LICENSE', 'NOTICE.md', 'SECURITY.md'];
const output = resolve('dist/gitee-code-review-0.1.0.zip');
try {
  for (const file of files) {
    const target = join(temp, 'gitee-code-review', file);
    await mkdir(dirname(target), { recursive: true }); await cp(file, target);
  }
  execFileSync('zip', ['-q', '-r', output, 'gitee-code-review'], { cwd: temp });
  console.log('Packaged dist/gitee-code-review-0.1.0.zip using an explicit file allowlist.');
} finally { await rm(temp, { recursive: true, force: true }); }
