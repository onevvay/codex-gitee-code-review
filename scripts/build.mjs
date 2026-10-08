import { build } from 'esbuild';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

await mkdir('dist', { recursive: true });
const ui = await build({ entryPoints: ['ui/app.mjs'], bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2022', write: false, metafile: true });
const css = await readFile('ui/style.css', 'utf8');
const html = (await readFile('ui/index.html', 'utf8')).replace('<!-- STYLE -->', () => `<style>${css}</style>`).replace('<!-- SCRIPT -->', () => `<script>${ui.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`);
await writeFile('dist/ui.html', html);
const server = await build({ entryPoints: ['src/server.mjs'], outfile: 'dist/server.mjs', bundle: true, platform: 'node', target: 'node20', format: 'esm', packages: 'bundle', metafile: true, banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' } });
const packages = new Set();
for (const path of [...Object.keys(ui.metafile.inputs), ...Object.keys(server.metafile.inputs)]) {
  if (!path.includes('node_modules/')) continue;
  const part = path.split('node_modules/').at(-1).split('/');
  packages.add(part[0].startsWith('@') ? part.slice(0, 2).join('/') : part[0]);
}
const notices = [];
for (const name of [...packages].sort()) {
  const root = `node_modules/${name}`;
  const metadata = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
  const licenses = (await readdir(root, { withFileTypes: true })).filter(f => f.isFile() && /^(licen[cs]e|copying|notice)(\.|$)/i.test(f.name));
  notices.push(`===== ${name}@${metadata.version} (${metadata.license || 'see package'}) =====`);
  if (!licenses.length) console.warn(`No root license file in package ${name}; package metadata is included in the notices.`);
  for (const file of licenses) notices.push(await readFile(`${root}/${file.name}`, 'utf8'));
  if (!licenses.length) notices.push(JSON.stringify({ license: metadata.license, repository: metadata.repository, author: metadata.author }, null, 2));
}
await writeFile('dist/THIRD_PARTY_LICENSES.txt', notices.join('\n\n'));
await mkdir('assets', { recursive: true });
const require = createRequire(import.meta.url);
const { icons } = require('lucide');
const nodes = icons.GitPullRequest.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([key]) => key !== 'key').map(([key, value]) => `${key}="${value}"`).join(' ')}/>`).join('');
await writeFile('assets/icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#c73234" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${nodes}</svg>\n`);
console.log('Built self-contained MCP server and UI.');
