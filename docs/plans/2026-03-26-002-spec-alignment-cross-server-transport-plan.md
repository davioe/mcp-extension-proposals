---
title: "feat: Spec alignment audit against MCP 2025-11-25, cross-server transaction coordination, transport-level reference implementations"
type: feature
status: planned
date: 2026-03-26
deepened: 2026-03-26
---

# Spec Alignment Audit, Cross-Server Transaction Coordination, Transport-Level Reference Implementations

## Overview

Three workstreams to close the remaining credibility gaps before community submission: (1) a systematic, per-proposal audit against the MCP 2025-11-25 specification — including the Tasks primitive, Extensions framework, and updated OAuth/Elicitation features — resulting in per-proposal audit files and targeted proposal revisions, (2) a detailed cross-server Saga coordination design for the transaction model (Proposal #5), and (3) transport-aware reference implementations for Subscriptions (#15) and Data References (#9) that move beyond in-process simulation.

## Problem Frame

The repo claims spec baseline 2025-11-25 and includes a gap analysis table in the README, but the analysis is surface-level — it maps proposals to spec features without tracing specific protocol messages, schema fields, or SEP decisions that affect each proposal's design. Reviewers in the official MCP community will ask: "Have you read the Tasks spec? It already does X." Without a detailed audit trail, the proposals risk being dismissed as duplicating existing work.

The transaction SEP (Proposal #5) acknowledges limitations ("best-effort, not ACID", "no isolation") but does not address the primary real-world use case: a multi-step workflow spanning *multiple* MCP servers (e.g., create Jira ticket on Server A → link Confluence doc on Server B → post Slack notification on Server C). Who coordinates the rollback? Who stores the compensation log? The current design assumes a single server manages the transaction, which is a narrow case.

Proposals #15 (Subscriptions) and #9 (Data References) have reference implementations that are purely in-process simulations — functions calling functions. While acceptable for demonstrating schema shapes, they do not exercise the transport mechanics that make these proposals challenging in practice: SSE stream management for subscriptions, signed URL exchange for data references. The gap between simulation and reality is larger here than for any other proposal.

## Requirements Trace

- R1. Every proposal in the README gap analysis table must have a detailed audit section documenting: (a) the specific MCP 2025-11-25 spec sections, schema fields, and SEP numbers examined, (b) what is now covered vs. what remains a genuine gap, (c) any design changes needed in our proposal to avoid conflict with the spec
- R2. The audit must specifically address Tasks (SEP-1686), Extensions framework, incremental scope consent (SEP-835), structured tool output (`outputSchema`), tool annotations, and Elicitation URL mode (SEP-1036) — the features most likely to overlap
- R3. Proposals where the spec has fully closed the gap must be explicitly marked as "Superseded" with a rationale, not silently kept
- R4. The transaction SEP must include a Cross-Server Coordination section with: a Saga coordinator design, compensation log ownership model, failure matrix for partial rollback across independent servers, and a worked example with ≥3 servers
- R5. The Subscriptions reference implementation must use actual SSE transport (server-sent events over HTTP) for event delivery in at least one language
- R6. The Data References reference implementation must demonstrate signed URL generation, TTL expiry, and a simulated two-server transfer where data does not pass through the client
- R7. All changes remain backwards-compatible with the existing repo structure (no breaking renames, no removal of schemas or implementations without replacement)

## Scope Boundaries

- No submission to the official MCP repository — this plan prepares the repo for submission, it does not execute the submission
- No real external API integration (Jira, Slack, etc.) — transport-level demos use localhost HTTP servers
- No changes to proposals where the current gap analysis is already accurate and detailed
- No new proposals beyond the existing 15
- No SEP drafts beyond the existing 3 (new SEPs are a separate effort after the audit settles)

## Context & Research

### MCP 2025-11-25 Features Relevant to This Repo

The following features were introduced or significantly updated in the 2025-11-25 spec and must be traced against our proposals:

**Tasks (SEP-1686, experimental).** Durable state machines for long-running operations. Any request can be augmented with a task handle. States: `working`, `input_required`, `completed`, `failed`, `cancelled`. Supports polling (`tasks/get`), deferred result retrieval (`tasks/result`), cancellation (`tasks/cancel`), and status notifications (`notifications/tasks/status`). Tool-level negotiation via `execution.taskSupport` (`forbidden`, `optional`, `required`). Implications for our proposals:
- Proposal #8 (Streaming & Progress): Tasks subsume part of the "long-running operation tracking" use case. Our proposal's progress notifications and checkpoint tokens remain distinct — Tasks provide status polling but not partial result streaming or checkpoint resumption.
- Proposal #6 (HITL): Tasks support `input_required` status which can trigger Elicitation — this partially overlaps with our confirmation protocol. Key difference: our HITL is declared on the tool definition upfront (`requires_confirmation: true`); Tasks + Elicitation is a runtime flow initiated by the server mid-execution.

**Extensions framework.** Formalized mechanism for optional protocol extensions. Extensions are namespaced, versioned independently, strictly additive, and composable. Capability negotiation during initialization. This is the intended home for features like our proposals. Implications:
- All 15 proposals should be framed as MCP Extensions, not core spec changes. The `supported_extensions` field in our service manifest already follows this pattern.
- Extension naming conventions must align with the official namespace format.

**Incremental scope consent (SEP-835).** `WWW-Authenticate` header for requesting additional OAuth scopes at runtime. Implications:
- Proposal #4 (Scoped Auth): The spec now supports runtime scope escalation at the transport level. Our per-tool `required_scopes` and `can_execute` pre-flight check remain additive — they operate at the application level, not the OAuth level.

**Elicitation URL mode (SEP-1036).** Servers can request that clients open a URL for out-of-band user interaction (e.g., third-party OAuth consent). Implications:
- Proposal #6 (HITL): Our SEP already notes the relationship to Elicitation but should explicitly address URL mode as an alternative confirmation channel for high-security environments.

**Structured tool output (`outputSchema`).** Tools can declare JSON Schema for their outputs, enabling validation. Implications:
- Proposal #1 (Capability Discovery): `outputSchema` on tools reduces the gap for "fully typed output signatures." Our manifest's tool definitions should reference `outputSchema` where applicable.

**Tool name standardization (SEP-986).** Canonical format: A-Z, a-z, 0-9, underscore, hyphen, dot. 1-128 characters. Implications:
- Our example manifests must comply with these naming rules.

**JSON Schema 2020-12 as default (SEP-1613).** Already adopted by this repo. No action needed.

**Extensions framework — now GA (as of early 2026).** The Extensions framework has progressed beyond experimental. MCP Apps (SEP-1865) shipped as the first official extension in January 2026, GA in ChatGPT, Claude, VS Code. Extensions follow a formal "Extensions Track SEP process" and are maintained in the MCP GitHub organization. Implications:
- All 15 proposals should explicitly reference the GA Extensions framework as their intended home
- MCP Apps (SEP-1865) provides a UI channel (`ui://` URI scheme) relevant to Proposal #6 (HITL — could serve as confirmation interface) and Proposal #15 (Bidirectional Push — demonstrates server-to-client interactive content)
- The audit must address MCP Apps as a new overlapping feature

**Active SEPs not yet merged (monitor during audit):**
- SEP-1932 (DPoP) and SEP-1933 (Workload Identity Federation) — relevant to Proposal #4 (Scoped Auth)
- SEP-2093 (Resource Contents Metadata and Capabilities) — relevant to Proposal #9 (Data References)

**Next spec release.** The 2026 MCP roadmap (updated 2026-03-05) indicates a tentative June 2026 release with SEPs being finalized in Q1 2026. These are "not commitments" per the roadmap. The audit should be completed before this release to avoid rework.

### Relevant Code and Patterns

- `README.md` lines 72-94: Current gap analysis table — 15 rows, columns for Spec Coverage, Relevant SEP, Gap Status, What Remains
- `seps/0000-idempotency-and-transactions.md`: Transaction SEP — has Specification, Rationale, Limitations, Security sections but no cross-server coordination
- `examples/python/server.py` lines 1211-1288: Subscription demo — pure in-process `subscribe()` / `emit_event()` / `unsubscribe()` functions
- `examples/typescript/server.ts`: Equivalent subscription demo, also in-process
- Both implementations have a comment at line ~895 (TS) noting that some extensions "are exercised without routing through the JSON-RPC layer" — this is the transport gap
- `schemas/subscribe-notify.schema.json`: Defines subscription request/response/notification shapes
- `schemas/data-references.schema.json`: Defines reference format with `ref_id`, `server_origin`, `content_type`, `size_bytes`, `expires_at`, `access_url`

### External References

- MCP 2025-11-25 specification: https://modelcontextprotocol.io/specification/2025-11-25
- Tasks spec: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks
- Tools spec (annotations, outputSchema): https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- Extensions overview: https://modelcontextprotocol.io/extensions/overview
- Key Changes (2025-11-25 changelog): https://modelcontextprotocol.io/specification/2025-11-25/changelog
- Saga pattern reference: Garcia-Molina & Salem, "Sagas" (1987); Azure Architecture Center, "Saga distributed transactions pattern"
- Server-Sent Events (SSE): https://html.spec.whatwg.org/multipage/server-sent-events.html
- MCP Streamable HTTP transport: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports

## Key Technical Decisions

- **Audit output format**: A new `docs/spec-alignment/` directory with one markdown file per proposal (`01-capability-discovery.md` through `15-bidirectional-push.md`). Each file follows a standard template: Spec References Examined, Current Coverage, Remaining Gap, Design Changes Required, Verdict (Gap / Partially Addressed / Superseded). The README gap analysis table links to these files. This is more maintainable than a single monolithic audit document and allows per-proposal review.

- **Cross-server Saga coordination model**: Client-side orchestration, not a dedicated Saga coordinator service. The client already orchestrates the multi-step workflow — it simply needs a structured compensation log and a rollback procedure. This avoids introducing a new infrastructure dependency. The compensation log is a client-local data structure, not a protocol message — the protocol only needs to support per-server `transaction/begin`, `transaction/commit`, `transaction/rollback`. Cross-server atomicity is explicitly not guaranteed; the design provides best-effort compensation with clear failure reporting.

- **SSE for Subscriptions demo**: Use Node.js `http` module (no Express) for TypeScript; use `asyncio.start_server()` (stdlib, asyncio-native) for Python. Both run server + client in the same process via async concurrency. This demonstrates the actual wire format without external dependencies. The demo is *not* a full Streamable HTTP transport implementation — it simulates the event delivery mechanism only. Note: Python's `http.server` is synchronous/blocking and cannot handle SSE streams in an async event loop — `asyncio.start_server()` is the correct stdlib primitive.

- **Signed URLs for Data References demo**: Generate HMAC-SHA256 signed URLs with embedded expiry. Server A generates a reference; Server B fetches data directly from Server A using the signed URL. The client passes only the `ref_id` and metadata. This demonstrates the zero-copy-through-client property without requiring cloud object storage.

- **Superseded proposals get demoted, not deleted**: If the audit finds a proposal fully addressed by the spec, it moves to an `## Archive` section at the bottom of the README with a note explaining which spec feature supersedes it. The schema and implementation remain in the repo for historical reference. This respects existing links and citations.

- **Compensation log persistence model**: The compensation log is ephemeral (in-memory) by default. If the client crashes during rollback, the compensation state is lost and the system remains in a partially compensated state — this is an acknowledged limitation of the Saga pattern with ephemeral state. Clients requiring durability may persist the log to their own backing store, but this is a deployment concern outside the MCP protocol scope. Session state (Proposal #14) is NOT used for the compensation log to avoid a circular dependency between Proposals #5 and #14.

- **Compensation ordering and idempotency**: Cross-server steps are strictly sequential (one server at a time) to simplify compensation ordering. Concurrent cross-server steps are explicitly out of scope for v1. All compensation actions must carry idempotency keys to handle retry-after-timeout safely.

- **Transport demos are self-contained per language**: Each demo file (TypeScript or Python) runs both server and client within a single process using async concurrency. No cross-process or cross-language coordination. This avoids port discovery, process lifecycle management, and CI orchestration complexity. The TypeScript file runs an HTTP server + inline HTTP client. The Python file does the same independently. This matches the existing pattern where `server.py` and `server.ts` are each standalone.

- **SSE event format: JSON-RPC 2.0 notification envelopes**: The SSE demo wraps events in JSON-RPC notification envelopes (`{"jsonrpc": "2.0", "method": "notifications/event", "params": {...EventNotification...}}`), consistent with MCP Streamable HTTP transport conventions. This is resolved now, not deferred to implementation.

- **Audit "trace" is a concrete checklist**: For each proposal, the audit identifies: (a) overlapping spec method names, (b) overlapping schema fields, (c) overlapping SEPs by number, (d) completeness assessment per overlap. The "Partially Addressed" verdict includes a gap-severity sub-classification: `minor` (remaining gap is cosmetic or easily addressed) vs. `major` (remaining gap is a core differentiator). Audit files use plain Markdown headings — no YAML frontmatter, since no CI consumer is built in this plan.

- **Data References demo passes full `DataReference` object**: The current `ImportFromRefRequest` schema only requires `ref_id` and `origin_server`, lacking `access_url`. The demo passes the full `DataReference` object (which already includes `access_url` as an optional field) to Server B's import endpoint. This is schema-compliant and avoids a schema change. The trust assumption is explicit: the client holds the `access_url` (a bearer credential for the data) but never accesses the data itself. A compromised client could use the URL to exfiltrate data — document this trust boundary in the demo.

## Open Questions

### Resolved During Planning

- **Should we adopt the official MCP Extensions namespace format?** Yes. Our `supported_extensions` array values should follow the `io.modelcontextprotocol/` or vendor-namespaced format once the official convention stabilizes. For now, keep the current short names but document the mapping.
- **Does Tasks (SEP-1686) supersede Proposal #8 entirely?** No. Tasks provide status tracking and deferred result retrieval but not partial result streaming or checkpoint resumption. Proposal #8 addresses the streaming/checkpoint gap that Tasks leaves open. The audit file should make this distinction explicit.
- **Does Elicitation supersede Proposal #6 (HITL) entirely?** No. Elicitation is a server-initiated, runtime data-gathering mechanism. Our HITL proposal is a tool-definition-level, upfront declaration that a tool requires confirmation before execution. The two mechanisms serve different purposes and can coexist. The SEP already explains this, but the audit file should reinforce it with a comparison table.

### Deferred to Implementation

- Whether any proposal is fully superseded — cannot be determined until the per-proposal audit is complete.
- Whether MCP Apps (SEP-1865) partially supersedes Proposal #6 or #15 — depends on detailed audit.
- Whether the Data References demo needs CORS headers — likely not needed for localhost demos.
- Schema `$id` versioning strategy — document all schemas as draft-stage for now; add versioning at formal submission time.

## Security Considerations / Threat Model

The plan introduces four new attack surfaces. Each must be addressed in the demo code and SEP text:

**1. Signed URL replay within TTL (Data References)**
An intermediary or log that captures the `access_url` can fetch the data repeatedly until expiry. Mitigation: document that signed URLs are bearer-equivalent within TTL. Keep TTLs minimal (seconds). The signing scheme (`HMAC-SHA256(ref_id + expiry, secret)`) lacks a nonce — this is an intentional simplicity trade-off for the demo. Production implementations should add single-use tokens with server-side tracking.

**2. Saga compensation poisoning (Cross-Server Transactions)**
A compromised server returns "success" for compensation without actually rolling back, leaving cross-server state permanently inconsistent with no detection mechanism. Mitigation: the SEP should recommend out-of-band verification of compensation results when possible, and the failure matrix should include this scenario. Compensation calls must use the same authentication as forward calls — no weaker auth path for rollback.

**3. `user_confirmed` privilege escalation across Saga boundary**
A client obtains confirmation for a benign step on Server A, then replays the trust signal to authorize a destructive step on Server B. Mitigation: confirmation tokens must be server-scoped and parameter-bound per the HITL SEP. The Saga orchestrator must not reuse confirmation across servers. Each server independently validates confirmation for its own tools.

**4. SSE subscription_id as bearer token**
Anyone who obtains a `subscription_id` can read the event stream. Mitigation: generate `subscription_id` with sufficient entropy (UUIDv4), add a prominent security comment in the demo that production implementations must authenticate SSE connections (bearer token, session cookie, etc.), and note that `subscription_id` alone is not authentication.

**Demo-specific mitigations:**
- HMAC secret is hardcoded in demo code with a prominent `SECURITY WARNING` comment. Demo prints a stderr warning at startup when using the hardcoded fallback.
- All demo endpoints are localhost-only. No TLS — acceptable for demos, but called out.
- Compensation log contents (server names, tool arguments) are printed with redacted arguments in demo output.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌───────────────────────────────────────────────────────────────┐
│                Workstream 1: Spec Alignment Audit             │
│                                                               │
│  For each proposal (1–15):                                    │
│    1. Read the relevant MCP 2025-11-25 spec sections          │
│    2. Identify schema fields, methods, SEPs that overlap      │
│    3. Classify: Superseded / Partially Addressed / Gap        │
│    4. Document design changes needed (if any)                 │
│    5. Write docs/spec-alignment/NN-proposal-name.md           │
│                                                               │
│  Then:                                                        │
│    6. Update README gap analysis table with links             │
│    7. Update README baseline note                             │
│    8. Move any superseded proposals to Archive section         │
│    9. Update affected SEPs with spec alignment notes           │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│           Workstream 2: Cross-Server Transactions              │
│                                                               │
│  Add to seps/0000-idempotency-and-transactions.md:            │
│    - Cross-Server Coordination section                        │
│    - Client-side Saga orchestrator design                     │
│    - Compensation log data structure                          │
│    - Failure matrix (partial rollback scenarios)              │
│    - Worked example: Jira + Confluence + Slack                │
│    - Limitations section update                               │
│                                                               │
│  Update both reference implementations:                       │
│    - Add CrossServerSagaOrchestrator class                    │
│    - Demo: 3-server transaction with rollback                 │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│        Workstream 3: Transport-Level Implementations           │
│                                                               │
│  Subscriptions (Proposal #15):                                │
│    - Node.js SSE server (examples/typescript/sse-server.ts)   │
│    - Python SSE client (examples/python/sse-client.py)        │
│    - Demo: subscribe → receive 3 events → unsubscribe         │
│    - Wire format: JSON-RPC notifications over SSE             │
│                                                               │
│  Data References (Proposal #9):                               │
│    - Server A: HTTP endpoint serving data + signed URL gen    │
│    - Server B: Fetches data from Server A via signed URL      │
│    - Client: Passes ref_id only, never touches the data       │
│    - Demo: export from A → import to B → verify               │
└───────────────────────────────────────────────────────────────┘
```

## Implementation Units

- [ ] **Unit 1: Create spec alignment audit template and directory structure**

  **Goal:** Establish the audit infrastructure — directory, template file, and the first 3 audit files (for the proposals most likely to overlap with 2025-11-25: #8 Streaming, #6 HITL, #4 Scoped Auth).

  **Requirements:** R1, R2

  **Dependencies:** None

  **Files:**
  - Create: `docs/spec-alignment/README.md` (explains the audit process and template)
  - Create: `docs/spec-alignment/08-streaming-progress.md`
  - Create: `docs/spec-alignment/06-human-in-the-loop.md`
  - Create: `docs/spec-alignment/04-scoped-auth.md`

  **Approach:**
  - Define audit template with plain Markdown sections: Spec References Examined (with specific URLs and SEP numbers), Current Coverage, Remaining Gap, Design Changes Required, Verdict (Gap / Partially Addressed with minor/major severity / Superseded)
  - Each audit traces: (a) overlapping spec method names, (b) overlapping schema fields, (c) overlapping SEPs by number, (d) completeness assessment per overlap
  - For Proposal #8: Trace against Tasks (SEP-1686) `notifications/tasks/status`, `pollInterval`, and `notifications/progress` (existing). Document that Tasks handle status tracking but not partial result streaming or checkpoint tokens. Verdict: Partially Addressed (major).
  - For Proposal #6: Trace against `destructiveHint` annotation, Elicitation (form mode + URL mode), Tasks `input_required` state, AND MCP Apps (SEP-1865) UI channel. Document that annotations are advisory, Elicitation is server-initiated for data gathering, MCP Apps provides UI but not tool-definition-level mandatory confirmation. Verdict: Partially Addressed (major).
  - For Proposal #4: Trace against OAuth 2.1 transport-level auth, incremental scope consent (SEP-835), Protected Resource Metadata, AND active SEPs 1932 (DPoP) / 1933 (Workload Identity Federation). Document that transport auth handles session establishment but not per-tool scope declaration or `can_execute` pre-flight. Verdict: Partially Addressed (major).

  **Patterns to follow:**
  - Existing `docs/plans/` markdown formatting with frontmatter
  - Existing SEP structure (tables, sections, rationale)

  **Test scenarios:**
  - Each audit file references specific spec URLs and SEP numbers
  - Each audit file has all 4 template sections filled
  - No audit file claims "Not Addressed" for a feature that the spec demonstrably provides

  **Verification:**
  - All 3 audit files are complete and internally consistent
  - Cross-reference against the spec changelog confirms no missed features

- [ ] **Unit 2: Complete spec alignment audit for remaining 12 proposals**

  **Goal:** Audit all remaining proposals (1, 2, 3, 5, 7, 9, 10, 11, 12, 13, 14, 15) against the 2025-11-25 spec.

  **Requirements:** R1, R2, R3

  **Dependencies:** Unit 1 (template established)

  **Files:**
  - Create: `docs/spec-alignment/01-capability-discovery.md` through `docs/spec-alignment/15-bidirectional-push.md` (12 files)

  **Approach:**
  - Proposal #1 (Capability Discovery): Trace against `initialize` capabilities, `tools/list` with `outputSchema`, `listChanged` notification, Extensions framework. Note that operational metadata (rate limits, quotas, cost per tool) is still not in the spec. Verdict: Partially Addressed.
  - Proposal #5 (Idempotency & Transactions): Trace against `idempotentHint` annotation. Confirm it is advisory-only with no wire-level mechanism. Verdict: Not Addressed.
  - Proposal #11 (Structured Errors): Trace against JSON-RPC error codes and SEP-1303 (input validation as Tool Execution Errors). Confirm no `category`, `retry_after_seconds`, `user_actionable`, or `suggestion` fields. Verdict: Not Addressed.
  - Proposal #13 (Server Discovery): Trace against MCP Registry (launched September 2025). Determine whether the registry provides the capability-based search we propose or is limited to catalog listing. Verdict: likely Partially Addressed.
  - For each proposal: if the spec fully covers it, mark as Superseded and document which features supersede it. Based on current research, no proposal appears fully superseded.
  - Note: Extensions framework is now GA — frame all proposals as MCP Extensions in the audit, not as core spec changes.
  - If any proposal is marked Superseded, check its schema `$ref` chains (e.g., `transactions.schema.json` → `error.json`) for cascading impacts ad hoc — a full dependency matrix is not needed upfront.

  **Patterns to follow:**
  - Template from Unit 1
  - Cross-reference SEP index at https://modelcontextprotocol.io/seps

  **Test scenarios:**
  - All 15 proposals have an audit file
  - Every "Partially Addressed" verdict includes a concrete "What Remains" section
  - Every "Superseded" verdict (if any) includes the specific spec section or SEP that supersedes it

  **Verification:**
  - `docs/spec-alignment/` contains 15 markdown files
  - No proposal is left without a verdict

- [ ] **Unit 3: Update README gap analysis table and proposal text**

  **Goal:** Propagate audit findings into the README — update the gap analysis table, add links to audit files, revise proposal text where the audit identified design conflicts, and archive any superseded proposals.

  **Requirements:** R1, R3, R7

  **Dependencies:** Units 1-2

  **Files:**
  - Modify: `README.md` (gap analysis table, proposal sections, archive section if needed)
  - Modify: `seps/0000-human-in-the-loop-confirmation.md` (add Elicitation URL mode comparison)
  - Modify: `seps/0000-structured-error-model.md` (add SEP-1303 comparison)

  **Approach:**
  - Replace the "What Remains" column in the gap analysis table with concise verdicts linking to `docs/spec-alignment/NN-*.md`
  - For each proposal where the audit identified a design change: update the proposal text in the README to reflect the current spec baseline
  - For each SEP: add a "Relationship to MCP 2025-11-25" subsection under Motivation, citing specific spec features
  - If any proposal is Superseded: move to a new `## Archive — Superseded Proposals` section at the bottom of the README. Keep schema and implementation files unchanged.

  **Patterns to follow:**
  - Existing README table format
  - Existing SEP section structure

  **Test scenarios:**
  - Every row in the gap analysis table links to an audit file
  - No proposal text contradicts the audit findings
  - SEPs reference specific spec URLs (not vague "the spec already has X")

  **Verification:**
  - README renders correctly with all links
  - `grep -c "docs/spec-alignment" README.md` returns 15 (one link per proposal)

- [ ] **Unit 4: Add Cross-Server Coordination section to Transactions SEP**

  **Goal:** Design and document how compensation-based transactions work across multiple independent MCP servers.

  **Requirements:** R4

  **Dependencies:** Unit 2 (audit confirms Proposal #5 is not superseded)

  **Files:**
  - Modify: `seps/0000-idempotency-and-transactions.md`

  **Approach:**
  - Add a new `## Cross-Server Coordination` section after the existing Specification section
  - **Coordination model: Client-side Saga orchestrator.** The client maintains a compensation log — an ordered list of `{server, step_id, compensation_tool, compensation_arguments, status}` entries. Each server manages its own transaction locally; the client coordinates the global workflow.
  - **Worked example** with 3 servers:
    1. Client → Jira Server: `create_issue(...)` → success, compensation: `delete_issue(PROJ-42)`
    2. Client → Confluence Server: `link_page(...)` → success, compensation: `unlink_page(...)`
    3. Client → Slack Server: `post_message(...)` → FAIL
    4. Client triggers rollback: calls Confluence `unlink_page(...)` → success, then Jira `delete_issue(PROJ-42)` → success
  - **Failure matrix** covering:
    - Compensation succeeds for all servers → clean rollback
    - Compensation fails for one server (e.g., Confluence API unavailable) → partial rollback, client reports which steps could not be compensated
    - Client crashes during rollback → compensation state is lost (ephemeral log); system remains in partially compensated state — acknowledged limitation
    - Server crashes during forward step → client detects timeout, initiates rollback for completed steps
    - Compromised compensation endpoint → server returns success without actually compensating; mitigation: client should verify state out-of-band when possible
  - **Compensation log ownership**: The log lives in the client, not in any server. Servers only need to support per-call idempotency keys and compensation action registration. No server-to-server communication is required. The log should not be exposed to end users without redaction — it contains server names, tool names, and arguments that may include sensitive data.
  - **Security: Confirmation scope in cross-server Sagas**: Each server independently validates `user_confirmed` for its own destructive tools. Confirmation tokens must be server-scoped and parameter-bound — a confirmation for `delete_issue(PROJ-42)` on Server A does not authorize `drop_table(users)` on Server B. Compensation actions that are themselves destructive must be pre-authorized by the original confirmation scope or require re-confirmation.
  - **Limitations update**: Explicitly state that cross-server Sagas are best-effort. The protocol cannot prevent a scenario where Server A's compensation succeeds but Server B's fails, leaving the system in an inconsistent state. This is inherent to the Saga pattern with independent external services.
  - **Comparison to 2PC**: Brief note explaining why 2PC is infeasible (external SaaS APIs don't implement prepare/commit) — this already exists in the Rationale section, but cross-reference it from the new section.

  **Patterns to follow:**
  - Existing SEP section structure (specification-style prose, JSON examples, tables)
  - Existing "Limitations" and "Rationale" sections

  **Test scenarios:**
  - The worked example is complete and internally consistent (3 servers, forward steps, failure, rollback)
  - The failure matrix covers at least 5 distinct failure modes including compromised endpoint
  - A reader can implement client-side Saga coordination from the specification text alone

  **Verification:**
  - The section answers the question: "Who coordinates rollback when 3 servers are involved?"
  - The compensation log data structure is fully specified (fields, ordering)
  - Security considerations for confirmation propagation are addressed

- [ ] **Unit 5: Add cross-server Saga demo to reference implementations**

  **Goal:** Demonstrate client-side Saga orchestration in both Python and TypeScript demos.

  **Requirements:** R4

  **Dependencies:** Unit 4 (design established)

  **Files:**
  - Create: `examples/python/saga_demo.py`
  - Create: `examples/typescript/saga-demo.ts`

  **Approach:**
  - Create standalone demo files (not modifying the already-large server.py/server.ts), consistent with Units 6-7
  - Add a `SagaOrchestrator` class (Python) / `SagaOrchestrator` class (TypeScript) that:
    - Maintains a compensation log (list of `{server_id, step_id, compensation}` entries)
    - Executes steps in sequence, appending compensation actions
    - On failure: iterates the log in reverse, calling compensation actions
    - Reports partial rollback if any compensation fails
  - Simulate 3 logical servers by reusing the existing `handle_request()` / `handleRequest()` infrastructure (import from server.py/server.ts) with different "server" labels
  - Route through the JSON-RPC layer for all calls
  - Scenario A: 2 successful steps → 1 failure → rollback of the 2 successful steps (all compensations succeed)
  - Scenario B: 2 successful steps → 1 failure → rollback where one compensation also fails → partial rollback with `compensation_failed` status reported
  - Failure is injected via a hardcoded "fail on tool X" flag, not randomized (deterministic for CI)
  - All compensation actions carry idempotency keys
  - Note: the Saga demo remains in-process (simulated servers via `handleRequest()`). This is intentional — the Saga pattern's value is in the orchestration logic, not the transport. Transport is demonstrated separately in Units 6-7.

  **Patterns to follow:**
  - Existing demo section numbering and separator comments
  - Existing `TransactionManager` class for single-server transactions
  - Stdlib-only constraint (Python), no new dependencies (TypeScript)

  **Test scenarios:**
  - Demo runs to completion with exit code 0
  - Scenario A output shows: 3 step attempts, 1 failure, 2 compensation actions executed in reverse order
  - Scenario B output shows: partial rollback with at least one `compensation_failed` entry
  - Compensation log is printed for transparency after each scenario

  **Verification:**
  - `python examples/python/saga_demo.py` completes with exit code 0
  - `npx tsx examples/typescript/saga-demo.ts` completes with exit code 0
  - Both produce equivalent output for the cross-server Saga demo

- [ ] **Unit 6: Add SSE-based Subscriptions demo**

  **Goal:** Replace the in-process Subscriptions simulation with a transport-level demo using Server-Sent Events.

  **Requirements:** R5

  **Dependencies:** Soft dependency on Unit 2 — may proceed in parallel, but if the audit marks Proposal #15 as Superseded, discard this work

  **Files:**
  - Create: `examples/typescript/sse-subscription-demo.ts`
  - Create: `examples/python/sse_subscription_demo.py`

  **Approach:**
  - **Each demo file is self-contained** (single process, single language, server + client in the same event loop via async concurrency). No cross-process or cross-language coordination.
  - **TypeScript**: Use Node.js `http` module to start a minimal HTTP server on `localhost:0` (random port). Read assigned port from `server.address()`. In the same process, use `http.request`/`fetch` as the client. Expose endpoints:
    - `POST /subscribe` → accepts `{events, filter}`, returns `{subscription_id}`
    - `GET /events/:subscription_id` → SSE stream that sends JSON-RPC notifications for matching events
    - `POST /unsubscribe` → cancels subscription, closes SSE stream
  - **Python**: Use `asyncio.start_server()` for the HTTP/SSE server (writes raw HTTP headers + SSE frames to `asyncio.StreamWriter`). Use `asyncio.open_connection()` for the client (reads SSE stream from `asyncio.StreamReader`). Both are fully async and run in the same event loop. Note: `http.server` and `urllib.request` are synchronous/blocking and cannot be used here.
  - **Event trigger**: The server emits events at 100ms intervals after the SSE connection is established. The client reads 3 events, then unsubscribes. No separate trigger endpoint needed.
  - **Event format (resolved)**: JSON-RPC 2.0 notification envelopes as SSE `data:` lines: `data: {"jsonrpc": "2.0", "method": "notifications/event", "params": {...EventNotification...}}\n\n`. Consistent with MCP Streamable HTTP transport conventions.
  - **Readiness pattern**: Server binds, reads its port, then starts the in-process client. No external health-check needed since both are in the same process.
  - Keep the existing in-process demo in `server.py` / `server.ts` unchanged — the new files are supplementary transport demos
  - Auto-shutdown: both demos exit after the test sequence completes (no long-running server)

  **Patterns to follow:**
  - Existing demo structure (print section headers, show request/response)
  - Existing `subscribe-notify.schema.json` message shapes
  - MCP Streamable HTTP transport SSE conventions where applicable

  **Test scenarios:**
  - SSE server starts, client connects, receives 3 events, unsubscribes, both processes exit cleanly
  - Events are valid JSON-RPC notifications conforming to `subscribe-notify.schema.json`
  - Unsubscribe causes the SSE stream to close

  **Verification:**
  - `npx tsx examples/typescript/sse-subscription-demo.ts` exits 0
  - `python examples/python/sse_subscription_demo.py` exits 0
  - CI can run both with `timeout-minutes: 2`

- [ ] **Unit 7: Add signed-URL Data References demo**

  **Goal:** Demonstrate server-to-server data transfer via signed URLs where the client orchestrates but never touches the payload.

  **Requirements:** R6

  **Dependencies:** Soft dependency on Unit 2 — may proceed in parallel, but if the audit marks Proposal #9 as Superseded, discard this work

  **Files:**
  - Create: `examples/typescript/data-reference-demo.ts`
  - Create: `examples/python/data_reference_demo.py`

  **Approach:**
  - **Each demo file is self-contained** (single process, single language). Server A, Server B, and the client all run in the same event loop via async concurrency. Python uses `asyncio.start_server()` + `asyncio.open_connection()` (not `http.server`/`urllib`).
  - **Server A** (data source): HTTP server on `localhost:0` exposing:
    - `POST /export` → generates a dataset, returns a `data_reference` object with `ref_id`, `access_url` (HMAC-SHA256 signed URL with embedded expiry), `content_type`, `size_bytes`, `expires_at`
    - `GET /data/:ref_id?sig=...&exp=...` → validates signature and expiry, serves the data
  - **Server B** (data consumer): HTTP server on `localhost:0` exposing:
    - `POST /import` → accepts the full `data_reference` object (including `access_url`), fetches from `access_url`, returns import result
  - **Schema approach (resolved)**: The demo passes the full `DataReference` object (which already includes `access_url` as an optional field) to Server B's import endpoint. This is schema-compliant and avoids a schema change to `ImportFromRefRequest`.
  - **Client flow** (all in-process):
    1. Calls Server A `/export` → receives `data_reference`
    2. Passes `data_reference` to Server B `/import` (only the reference, not the data)
    3. Server B fetches data directly from Server A using `access_url`
    4. Client receives import confirmation
  - HMAC-SHA256 signing: `sign(ref_id + expiry_timestamp, server_secret)` — stdlib only (`hmac` in Python, `crypto` in Node.js). The server secret is a hardcoded demo value with a prominent comment that this is illustrative, not production-grade.
  - **TTL expiry test**: Use a replaceable time function (e.g., module-level `get_time()` defaulting to real clock). In the expired-URL test, set TTL to 0 seconds so the URL is expired immediately — no timing dependency, no CI flakiness, no wasted wait time.
  - Demonstrate invalid signature: tamper with URL → 403

  **Patterns to follow:**
  - Existing `data-references.schema.json` message shapes
  - Existing demo structure

  **Test scenarios:**
  - Full flow: export → transfer reference → import → verify data matches
  - Expired URL: wait for TTL → fetch → 403
  - Invalid signature: tamper with URL → 403

  **Verification:**
  - Both demos exit 0
  - Data never appears in client-side logging (only `ref_id` and metadata)
  - CI can run both with `timeout-minutes: 2`

- [ ] **Unit 8: Update CI, examples README, and CONTRIBUTING.md**

  **Goal:** Integrate the new demo files into CI and update documentation.

  **Requirements:** R7

  **Dependencies:** Units 6-7

  **Files:**
  - Modify: `.github/workflows/validate.yml`
  - Modify: `examples/README.md`
  - Modify: `CONTRIBUTING.md`

  **Approach:**
  - Add CI steps for the 6 new demo files (Saga demo + SSE subscription + data reference, both languages), each with `timeout-minutes: 2`
  - Update the examples README coverage matrix to note which proposals have transport-level demos vs. in-process demos
  - Update CONTRIBUTING.md to mention the `docs/spec-alignment/` directory and its purpose

  **Patterns to follow:**
  - Existing CI workflow structure
  - Existing coverage matrix format

  **Test scenarios:**
  - CI passes with all existing and new steps
  - Examples README accurately reflects the new demo files

  **Verification:**
  - GitHub Actions run includes the new steps
  - All steps pass

## System-Wide Impact

- **Interaction graph:** The spec alignment audit modifies documentation (README, SEPs) and may trigger minor design adjustments in proposal text. It does not change schemas, reference implementations, or CI — except through downstream units. The cross-server Saga code adds a new class to each implementation but does not modify existing transaction logic. The transport demos are new standalone files that do not modify the existing `server.py` / `server.ts`.
- **Error propagation:** The SSE and signed-URL demos introduce localhost HTTP networking. Each demo must implement a readiness pattern: server binds to port 0, reads its own assigned port, then starts the in-process client. No cross-process port discovery needed (demos are self-contained). CI timeouts (2 minutes) prevent hangs. Server startup failures should produce clear error messages, not silent hangs.
- **State lifecycle risks:** The signed-URL demo relies on timing for TTL expiry tests. Use TTL of 1 second with a 3-second wait to absorb CI jitter. If flaky, switch to a mock clock approach.
- **API surface parity:** Both Python and TypeScript must produce equivalent output for the cross-server Saga demo. Transport demos run independently per language (each file is self-contained with server + client in one process).
- **Schema changes:** No schema changes are planned in this pass. The Data References demo passes the full `DataReference` object (which already includes `access_url`), avoiding changes to `ImportFromRefRequest`. If the audit identifies schema conflicts, address them in a follow-up.
- **Cross-proposal dependencies:** If the audit marks any proposal as Superseded, check its schema `$ref` chains for cascading impacts ad hoc.
- **Coverage matrix:** `examples/README.md` needs a new "Transport Demo" column to distinguish proposals with wire-format demos from those with only in-process simulations.
- **Security:** See the Security Considerations / Threat Model section above. All demo-specific mitigations (hardcoded secrets, no auth, redacted logs) are documented there.
- **Dependency gate:** Units 6-7 have soft dependencies on Unit 2 (audit). They may proceed in parallel, but if the audit marks Proposal #9 or #15 as Superseded, the corresponding transport demo work is discarded.

## Risks & Dependencies

- **Spec audit may invalidate more than expected.** If the 2025-11-25 spec covers more ground than the current gap analysis suggests, several proposals may need significant revision or Superseded status. Mitigation: complete the audit (Units 1-2) before starting implementation work (Units 4-7) so design changes are identified early.
- **Transport demos may be flaky in CI.** Localhost HTTP servers can fail due to port conflicts or slow startup. Mitigation: use random ports (`0`), add startup health checks (poll until ready), and set generous timeouts.
- **Cross-server Saga design may not satisfy distributed systems purists.** Client-side orchestration is a pragmatic choice, not a theoretically complete solution. Mitigation: the SEP's Limitations section explicitly acknowledges best-effort semantics. Frame it as "the right trade-off for MCP's architecture" (client-orchestrated, server-executed), not as a general distributed transaction solution.
- **MCP spec may release a new version during this work.** The 2025-11-25 spec is the latest as of March 2026. The 2026 roadmap (updated 2026-03-05) indicates a tentative June 2026 release with SEPs being finalized in Q1. Mitigation: the audit structure (per-proposal files with `spec_version` in YAML frontmatter) makes it straightforward to update against a new baseline. Complete audit before June if possible.
- **MCP Apps (SEP-1865) may partially overlap with Proposals #6 and #15.** MCP Apps shipped as the first official extension (GA January 2026) and provides a UI channel for server-to-client interaction. Mitigation: address in the audit files for Proposals #6 and #15 with explicit comparison.
- **Schema `$id` URLs have no versioning.** Modifying schemas (e.g., adding `CompensationLog`, updating `ImportFromRefRequest`) without version segments in `$id` URLs may break consumers who cached previous versions. Mitigation: document that all schemas are draft-stage and not yet stable. Add versioning when the proposals approach formal submission.

## Sources & References

- MCP 2025-11-25 specification: https://modelcontextprotocol.io/specification/2025-11-25
- MCP 2025-11-25 changelog: https://modelcontextprotocol.io/specification/2025-11-25/changelog
- Tasks specification: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks
- Tools specification: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- Extensions overview: https://modelcontextprotocol.io/extensions/overview
- SEP index: https://modelcontextprotocol.io/seps
- MCP blog — November 2025 release: https://blog.modelcontextprotocol.io/posts/2025-11-25-first-mcp-anniversary/
- MCP blog — next version update: https://modelcontextprotocol.info/blog/mcp-next-version-update/
- Related code: `README.md`, `seps/0000-idempotency-and-transactions.md`, `seps/0000-human-in-the-loop-confirmation.md`, `seps/0000-structured-error-model.md`, `examples/python/server.py`, `examples/typescript/server.ts`
- Garcia-Molina & Salem, "Sagas," ACM SIGMOD 1987 (Saga pattern)
- Azure Architecture Center, "Saga distributed transactions pattern"
- MCP Apps (SEP-1865): https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865
- Understanding MCP Extensions (March 2026): https://blog.modelcontextprotocol.io/posts/2026-03-11-understanding-mcp-extensions/
- 2026 MCP Roadmap: https://modelcontextprotocol.io/development/roadmap
- SEP-1932 (DPoP): https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1932
- SEP-2093 (Resource Contents Metadata): https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2093
