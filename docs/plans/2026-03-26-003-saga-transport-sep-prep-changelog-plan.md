---
title: "feat: HTTP-transport Saga demo, SEP submission preparation, CHANGELOG.md"
type: feature
status: completed
date: 2026-03-26
deepened: 2026-03-26
---

# HTTP-Transport Saga Demo, SEP Submission Preparation, CHANGELOG.md

## Overview

Three improvements to make the repo fully submission-ready: (1) supplement the in-process Saga demo with a multi-server HTTP transport demo that matches the quality level of the SSE subscription and data reference demos, (2) prepare the three SEP documents for submission to the official MCP specification repository by aligning with the PR-based SEP process, and (3) add a CHANGELOG.md that captures the repo's three development phases. The SEP preparation (workstream 2) is the critical path for submission readiness; the HTTP Saga demo (workstream 1) improves reference implementation credibility but is not a gate for SEP submission.

## Problem Frame

The Saga demo (`saga_demo.py` / `saga-demo.ts`) is the only transport-level demo that doesn't actually use transport. It routes all three "servers" through the same in-process `process_jsonrpc()` call, making "jira-server", "confluence-server", and "slack-server" labels on what is functionally one server. The SSE subscription demo and data reference demo both spin up real HTTP servers with `asyncio.start_server` / Node.js `http` and exchange data over TCP. The Saga demo should meet the same bar — especially since cross-server coordination is the feature that most requires real network boundaries to be credible. A reviewer will rightly ask: "How do you know this Saga protocol works when your servers share memory?"

The three SEPs (`0000-human-in-the-loop-confirmation.md`, `0000-idempotency-and-transactions.md`, `0000-structured-error-model.md`) use placeholder number `0000` and are formatted for this repo, not for the official `modelcontextprotocol/modelcontextprotocol` repository. The official SEP process (since SEP-1850, November 2025) requires PRs to the `seps/` directory of the spec repo, where the PR number becomes the SEP number. Several fields and conventions differ: the official process requires a `Specification` field referencing the baseline MCP version, a `Sponsor` field (initially blank, filled by a Core Maintainer), and recommends a `Discussion` field linking to the PR. The current SEPs are missing these fields and contain internal references (`examples/python/server.py`) that won't make sense in the spec repo context.

The repo has undergone three major development phases — initial proposal + reference implementations, validation/CI/wire-format refactor, and spec alignment/transport demos — but has no changelog. A contributor or reviewer encountering the repo for the first time has no way to understand its evolution without reading git history.

## Requirements Trace

- R1. The Saga demo must run three independent HTTP servers on separate localhost ports, each with its own isolated ticket store, communicating exclusively via HTTP requests — no shared memory, no shared `process_jsonrpc()` function
- R2. The client-side `SagaOrchestrator` must send real HTTP requests to each server, receiving JSON-RPC responses over the wire, with the same two scenarios (clean rollback, partial rollback) as the current demo
- R3. The three SEPs must be reformatted to match the official MCP SEP template: add `Specification`, `Sponsor`, and `Discussion` fields; replace internal file references with self-contained descriptions; use RFC 2119 language consistently
- R4. The SEPs must remain in the local `seps/` directory with `0000` numbering — actual numbers are assigned by the PR number when submitted. The preparation ensures they are copy-paste ready for submission.
- R5. A `CHANGELOG.md` must document the three development phases with dates, summary of changes, and links to plan documents
- R6. All changes must pass existing CI (schema validation, reference implementations, transport demos)
- R7. The existing in-process `server.py` / `server.ts` Saga code (Steps 5 and 7 of the demo) remains unchanged — the transport demo is a separate file

## Scope Boundaries

- No actual submission of SEPs to the official MCP repository — this plan prepares them, the author submits
- No changes to the in-process demos in `server.py` / `server.ts`
- No changes to schemas, manifests, or spec alignment audit files
- No new proposals or SEP drafts beyond the existing 3
- No sponsor identification — the author must find a sponsor through the MCP community (Discord, GitHub Discussions)

