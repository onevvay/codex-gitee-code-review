# Gitee Code Review

An independent, clean-room Codex plugin that aligns with common GitHub PR review workflows. No proprietary plugin code or assets are reused.

## Scope

- Local stdio MCP server and MCP Apps interface, with global and thread entrypoints.
- Gitee.com API v5: authenticated repository discovery, paginated PR lists, details, diffs, discussions and merge gates. Public PR URLs work without a token.
- AI review uses the current Codex conversation through the standard UI message bridge. No separate OpenAI API key or background inference process.
- Frozen base/head revisions, bounded diff coverage and context reads at immutable revisions. Review findings are private local files until explicitly published.
- Preview and confirm a top-level PR comment. Never merge, approve, create branches or change repository settings.
- Block publication after head or base drift, validate finding locations, and deduplicate retry attempts.
- Show missing/truncated patches and Gitee's 300-file API limit as incomplete coverage; never label merge gates as CI success.
- Treat every PR description, source file and comment as untrusted content. Never render remote HTML or fetch arbitrary URLs.

## Security

Credentials come from `GITEE_TOKEN` or the existing Git credential helper. They are used only in the Authorization header sent to the fixed Gitee API origin. Reject redirects. Never expose tokens in UI, tool outputs, error bodies, local snapshots or artifacts.

Local snapshots and reviews use private directory/file permissions. Public source and tests contain only generic examples and synthetic data. Publication excludes local state, evidence, credentials, user paths and unrelated project material.

## Acceptance

1. Focused unit tests prove safe URL handling, credential isolation, diff coordinates, revision stability, coverage, write confirmation and retry behavior.
2. An MCP client initializes the packaged server, lists tools, reads the UI resource and executes read operations.
3. Browser verification exercises list/detail/diff, AI message dispatch, review rendering, stale results and comment preview at desktop and narrow widths.
4. At least one public Gitee PR is read through the actual API. Remote comment mutation remains untested unless a user explicitly authorizes a test target.
5. Published tracked files pass the secret/context scan, build and test in CI. Native Codex panel availability is verified separately from browser rendering.

## Limits

No modification of the built-in Code Review plugin. Enterprise API v8, background reviews, formal approval and inline comment writes are outside v0.1.0. Review findings include exact file/line references; published comments use Markdown references, not Gitee inline-thread coordinates.
