export const target = { owner: 'example', repo: 'sample', number: 7 };
export const pullRequest = {
  ...target, title: 'Validate invoice totals before checkout', body: 'Reject empty invoices before calculating totals.\n\nIncludes coverage for empty line items and rounding.',
  url: 'https://gitee.com/example/sample/pulls/7', state: 'open', author: 'demo-contributor', updatedAt: '2026-01-01T10:00:00Z', draft: false,
  head: { sha: 'a'.repeat(40), ref: 'fix/empty-invoice', repository: 'example/sample' },
  base: { sha: 'b'.repeat(40), ref: 'main', repository: 'example/sample' },
  mergeable: true, canMergeCheck: false, reviewers: [], labels: ['bug'],
};
export const files = [
  { filename: 'src/invoices/calculate-total.js', status: 'modified', additions: 3, deletions: 1, patch: '@@ -1,4 +1,6 @@\n export function total(invoice) {\n-  return invoice.lines.reduce((sum, line) => sum + line.amount);\n+  if (!invoice.lines.length) return 0;\n+  const sum = invoice.lines.reduce((sum, line) => sum + line.amount, 0);\n+  return Math.round(sum * 100) / 100;\n }\n \n' },
  { filename: 'tests/invoices/calculate-total.test.js', status: 'added', additions: 3, deletions: 0, patch: '@@ -0,0 +1,3 @@\n+test("empty invoice", () => {\n+  expect(total({ lines: [] })).toBe(0);\n+});\n' },
];
export const report = { summary: 'One actionable issue found in the reviewed changes. Runtime tests were not executed. Synthetic preview result, not a real AI review.', findings: [{ priority: 2, title: 'Reject a missing lines collection before reading length', body: 'An invoice without a lines collection throws before reaching the empty-invoice guard. Validate the collection at the API boundary or handle an absent collection here.', path: files[0].filename, line: 2, side: 'right' }] };
