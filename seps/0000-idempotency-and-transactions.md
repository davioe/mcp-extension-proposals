# SEP-0000: Idempotency Keys and Compensation-Based Transactions

| Field | Value |
|-------|-------|
| **SEP Number** | 0000 |
| **Title** | Idempotency Keys and Compensation-Based Transactions |
| **Author** | davioe |
| **Sponsor** | *(to be assigned)* |
| **Status** | Draft |
| **Type** | Extensions Track |
| **Created** | 2026-03-25 |
| **Specification** | MCP 2025-11-25 |
| **Discussion** | *(link to PR when submitted)* |

## Abstract

This SEP introduces two complementary mechanisms for reliable state-changing operations in MCP: (1) **idempotency keys** — a standard header on tool invocations that ensures repeated calls with the same key produce no additional effect, and (2) **compensation-based transactions** — an optional protocol for multi-step operations where each step registers a compensation action, enabling rollback on failure. Both mechanisms are opt-in extensions that servers declare via capability negotiation.

## Motivation

MCP's current request-response model has no built-in mechanism to handle two fundamental distributed systems problems:

**Duplicate execution.** Network failures, client retries, and timeout-triggered re-sends can cause the same tool call to execute multiple times. The spec's `idempotentHint` annotation tells clients a tool *is* idempotent, but provides no wire-level mechanism to *enforce* it. A client retrying `create_issue` cannot distinguish "the first call succeeded" from "the first call failed and this is a fresh attempt."

**Partial failure in multi-step workflows.** When an agent executes a sequence of tool calls (create Jira ticket → link Confluence doc → post Slack notification), a failure at step 3 leaves steps 1 and 2 in an inconsistent state. There is no protocol-level mechanism to coordinate rollback.

### Real-World Failure Scenarios

1. **Duplicate ticket creation.** An agent calls `create_issue` on a Jira server. The server creates the ticket and sends a response, but the response is lost due to a network timeout. The client retries. Without an idempotency key, a duplicate ticket is created. With an idempotency key, the server recognizes the replay and returns the original result.

2. **Orphaned artifacts.** An agent creates a Jira ticket (step 1), links a Confluence page (step 2), then fails to post a Slack notification (step 3). The Jira ticket and Confluence link remain but the workflow is incomplete. With compensation-based transactions, the failed step triggers rollback: the Confluence link is removed and the Jira ticket is deleted.

## Relationship to MCP 2025-11-25

The 2025-11-25 spec acknowledges idempotency but provides no wire-level mechanism:

- **`idempotentHint` annotation.** Advisory only — tells clients that a tool is safe to retry without side effects. However, it provides no idempotency key, no replay detection, and no stored-result mechanism. A client retrying a `create_issue` call has no way to distinguish "the first call succeeded and this is a duplicate" from "the first call failed." Our proposal adds the missing wire-level protocol: a client-generated key, server-side replay detection, and `was_replay` metadata in responses.
- **No transaction primitives.** The spec has no concept of multi-step atomic operations, no compensation protocol, and no rollback mechanism. If step 3 of a 5-step workflow fails, steps 1 and 2 remain in an inconsistent state with no protocol-level recovery path.
- **No compensation or rollback.** Saga-style compensation, `transaction/begin`, `transaction/commit`, and `transaction/rollback` are entirely absent from the spec. Our proposal provides the coordination protocol that makes multi-step agent workflows recoverable.

The `idempotentHint` annotation and this SEP are complementary: the hint declares intent, the key enforces it.

## Specification

### Idempotency Keys

#### Request Format

Any state-changing tool call MAY include an idempotency key:

```json
{
  "method": "tools/call",
  "params": {
    "name": "create_issue",
    "arguments": { "title": "Fix login bug", "priority": "high" },
    "_meta": {
      "idempotency_key": "op-2026-03-15-abc123",
      "idempotency_ttl_seconds": 86400
    }
  }
}
```

#### Server Behavior

- On **first receipt** of an idempotency key: execute the operation, store the key and result, return the result.
- On **subsequent receipt** of the same key within the TTL: return the stored result without re-executing. Include `"was_replay": true` in the response metadata.
- After TTL expiry: the key is forgotten. A new request with the same key is treated as a fresh call.

