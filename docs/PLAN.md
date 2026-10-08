# Implementation Plan

**Goal:** Ship an independent, installable Gitee review plugin and publish generic source under MIT.

**Architecture:** Gitee API client, revision-bound review service/store, MCP server, and isolated MCP Apps UI. Standard UI messages ask the current Codex agent to review a frozen snapshot; the agent saves structured findings through MCP.

**Spec:** `docs/SPEC.md`

## Tasks

- [ ] API and review safety: first write failing tests, implement the client and immutable snapshot service, and run focused tests.
- [ ] Plugin and UI: declare the compatibility manifest, bundle server/UI with public SDKs, add a review MCP prompt, and verify MCP calls and browser behavior.
- [ ] Publication: write installation/security documentation and CI, audit all tracked content, commit only plugin files, create an independent public repository, and verify remote HEAD and CI.

## Review Focus

Reject non-Gitee/credential-bearing URLs. Never disclose upstream error bodies. Pin fork context to the source repository and SHA. Reject base/head changes during snapshot capture and publication. Treat absent/oversized patches as incomplete; validate both left and right diff coordinates. Confirm writes and deduplicate uncertain retries. Keep delayed UI responses tied to the selected PR.

## Execution Rulings

Execute inline without extra approval gates because the user explicitly authorized implementation and publication. Do not create unrelated commits or PRs. The application is a plugin, not a landing page. Unit/browser fixtures are synthetic. Evidence stays outside the publishable file set.
