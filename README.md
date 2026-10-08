# Gitee Code Review for Codex

An independent, MIT-licensed Gitee pull request review plugin for Codex. Built from public MCP SDKs, not copied from the proprietary Code Review plugin. Not affiliated with OpenAI or Gitee.

## Features

- Interactive PR inbox with repository selection, pagination, search, details, diffs and discussions.
- Global and conversation-panel entrypoints on compatible Codex hosts.
- AI review through the **current Codex conversation**. No separate OpenAI API key and no hidden background inference process.
- Private local findings anchored to immutable base/head revisions, with file/line navigation.
- Explicit preview and confirmation before posting a top-level Gitee PR comment. Confirmation is bound to the exact preview body.
- Revision drift protection, cross-process write locks, crash recovery and cautious retry deduplication.
- Gitee string/object patch compatibility and honest partial-coverage reporting.

## Install

Requires a current Codex version with plugin/MCP Apps support. The bundled launch configuration supports macOS and Linux. For Windows, use `node` as the MCP command with `./dist/server.mjs` as its argument rather than `/bin/sh`.

The repository includes self-contained `dist/` bundles, so installing the released plugin does not require npm dependencies:

```sh
codex plugin marketplace add onevvay/codex-gitee-code-review
codex plugin add gitee-code-review@gitee-review
```

Start a new Codex conversation, or refresh/restart Codex if the new entrypoint is not visible. Open **Gitee Code Review** from your plugin entrypoints, or ask Codex to open the plugin for a Gitee PR URL. Host support and labels can vary; this plugin does not add Gitee to the built-in GitHub panel.

For a downloaded release ZIP, extract it and register the extracted plugin directory with `codex plugin marketplace add <directory>`, then run the same `plugin add` command.

### Gitee authentication

Public PR URLs work anonymously. Repository discovery and private PRs need a Gitee credential.

The server reads `GITEE_TOKEN` from its environment, or the existing Git credential helper for `https://gitee.com`. Configure a credential outside this repository using your operating system's secure credential store. Do not paste tokens into a Codex conversation, plugin manifest, tracked file, PR URL or command argument. Desktop applications may not inherit variables set in a terminal; verify the plugin's account display after configuring credentials.

If your helper requires a repository-specific credential path, use `GITEE_TOKEN` in the MCP server environment or configure a host-level helper entry. The plugin never asks Git for interactive credentials.

## Review workflow

1. Select a repository or enter a Gitee.com PR URL.
2. Inspect the PR, diff coverage and discussion.
3. Click **开始审查**. The plugin sends a review request to the current Codex conversation. Codex reads the frozen snapshot, optionally retrieves source at immutable SHAs, and saves structured findings locally.
4. Inspect findings in **Codex 审查**. Click a file/line reference to navigate to the diff.
5. **发布评论** opens the exact Markdown preview. **确认发布** posts it only if the content and PR revisions still match.

On hosts that cannot accept UI messages, initiate the review in the Codex conversation instead. The `gitee_review` MCP prompt and headless tools expose the same flow. No AI result is fabricated if the host rejects the request.

## Safety and limitations

- Gitee.com API v5 only. Gitee Enterprise API v8 is not supported in this version.
- No merge, formal approval, branch creation, repository settings or CI mutation tools.
- Published findings are top-level Markdown comments, not Gitee inline review threads.
- PR merge gates are displayed separately from CI. CI results are not fetched or inferred.
- The files API returns at most 300 files. Missing, oversized, binary or truncated patches explicitly reduce coverage. Snapshot diff budget: 512 KiB. Source context budget: 256 KiB per file.
- Source, PR descriptions and comments are untrusted. The UI escapes them rather than rendering remote HTML. The review prompt prohibits executing PR code or following embedded instructions.
- Snapshot capture and publication recheck revisions. Gitee comments do not offer an atomic compare-and-post API: a change in the narrow interval after the final check remains possible. Every comment records the reviewed SHAs.
- An uncertain write is not blindly retried. The plugin searches for the exact review marker/body; unresolved uncertainty requires checking Gitee manually.
- Lock recovery after an ungraceful process exit can take up to 60 seconds.

Local snapshots and findings are stored under `$CODEX_HOME/gitee-code-review/snapshots` (default `~/.codex/gitee-code-review/snapshots`) using private file permissions. They may contain private repository code and are **never** part of the plugin distribution. Retention is local and manual.

## Develop

Node.js 20 or newer:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run audit:publish
npm run package
```

`npm run preview` opens a synthetic fixture host at `http://127.0.0.1:4197`. It uses the real MCP Apps message bridge and review service, but all repositories and AI results are synthetic; it does not connect to Gitee or run a real AI review.

The release ZIP includes only manifests, built server/UI, icon and generic documentation. Source/tests use synthetic examples and do not include user credentials, private project material, local evidence or machine-specific paths.

## References

- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [OpenAI plugin UI extensions](https://developers.openai.com/plugins/build/extensions)
- [MCP Apps SDK](https://github.com/modelcontextprotocol/ext-apps)
- [Gitee API v5 documentation](https://gitee.com/api/v5/swagger)

## License

MIT. Bundled third-party components retain their original licenses; see [NOTICE.md](NOTICE.md).