#### Response Metadata

```json
{
  "result": { "ticket_id": "PROJ-42" },
  "_meta": {
    "idempotency_key": "op-2026-03-15-abc123",
    "was_replay": false,
    "original_timestamp": "2026-03-15T10:30:00Z"
  }
}
```

### Compensation-Based Transactions

#### Transaction Lifecycle

1. **Begin**: Client sends `transaction/begin` with a unique `transaction_id`, `timeout_seconds`, and `description`.
2. **Steps**: Each tool call within the transaction includes the `transaction_id`. The server registers a compensation action for each successful step.
3. **Commit**: Client sends `transaction/commit`. The server finalizes all steps.
4. **Rollback**: On failure or client request, `transaction/rollback` triggers compensation actions in reverse order.

#### Protocol Messages

**Begin:**
```json
{
  "method": "transaction/begin",
  "params": {
    "transaction_id": "tx-001",
    "timeout_seconds": 300,
    "description": "Create issue with linked documentation"
  }
}
```

**Step Result (includes compensation):**
```json
{
  "result": { "ticket_id": "PROJ-42" },
  "_meta": {
    "transaction_id": "tx-001",
    "step_id": "step-1",
    "compensation": {
      "tool": "delete_issue",
      "arguments": { "ticket_id": "PROJ-42" }
    }
  }
}
```

**Rollback Result:**
```json
{
  "transaction_id": "tx-001",
  "status": "rolled_back",
  "steps_compensated": [
    { "step_id": "step-2", "status": "compensated" },
    { "step_id": "step-1", "status": "compensated" }
  ]
}
```

#### Compensation Failure

If a compensation action itself fails, the rollback result includes the error:

```json
{
  "steps_compensated": [
    { "step_id": "step-2", "status": "compensation_failed", "error": "Confluence API unavailable" },
    { "step_id": "step-1", "status": "compensated" }
  ]
}
```

The client MUST handle partial rollback gracefully. The transaction enters a `partially_rolled_back` state that requires manual intervention.

### Capability Negotiation

```json
{
  "supported_extensions": ["idempotency", "transactions"]
}
```

Servers MAY support idempotency without transactions. Transactions require idempotency support.

## Rationale

### Why compensation-based Sagas over 2PC?

Two-phase commit (2PC) requires all participating systems to support a prepare/commit protocol. External SaaS APIs (Jira, Slack, Confluence) do not implement 2PC. Compensation-based Sagas are the standard pattern for distributed transactions across systems that only support forward operations and explicit rollback.

### Why not event sourcing?

Event sourcing adds complexity disproportionate to the use case. Most multi-step agent workflows need "undo on failure," not a complete event log with replay capability. Compensation-based rollback is simpler to implement and sufficient for the orchestration patterns MCP enables.

### Limitations

- **Best-effort, not ACID.** Compensation-based transactions cannot guarantee full consistency across independent external systems. If a compensation action fails, the transaction enters a partially-rolled-back state.
- **No isolation.** Between `begin` and `commit`/`rollback`, intermediate state is visible to other clients.
- **CAP theorem applies.** Cross-system transactions operate across independent availability zones. Network partitions can leave transactions in an indeterminate state.
- **Not a database transaction replacement.** For operations requiring true atomicity, the backing system must provide its own transactional guarantees.

## Backward Compatibility

Both mechanisms are fully opt-in:

- Servers that do not support idempotency ignore the `idempotency_key` field in `_meta` (or return an error if they explicitly reject it).
- Servers that do not support transactions reject `transaction/begin` with a standard error.
- Existing clients that do not use these features are unaffected.
- The extensions are declared via `supported_extensions`, enabling graceful feature detection.

## Reference Implementation

Reference implementations in Python and TypeScript are available in the companion repository. The Python implementation includes an `IdempotencyStore` class for replay detection and a `TransactionManager` class for compensation-based rollback, exercised in Steps 5 (idempotent create) and 7 (transaction with rollback) of the demo sequence. The TypeScript implementation mirrors the same classes and demo steps. A separate HTTP-transport Saga demo validates cross-server coordination over real network boundaries with three independent servers.

