import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const forbiddenNames = /(?:^|\/)(?:\.env(?:\.|$)|auth\.json$|state\.json$|id_rsa|id_ed25519|node_modules\/|snapshots\/|reviews\/|evidence\/)|\.(?:pem|key|log|zip)$/i;
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
  /(?:https?:\/\/)[^\s/]+:[^\s/]+@/,
  /(?:\/Users\/|\/home\/)[A-Za-z0-9_.-]+\//,
  /\b(?:access_token|api_key|password)\b\s*[=:]\s*["'][A-Za-z0-9_-]{24,}["']/i,
];
const findings = [];
for (const file of files) {
  if (forbiddenNames.test(file)) { findings.push(`${file}: forbidden publication path`); continue; }
  const content = await readFile(file, 'utf8');
  if (patterns.some(pattern => pattern.test(content))) findings.push(`${file}: possible secret or machine-specific data`);
}
if (findings.length) { console.error(findings.join('\n')); process.exit(1); }
console.log(`Publication audit passed for ${files.length} tracked files. No secrets or personal paths matched the scan. Review the tracked file list as well.`);