## Context & Research

### Official MCP SEP Process (post SEP-1850)

The SEP process moved from GitHub Issues to Pull Requests in November 2025. Key mechanics:

- **Submission**: Author creates a PR adding a markdown file to `seps/` in the `modelcontextprotocol/modelcontextprotocol` repository. The file is initially named `0000-your-feature-title.md`.
- **Numbering**: The PR number becomes the SEP number. After PR creation, the author amends the commit to rename the file (e.g., `2345-your-feature-title.md`) and updates the `SEP Number` field in the preamble.
- **Preamble fields**: `Title`, `Author`, `Sponsor` (a Core Maintainer or Maintainer who champions the SEP), `Status` (Draft → In-Review → Accepted → Final), `Type` (Standards Track / Extensions Track / Process), `Created`, `Specification` (the MCP spec version the SEP targets), `Discussion` (link to the PR).
- **Sponsor role**: Reviews the proposal, ensures quality, manages status transitions. Authors should request a sponsor before or shortly after submitting.
- **Content expectations**: RFC 2119 language (MUST, SHOULD, MAY in caps), Abstract, Motivation, Specification, Rationale, Backward Compatibility, Security Considerations sections. Reference implementations are encouraged but should be described rather than pointed at repo-internal paths.
- **Pre-submission**: The guidelines recommend starting a conversation on Discord or GitHub Discussions to gauge interest before writing a full SEP.

### Current SEP Gaps vs. Official Template

| Field / Convention | Current State | Required |
|---|---|---|
| `SEP Number` | `0000` | `0000` (placeholder until PR assigned) ✓ |
| `Specification` | Missing | MCP spec version (e.g., `2025-11-25`) |
| `Sponsor` | Missing | Blank initially, filled by maintainer |
| `Discussion` | Missing | Link to PR (blank until submitted) |
| `Type` | Present (`Extensions Track`) ✓ | ✓ |
| Reference implementation refs | Point to `examples/python/server.py` etc. | Should describe what exists, not rely on repo-internal paths |
| RFC 2119 language | Partially used | Must be consistent throughout |

### Relevant Code and Patterns

- `examples/python/saga_demo.py` — 364 lines. `SagaOrchestrator` class (lines 148-274) routes all calls through the same `process_jsonrpc()`. Scenarios A (clean rollback) and B (partial rollback) in lines 276-364.
- `examples/typescript/saga-demo.ts` — 358 lines. Mirror of the Python demo.
- `examples/python/data_reference_demo.py` — 392 lines. Pattern to follow: two `asyncio.start_server` instances on `localhost:0`, raw HTTP parsing, isolated state per server, client uses `asyncio.open_connection`. No external dependencies.
- `examples/python/sse_subscription_demo.py` — 425 lines. Same pattern: `asyncio.start_server`, raw HTTP, SSE stream delivery.
- `seps/0000-human-in-the-loop-confirmation.md` — 142 lines. References `examples/python/server.py` lines, `schemas/service-manifest.schema.json`.
- `seps/0000-idempotency-and-transactions.md` — 252 lines. Contains cross-server coordination section (added in plan-002). References `examples/python/server.py` classes.
- `seps/0000-structured-error-model.md` — 122 lines. References `examples/python/server.py` classes.
- No `CHANGELOG.md` exists.

### External References

- MCP SEP guidelines: https://modelcontextprotocol.io/community/sep-guidelines
- SEP-1850 (PR-based process): https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1850
- SEP blog post (November 2025): https://blog.modelcontextprotocol.io/posts/2025-11-28-sep-process-update/
- Example finalized SEPs for format reference: SEP-1686 (Tasks), SEP-932 (Governance)
- Keep a Changelog convention: https://keepachangelog.com

## Key Technical Decisions

