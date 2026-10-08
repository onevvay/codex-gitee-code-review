import { parsePatch } from 'diff';

export function diffRows(patch) {
  if (!patch) return [];
  try {
    const parsed = parsePatch(`--- a/file\n+++ b/file\n${patch}`, { strict: true });
    return parsed.flatMap(file => file.hunks.flatMap(hunk => {
      let oldLine = hunk.oldStart, newLine = hunk.newStart;
      const rows = [{ type: 'hunk', text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` }];
      for (const line of hunk.lines) {
        const type = line[0] === '+' ? 'add' : line[0] === '-' ? 'delete' : line[0] === ' ' ? 'context' : 'note';
        rows.push({ type, text: line.slice(1), oldLine: ['context', 'delete'].includes(type) ? oldLine++ : null, newLine: ['context', 'add'].includes(type) ? newLine++ : null });
      }
      return rows;
    }));
  } catch { return []; }
}
