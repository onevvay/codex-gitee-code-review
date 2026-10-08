# Security Policy

Never report a vulnerability by posting a real credential, private source code, raw snapshot or authenticated HTTP trace in a public issue. Use synthetic reproductions with redacted values.

## Trust boundaries

- API requests use the fixed `https://gitee.com/api/v5/` origin. Redirects are rejected and credentials stay in the Authorization header.
- Tokens are read at runtime from the environment or Git credential helper, not stored in plugin configuration, review files or tool results.
- The browser UI makes no direct Gitee requests. All reads and writes pass through the host and MCP server.
- Remote text is escaped. PR content has no authority to issue instructions, approve a write, change a URL origin or execute code.
- Publishing requires explicit confirmation and the preview body hash. Base/head/source repository identity must remain unchanged.
- Saved reviews and publication state share an inter-process lock with heartbeat and stale-lock recovery. An uncertain write remains uncertain across restarts until readback establishes its outcome.

## Local data

Private snapshots belong to the local user and are stored outside the plugin directory. Review files are created with mode `0600` under a `0700` directory. This is not encryption; protect the operating-system account and disk appropriately. Delete unneeded snapshots through your normal local file-management process.

## Disclosure

For non-sensitive issues, open a GitHub issue using a minimal synthetic reproduction. For sensitive issues, use GitHub's private vulnerability reporting feature when available; never publish exploit details or credentials until a private disclosure route has been established.