- **Three separate HTTP servers for the Saga demo**: Each "server" (jira, confluence, slack) runs as an independent `asyncio.start_server` (Python) / `http.createServer` (TypeScript) on `localhost:0` with its own ticket store. The `SagaOrchestrator` sends real HTTP requests containing JSON-RPC envelopes to each server's port. This mirrors the data reference demo's architecture (Server A + Server B) but with three servers instead of two.

- **Simulated failure via server behavior and transport**: In the current in-process demo, the Slack "server" fails because `post_message` is an unknown tool. In the HTTP demo, Server C (slack) fails the same way — it simply doesn't implement the tool. For partial rollback (Scenario B), Server A (jira) is shut down before rollback begins, causing a connection-refused error on compensation. This failure mode is only possible with real HTTP transport and demonstrates a realistic Saga failure that the in-process demo cannot simulate.

- **Ticket ID numbering changes with isolated stores**: With separate ticket stores per server, each server starts its own counter at 1. Scenario A will show `PROJ-1` created on both Jira and Confluence (instead of `PROJ-1` and `PROJ-2`). This is actually more realistic — real Jira and Confluence have independent ID sequences.

- **SEPs stay in local `seps/` with `0000` numbering**: The official process assigns numbers at PR creation time. Preparing the SEPs means making them copy-paste ready — all fields present (with `Sponsor` and `Discussion` blank), all references self-contained, all RFC 2119 language correct. The author copies the file into their fork of the spec repo and opens a PR.

- **Reference implementation descriptions in SEPs**: Replace `examples/python/server.py → HITL logic in handle_request()` with prose like "Reference implementations in Python and TypeScript are available in the companion repository at [URL]. The Python implementation demonstrates the confirmation flow in a `handle_request()` function that checks the `requires_confirmation` flag and returns a `confirmation_required` status." This makes the SEP self-contained while still pointing to the code.