The transaction lifecycle and idempotency key schemas are defined in the transactions schema.

Source: https://github.com/davioe/mcp-extension-proposals/blob/main/examples/python/server.py
Source: https://github.com/davioe/mcp-extension-proposals/blob/main/examples/typescript/server.ts
Source: https://github.com/davioe/mcp-extension-proposals/blob/main/schemas/transactions.schema.json

## Security Implications

- **Idempotency key storage.** Servers MUST bound the storage used for idempotency keys (TTL expiry, maximum entries). An attacker could otherwise exhaust server memory by sending unique keys.
- **Transaction timeout.** The `timeout_seconds` field prevents resource exhaustion from abandoned transactions. Servers MUST enforce the timeout.
- **Compensation action validation.** Servers MUST validate that compensation actions are legitimate rollback operations, not arbitrary tool calls injected by a malicious client.

## Cross-Server Coordination

### Overview

The single-server transaction model above handles the common case. For multi-step workflows spanning multiple independent MCP servers, a client-side Saga orchestrator provides best-effort compensation-based rollback.

### Coordination Model

The client maintains an in-memory compensation log — an ordered list of completed steps with their compensation actions. Each server manages its own state independently; the client coordinates the global workflow. No server-to-server communication is required.

**Compensation Log Entry:**
```json
{
  "server_id": "jira-server",
  "step_id": "create-PROJ-42",
  "compensation_tool": "delete_issue",
  "compensation_arguments": { "issue_id": "PROJ-42" },
  "idempotency_key": "compensate-create-PROJ-42",
  "status": "pending"
}
```

### Worked Example

A client orchestrates a workflow across three servers:

1. **Client → Jira Server:** `create_issue({title: "Deploy v2.1"})` → success, returns `PROJ-42`
   - Compensation registered: `delete_issue({issue_id: "PROJ-42"})`
2. **Client → Confluence Server:** `link_page({page_id: "DOC-100", issue_id: "PROJ-42"})` → success
   - Compensation registered: `unlink_page({page_id: "DOC-100", issue_id: "PROJ-42"})`
3. **Client → Slack Server:** `post_message({channel: "#releases", text: "PROJ-42 deployed"})` → **FAIL** (channel archived)

Rollback (reverse order):
1. Client → Confluence: `unlink_page(...)` with idempotency key → success
2. Client → Jira: `delete_issue(...)` with idempotency key → success
3. Report: all compensations succeeded, clean rollback

### Failure Matrix

| Scenario | Outcome | Client Action |
|----------|---------|---------------|
| All compensations succeed | Clean rollback | Report success |
| One compensation fails (e.g., Confluence unavailable) | Partial rollback | Report which steps could not be compensated; log for manual intervention |
| Client crashes during rollback | Compensation state lost (ephemeral log) | System remains in partially compensated state — acknowledged limitation |
| Server crashes during forward step | Client detects timeout | Initiate rollback for completed steps |
| Compromised compensation endpoint | Server returns success without compensating | Recommend out-of-band verification when possible |

### Security: Confirmation Scope

- Each server independently validates `user_confirmed` for its own destructive tools
- Confirmation tokens are server-scoped and parameter-bound — a confirmation for `delete_issue(PROJ-42)` on Jira does not authorize `drop_database()` on another server
- All compensation actions carry idempotency keys to handle retry-after-timeout safely

### Limitations

- Cross-server Sagas are **best-effort**. The protocol cannot prevent a scenario where Server A's compensation succeeds but Server B's fails, leaving the system inconsistent.
- The compensation log is ephemeral by default. Clients requiring durability MUST persist the log to their own backing store — this is outside the MCP protocol scope.
- Steps execute strictly sequentially (one server at a time). Concurrent cross-server steps are out of scope for v1 to simplify compensation ordering.
- 2PC (two-phase commit) is infeasible because external SaaS APIs do not implement prepare/commit phases. The Saga pattern is the pragmatic alternative for MCP's architecture (client-orchestrated, server-executed).