- **CHANGELOG format**: Follow Keep a Changelog conventions (https://keepachangelog.com) with sections for Added, Changed, Fixed. Three releases: `[0.3.0]` (current — spec alignment, transport demos, cross-server Sagas), `[0.2.0]` (validation/CI/wire-format refactor), `[0.1.0]` (initial proposal with 15 extensions).

## Open Questions

### Resolved During Planning

- **Should the HTTP Saga demo replace or supplement the in-process demo?** Supplement. The in-process demo in `server.py` / `server.ts` exercises the Saga logic as part of the full 14-step demo sequence. The HTTP demo is a separate file that validates the same logic over real transport. Both serve different purposes.
- **Should we assign speculative SEP numbers?** No. The official process is clear: `0000` until the PR is created. Assigning fake numbers would be misleading.
- **Should we include a "Submission Checklist" in the repo?** Yes — a small `docs/sep-submission-checklist.md` would help the author (and future contributors) track the submission steps. Include it in Unit 3.

### Deferred to Implementation

- The exact URL for the companion repository reference in SEPs — depends on whether the repo is published under a GitHub organization or stays under `davioe/mcp-extension-proposals`.
- Whether the Slack server in the Saga HTTP demo should return a JSON-RPC protocol error (`-32601 Method not found`) or an application-level structured error for the `post_message` tool — both are valid; the protocol error is simpler and matches the current in-process demo.

## High-Level Technical Design

> *Directional guidance for review, not implementation specification.*

```
┌───────────────────────────────────────────────────────────────┐
│             Unit 1-2: HTTP Saga Demo                          │
│                                                               │
│  Three HTTP servers on localhost:                              │
│    Server A (jira):       port_a, TICKETS_A store             │
│    Server B (confluence): port_b, TICKETS_B store             │
│    Server C (slack):      port_c, NO post_message tool        │
│                                                               │
│  SagaOrchestrator:                                            │
│    execute_step(server_url, tool, args, compensation)         │
│      → HTTP POST to server_url with JSON-RPC envelope         │
│      → parse JSON-RPC response                                │
│      → register compensation in log                           │
│    rollback()                                                 │
│      → HTTP POST compensation calls in reverse order          │
│                                                               │
│  Demo flow:                                                   │
│    Scenario A: A→success, B→success, C→fail, rollback B,A    │
│    Scenario B: A→success, B→success, C→fail,                  │
│                shutdown A, rollback B→ok, A→conn_refused       │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│             Unit 3: SEP Submission Preparation                 │
│                                                               │
│  For each SEP:                                                │
│    1. Add preamble fields: Specification, Sponsor,            │
│       Discussion (all initially blank/placeholder)            │
│    2. Replace internal file refs with prose descriptions      │
│    3. Audit RFC 2119 language: all normative keywords         │
│       in ALL CAPS where they express requirements             │
│    4. Add "Relationship to MCP 2025-11-25" subsection         │
│       (pull from spec-alignment audit files)                  │
│    5. Verify Abstract, Motivation, Specification,             │
│       Rationale, Backward Compatibility, Security sections    │
│                                                               │
│  Create docs/sep-submission-checklist.md                      │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│             Unit 4: CHANGELOG.md                               │
│                                                               │
│  ## [0.3.0] - 2026-03-26                                      │
│  ### Added                                                    │
│  - Spec alignment audit (15 files)                            │
│  - Cross-server Saga coordination (SEP + demos)               │
│  - SSE subscription transport demo                            │
│  - Data reference signed-URL transport demo                   │
│  - HTTP Saga transport demo                                   │
│                                                               │
│  ## [0.2.0] - 2026-03-26                                      │
│  ### Changed                                                  │
│  - Replaced manual validator with ajv (JSON Schema 2020-12)   │
│  - Added JSON-RPC 2.0 wire framing to both implementations    │
│  ### Added                                                    │
│  - CI pipeline (schema validation + both implementations)     │
│  - 3 additional manifests (Slack, Linear, Notion)             │
│  - 3 SEP drafts                                               │
│                                                               │
│  ## [0.1.0] - 2026-03-25                                      │
│  ### Added                                                    │
│  - Initial 15 extension proposals                             │
│  - 10 JSON schemas                                            │
│  - Reference implementations (Python + TypeScript)            │
│  - 2 example manifests (GitHub, Jira)                         │
└───────────────────────────────────────────────────────────────┘
```

## Implementation Units

- [ ] **Unit 1: Rewrite Python Saga demo with HTTP transport**

  **Goal:** Replace the in-process routing with three independent HTTP servers, each with isolated state, communicating over TCP.

  **Requirements:** R1, R2, R7

  **Dependencies:** None

  **Files:**
  - Rewrite: `examples/python/saga_demo.py`

  **Approach:**
  - Define three server handler functions: `handle_jira_server`, `handle_confluence_server`, `handle_slack_server`. Each has its own `TICKETS` dict (isolated state). Jira and Confluence support `create_ticket` and `delete_ticket`. Slack supports neither (returns `-32601 Method not found` for any `tools/call`).
  - Each server parses raw HTTP requests (reuse the minimal HTTP parsing pattern from `data_reference_demo.py`), extracts the JSON-RPC envelope from the HTTP body, routes `tools/call` to local tool handlers, and returns a JSON-RPC response in the HTTP body.
  - Start all three servers with `asyncio.start_server("localhost", 0)` to get random ports.
  - Refactor `SagaOrchestrator.execute_step()` to accept a `server_url` parameter (e.g., `http://localhost:{port_a}`) instead of a `server_id` label. The method sends an HTTP POST with the JSON-RPC envelope as the body and parses the HTTP response.
  - Retain `SagaOrchestrator.rollback()` logic — it already iterates the compensation log in reverse. Each compensation call now goes to the appropriate server URL (stored in `CompensationEntry`).
  - Scenario A: Step 1 → Jira (success), Step 2 → Confluence (success), Step 3 → Slack (fail: unknown tool), rollback Confluence then Jira → clean.
  - Scenario B: Step 1 → Jira (success), Step 2 → Confluence (success), Step 3 → Slack (fail). Before rollback, shut down Server A (Jira) to simulate server unavailability. Rollback Confluence → success, Jira → connection refused (compensation_failed) → partial rollback. This failure mode is only possible with real HTTP transport, which justifies the rewrite.
  - Shut down all servers after demo completes.

  **Patterns to follow:**
  - `data_reference_demo.py` architecture: `asyncio.start_server` on port 0, raw HTTP parsing, `http_response()` helper, `asyncio.open_connection` for client requests
  - Existing `SagaOrchestrator` class interface (keep `CompensationEntry` dataclass)
  - Existing demo output format (section headers, step-by-step print statements)
  - Stdlib-only constraint

  **Test scenarios:**
  - Scenario A produces identical output structure to the current demo (step success/fail, compensation success, "Clean rollback")
  - Scenario B shows server shutdown → connection refused → compensation_failed → "Partial rollback"
  - All three servers start and stop cleanly with no port conflicts
  - Ticket IDs are independent per server (both Jira and Confluence will create PROJ-1 — this is expected with isolated stores and more realistic than shared sequential numbering)

  **Verification:**
  - `python examples/python/saga_demo.py` exits 0
  - Output shows HTTP URLs (e.g., `http://localhost:54321`) confirming real transport
  - Removing one server (commenting out its `start_server`) causes the corresponding step to fail with a connection error, proving the servers are independent

- [ ] **Unit 2: Rewrite TypeScript Saga demo with HTTP transport**

  **Goal:** Mirror the Python HTTP Saga demo in TypeScript.

  **Requirements:** R1, R2

  **Dependencies:** Unit 1 (to establish the pattern)

  **Files:**
  - Rewrite: `examples/typescript/saga-demo.ts`

  **Approach:**
  - Same architecture as Python: three `http.createServer` instances on random ports, isolated ticket stores (separate `Map<string, Ticket>` per server), `SagaOrchestrator` sending real HTTP requests via Node.js `http.request`.
  - Reuse the HTTP utility patterns from `data-reference-demo.ts` or `sse-subscription-demo.ts`.
  - Same two scenarios, same output structure.

  **Patterns to follow:**
  - Existing TypeScript transport demos
  - Node.js `http` module (no Express, no external deps)

  **Test scenarios:**
  - Same as Unit 1 but for TypeScript
  - Output matches Python demo structure

  **Verification:**
  - `npx tsx examples/typescript/saga-demo.ts` exits 0
  - Output shows HTTP URLs confirming real transport

- [ ] **Unit 3: Prepare SEPs for official submission**

  **Goal:** Reformat the three SEP documents to match the official MCP SEP template, making them copy-paste ready for PR submission to the spec repo.

  **Requirements:** R3, R4

  **Dependencies:** None (parallel with Units 1-2)

  **Files:**
  - Modify: `seps/0000-human-in-the-loop-confirmation.md`
  - Modify: `seps/0000-idempotency-and-transactions.md`
  - Modify: `seps/0000-structured-error-model.md`
  - Create: `docs/sep-submission-checklist.md`
  - Create: `CHANGELOG.md`
  - Modify: `examples/README.md`
  - Modify: `CONTRIBUTING.md`

  **Approach:**

  For each SEP:

  1. **Update preamble table** to match the official format with fields: SEP Number (0000), Title, Author (davioe), Sponsor (to be assigned), Status (Draft), Type (Extensions Track), Created (2026-03-25), Specification (MCP 2025-11-25), Discussion (link to PR when submitted).

  2. **Replace internal file references** with self-contained descriptions pointing to the GitHub repository URL.

  3. **Audit RFC 2119 language**: Ensure MUST, MUST NOT, SHOULD, SHOULD NOT, MAY are in ALL CAPS when expressing requirements.

  4. **Verify existing sections are complete**: All three SEPs already have "Relationship to MCP 2025-11-25" subsections and Abstract/Motivation/Specification/Rationale/Backward Compatibility/Security Implications sections (added in plan-002). Verify they are current and complete — do not re-add.

  5. **Create `docs/sep-submission-checklist.md`** with the 10-step submission process.

  6. **Create `CHANGELOG.md`** following Keep a Changelog format with three releases: [0.3.0] (spec alignment + transport demos + SEP prep), [0.2.0] (ajv + JSON-RPC + CI), [0.1.0] (initial proposals). Include this plan's HTTP Saga demo and SEP prep in the 0.3.0 entry.

  **Patterns to follow:**
  - Official SEP format: SEP-1686 (Tasks), SEP-932 (Governance) as references
  - RFC 2119 usage patterns from the MCP spec itself

  **Test scenarios:**
  - Each SEP has all required preamble fields
  - Each SEP has all required content sections
  - No internal file paths remain (all replaced with URLs or prose)

  **Additional files (folded from former Units 4-5):**
  - Create: `CHANGELOG.md`
  - Modify: `examples/README.md` (update Transport Demo column for Saga from "in-process" to "HTTP transport")
  - Modify: `CONTRIBUTING.md` (add note about SEP submission checklist)

  Note: CI already has steps for `python examples/python/saga_demo.py` and `npx tsx examples/typescript/saga-demo.ts`. Since filenames are unchanged, no CI modifications needed.

  **Verification:**
  - A reader unfamiliar with this repo can understand each SEP from the SEP file alone
  - The checklist covers all steps from the official SEP guidelines
  - CHANGELOG.md is complete and renders correctly in GitHub
  - CI passes with all existing steps
  - `examples/README.md` Transport Demo column reflects HTTP transport for Saga

## System-Wide Impact

- **Interaction graph:** The Saga demo rewrite changes 2 files (`saga_demo.py`, `saga-demo.ts`) but does not affect any other implementation or schema. The SEP modifications are text-only changes to 3 markdown files. The CHANGELOG and checklist are new files with no dependencies.
- **Error propagation:** The HTTP Saga demo introduces real TCP connections. Port conflicts are handled by `localhost:0` (OS assigns available port). No startup race — `asyncio.start_server` completes after bind. Scenario B deliberately shuts down Server A to demonstrate connection-refused compensation failure.
- **State lifecycle risks:** The three HTTP servers in the Saga demo each have independent state. Memory cleanup happens automatically when `asyncio.run()` completes and the servers are closed.
- **CI compatibility:** The existing CI steps run the Saga demos with `timeout-minutes: 2`. The HTTP version may be slightly slower due to TCP overhead but should complete well within the timeout.

## Risks & Dependencies

- **Saga demo port conflicts in CI**: Three servers binding to random ports on the same host. Risk of port exhaustion is negligible (only 3 ports needed). Startup races are not a concern: `asyncio.start_server` / `http.createServer(...).listen(0)` complete only after the socket is bound, and the client runs sequentially after all servers are started.
- **SEP format drift**: The official SEP template may evolve between now and when the author submits. Mitigation: the preparation gets the SEPs 95% there; the author should check the latest `seps/README.md` in the spec repo immediately before submission.
- **Changelog accuracy**: The three phases are reconstructed from plan documents and git history, not from tagged releases. Mitigation: use conservative descriptions that are verifiable from the repo contents.

## Sources & References

- MCP SEP guidelines: https://modelcontextprotocol.io/community/sep-guidelines
- SEP-1850 (PR-based process migration): https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1850
- SEP process blog post: https://blog.modelcontextprotocol.io/posts/2025-11-28-sep-process-update/
- Keep a Changelog: https://keepachangelog.com
- Related code: `examples/python/saga_demo.py`, `examples/typescript/saga-demo.ts`, `examples/python/data_reference_demo.py` (architecture pattern), `seps/0000-*.md`
- Plan documents: `docs/plans/2026-03-26-001-refactor-validation-ci-wire-format-plan.md`, `docs/plans/2026-03-26-002-spec-alignment-cross-server-transport-plan.md`
